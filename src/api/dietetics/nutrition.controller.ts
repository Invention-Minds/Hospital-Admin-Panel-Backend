import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { readSettings } from './masters.controller';
import { loadPatientContext, loadCurrentPlans, remarkText, type PatientContext } from './patient-context';

/**
 * Clinical nutrition — the hospital's screening forms + dietitian rounds.
 *
 *   NRS2002      JMRH/FO/2024/107 — adults. Initial screening (4 questions);
 *                if any YES → final score = nutritional status (0–3) + disease
 *                severity (0–3) + 1 if age ≥ 70. ≥ 3 = at risk, care plan;
 *                < 3 (or all NO) = re-screen weekly.
 *                Risk factor: 0 Nil · 1 Mild · 2 Moderate · ≥3 Severe.
 *   STAMP        JMR/FO/2024/89 — paediatrics. Diagnosis (0/2/3) + intake
 *                (0/2/3) + weight/height centiles (0/1/3).
 *                ≥ 4 High · 2–3 Medium · 0–1 Low. Re-screen after 3 days.
 *   MATERNAL     15-item risk checklist. 0–1 Low · 2–3 Moderate ·
 *                ≥ 4 or any severe condition High.
 *   REASSESSMENT Long stay / clinical change: BCP, intake, diagnosis, weight
 *                trend, diet advised. No score.
 *
 * Scores are computed here — the client sends the answers only.
 */

export const FORM_TYPES = ['NRS2002', 'STAMP', 'MATERNAL', 'REASSESSMENT'] as const;
type FormType = (typeof FORM_TYPES)[number];

/** Maternal checklist keys (the printed form's 15 risk lines). */
export const MATERNAL_RISK_KEYS = [
  'underweight', 'overweightObesity', 'inadequateGwg', 'excessiveGwg', 'anemia',
  'poorIntakeOrHyperemesis', 'diabetes', 'renal', 'pihPreeclampsia', 'hypothyroidism',
  'iugr', 'multiplePregnancy', 'oligohydramnios', 'polyhydramnios', 'others',
];

const DAY = 24 * 60 * 60 * 1000;

const ageYears = (age: string | null | undefined): number | null => {
  if (!age) return null;
  const n = Number.parseFloat(String(age).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  // "8 M" / "10 months" → months; "3 D" → days.
  if (/m(on)?th|\bm\b/i.test(age) && !/y/i.test(age)) return n / 12;
  if (/d(ay)?/i.test(age) && !/y/i.test(age)) return n / 365;
  return n;
};

export const calcBmi = (weightKg: number | null, heightCm: number | null): number | null =>
  weightKg && heightCm ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;

/** Which form the dietitian should normally use for this patient. */
export function suggestedForm(p: PatientContext, maternalDepartments: string[]): FormType {
  const years = ageYears(p.age);
  if (years !== null && years < 18) return 'STAMP';
  const dept = (p.department ?? '').toLowerCase();
  if (p.ia?.isPregnant || maternalDepartments.some((d) => dept.includes(d.toLowerCase()))) return 'MATERNAL';
  return 'NRS2002';
}

interface Scored {
  riskScore: number | null;
  riskLevel: string | null;
  atRisk: boolean;
  nextScreeningDue: Date | null;
}

const inSet = (v: unknown, allowed: number[]): v is number => typeof v === 'number' && allowed.includes(v);

/** Validate the answers + compute score. Returns an error string on bad input. */
function scoreForm(formType: FormType, answers: Record<string, unknown>, ageYrs: number | null): Scored | string {
  const now = Date.now();
  if (formType === 'NRS2002') {
    const initial = (answers.initial ?? {}) as Record<string, unknown>;
    const anyYes = ['bmiBelow205', 'weightLoss3m', 'reducedIntake', 'severelyIll'].some((k) => initial[k] === true);
    if (!anyYes) {
      return { riskScore: 0, riskLevel: 'NIL', atRisk: false, nextScreeningDue: new Date(now + 7 * DAY) };
    }
    const n = answers.nutritionScore;
    const s = answers.severityScore;
    if (!inSet(n, [0, 1, 2, 3]) || !inSet(s, [0, 1, 2, 3])) {
      return 'NRS-2002: an initial answer is YES, so the final screening (nutritional status and disease severity, 0–3 each) is required';
    }
    const total = n + s + (ageYrs !== null && ageYrs >= 70 ? 1 : 0);
    const level = total === 0 ? 'NIL' : total === 1 ? 'MILD' : total === 2 ? 'MODERATE' : 'SEVERE';
    return {
      riskScore: total,
      riskLevel: level,
      atRisk: total >= 3,
      nextScreeningDue: total < 3 ? new Date(now + 7 * DAY) : null,
    };
  }
  if (formType === 'STAMP') {
    const d = answers.diagnosisScore;
    const i = answers.intakeScore;
    const w = answers.anthroScore;
    if (!inSet(d, [0, 2, 3]) || !inSet(i, [0, 2, 3]) || !inSet(w, [0, 1, 3])) {
      return 'STAMP: diagnosis (0/2/3), intake (0/2/3) and weight-height (0/1/3) scores are required';
    }
    const total = d + i + w;
    const level = total >= 4 ? 'HIGH' : total >= 2 ? 'MEDIUM' : 'LOW';
    return { riskScore: total, riskLevel: level, atRisk: total >= 2, nextScreeningDue: new Date(now + 3 * DAY) };
  }
  if (formType === 'MATERNAL') {
    const factors = Array.isArray(answers.riskFactors) ? answers.riskFactors.filter((k) => MATERNAL_RISK_KEYS.includes(String(k))) : [];
    const severe = answers.severeCondition === true;
    const total = factors.length;
    const level = severe || total >= 4 ? 'HIGH' : total >= 2 ? 'MODERATE' : 'LOW';
    return { riskScore: total, riskLevel: level, atRisk: level !== 'LOW', nextScreeningDue: null };
  }
  return { riskScore: null, riskLevel: null, atRisk: false, nextScreeningDue: null };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

// ─── POST /nutrition/assessments ────────────────────────────────────

export const createAssessment = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as {
      admissionId: string; formType: FormType; weightKg?: number; heightCm?: number; ibwKg?: number;
      answers?: Record<string, unknown>; energyKcal?: number; proteinG?: number; fluidMl?: number;
      otherNutrients?: string; intervention?: string; signatureId?: string;
    };
    if (!body.admissionId || !FORM_TYPES.includes(body.formType)) {
      res.status(400).json({ error: `admissionId and formType (${FORM_TYPES.join(' | ')}) are required` });
      return;
    }
    if (!body.signatureId) {
      res.status(400).json({ error: 'Dietitian signature is required' });
      return;
    }
    const [ctx] = await loadPatientContext({ admissionIds: [body.admissionId], admittedOnly: false });
    if (!ctx) { res.status(404).json({ error: 'Admission not found' }); return; }

    const answers = body.answers ?? {};
    const scored = scoreForm(body.formType, answers, ageYears(ctx.age));
    if (typeof scored === 'string') { res.status(400).json({ error: scored }); return; }

    const weightKg = num(body.weightKg);
    const heightCm = num(body.heightCm);
    const energy = num(body.energyKcal);
    const fluid = num(body.fluidMl);
    const row = await prisma.nutritionAssessment.create({
      data: {
        admissionId: body.admissionId,
        formType: body.formType,
        weightKg,
        heightCm,
        bmi: calcBmi(weightKg, heightCm),
        ibwKg: num(body.ibwKg),
        answers: JSON.stringify(answers),
        ...scored,
        energyKcal: energy ? Math.round(energy) : null,
        proteinG: num(body.proteinG),
        fluidMl: fluid ? Math.round(fluid) : null,
        otherNutrients: body.otherNutrients?.trim() || null,
        intervention: body.intervention?.trim() || null,
        assessedBy: req.user?.username ?? null,
        assessedById: typeof req.user?.id === 'number' ? req.user.id : null,
        signatureId: body.signatureId,
      },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'CREATE', entityType: 'NutritionAssessment', entityId: row.id,
      payload: { admissionId: row.admissionId, formType: row.formType, riskScore: row.riskScore, riskLevel: row.riskLevel },
    });
    res.status(201).json({ ...row, answers });
  } catch (error) {
    console.error('[dietetics] createAssessment failed:', error);
    res.status(500).json({
      error: 'Failed to save nutrition assessment',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── POST /nutrition/notes ──────────────────────────────────────────

export const createNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId, note, signatureId } = req.body as { admissionId: string; note: string; signatureId?: string };
    if (!admissionId || !note?.trim()) { res.status(400).json({ error: 'admissionId and note are required' }); return; }
    if (!signatureId) { res.status(400).json({ error: 'Signature is required' }); return; }
    const row = await prisma.dietitianNote.create({
      data: {
        admissionId,
        note: note.trim(),
        writtenBy: req.user?.username ?? null,
        writtenById: typeof req.user?.id === 'number' ? req.user.id : null,
        signatureId,
      },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'CREATE', entityType: 'DietitianNote', entityId: row.id,
      payload: { admissionId },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[dietetics] createNote failed:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
};

// ─── GET /nutrition/admission/:admissionId ──────────────────────────

export const getNutritionForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const [ctxList, assessments, notes, settings] = await Promise.all([
      loadPatientContext({ admissionIds: [admissionId], admittedOnly: false }),
      prisma.nutritionAssessment.findMany({ where: { admissionId }, orderBy: { assessedAt: 'desc' } }),
      prisma.dietitianNote.findMany({ where: { admissionId }, orderBy: { writtenAt: 'desc' } }),
      readSettings(),
    ]);
    const ctx = ctxList[0];
    if (!ctx) { res.status(404).json({ error: 'Admission not found' }); return; }
    const plans = await loadCurrentPlans([admissionId]);
    const plan = plans.get(admissionId);
    res.status(200).json({
      patient: ctx,
      suggestedForm: suggestedForm(ctx, settings.maternalDepartments as string[]),
      dietOnAdmission: plan ? `${plan.displayCode} · ${plan.dietName}` : null,
      assessments: assessments.map((a) => {
        let answers: unknown = {};
        try { answers = JSON.parse(a.answers); } catch { /* keep {} */ }
        return { ...a, answers };
      }),
      notes,
    });
  } catch (error) {
    console.error('[dietetics] getNutritionForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to load nutrition record' });
  }
};

// ─── GET /rounds?wardId= — dietitian's clinical IP list ─────────────

export const getRoundsList = async (req: Request, res: Response): Promise<void> => {
  try {
    const wardId = (req.query.wardId as string) || undefined;
    const patients = await loadPatientContext({ wardId });
    const ids = patients.map((p) => p.admissionId);
    const [plans, assessments, notes, settings] = await Promise.all([
      loadCurrentPlans(ids),
      ids.length
        ? prisma.nutritionAssessment.findMany({
            where: { admissionId: { in: ids } },
            orderBy: { assessedAt: 'desc' },
            select: {
              admissionId: true, formType: true, weightKg: true, heightCm: true, bmi: true,
              riskScore: true, riskLevel: true, atRisk: true, nextScreeningDue: true, assessedAt: true,
            },
          })
        : [],
      ids.length
        ? prisma.dietitianNote.findMany({
            where: { admissionId: { in: ids } },
            orderBy: { writtenAt: 'desc' },
            select: { admissionId: true, writtenAt: true },
          })
        : [],
      readSettings(),
    ]);
    const latestScreen = new Map<string, (typeof assessments)[number]>();
    const latestAnthro = new Map<string, (typeof assessments)[number]>();
    for (const a of assessments) {
      if (a.formType !== 'REASSESSMENT' && !latestScreen.has(a.admissionId)) latestScreen.set(a.admissionId, a);
      if ((a.weightKg || a.heightCm) && !latestAnthro.has(a.admissionId)) latestAnthro.set(a.admissionId, a);
    }
    const lastNote = new Map<string, Date>();
    for (const n of notes) if (!lastNote.has(n.admissionId)) lastNote.set(n.admissionId, n.writtenAt);
    const now = Date.now();

    const rows = patients.map((p) => {
      const plan = plans.get(p.admissionId);
      const screen = latestScreen.get(p.admissionId);
      const anthro = latestAnthro.get(p.admissionId);
      // Latest dietitian measurement, else the doctor's initial assessment.
      const weightKg = anthro?.weightKg ?? p.ia?.weightKg ?? null;
      const heightCm = anthro?.heightCm ?? p.ia?.heightCm ?? null;
      const daysAdmitted = Math.floor((now - p.admissionDate.getTime()) / DAY);
      return {
        admissionId: p.admissionId,
        admissionNo: p.admissionNo,
        prn: p.prn,
        patientName: p.patientName,
        age: p.age,
        sex: p.sex,
        wardName: p.wardName,
        bedNumber: p.bedNumber,
        admissionDate: p.admissionDate,
        daysAdmitted,
        consultant: p.consultant,
        diagnosis: p.diagnosis,
        heightCm,
        weightKg,
        bmi: calcBmi(weightKg, heightCm),
        anthroSource: anthro ? 'DIETITIAN' : (p.ia?.weightKg || p.ia?.heightCm ? 'INITIAL_ASSESSMENT' : null),
        diet: plan ? { code: plan.displayCode, name: plan.dietName, status: plan.status } : null,
        remark: remarkText(plan),
        doctorNutritionNote: p.ia?.nutritionNote ?? null,
        dietPattern: p.ia?.dietPattern ?? null,
        suggestedForm: suggestedForm(p, settings.maternalDepartments as string[]),
        screening: screen
          ? {
              formType: screen.formType, riskScore: screen.riskScore, riskLevel: screen.riskLevel,
              atRisk: screen.atRisk, assessedAt: screen.assessedAt, nextScreeningDue: screen.nextScreeningDue,
              overdue: !!screen.nextScreeningDue && screen.nextScreeningDue.getTime() < now,
            }
          : null,
        // Not screened yet, re-screen overdue, or stay > 7 days (re-assessment).
        actionNeeded: !screen
          ? 'Screening due'
          : screen.nextScreeningDue && screen.nextScreeningDue.getTime() < now
            ? 'Re-screening overdue'
            : daysAdmitted > 7 && !assessments.some((a) => a.admissionId === p.admissionId && a.formType === 'REASSESSMENT')
              ? 'Re-assessment (stay > 7 days)'
              : null,
        lastNoteAt: lastNote.get(p.admissionId) ?? null,
      };
    }).sort((a, b) =>
      (a.wardName ?? '').localeCompare(b.wardName ?? '')
      || (a.bedNumber ?? '').localeCompare(b.bedNumber ?? '', undefined, { numeric: true }));

    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] getRoundsList failed:', error);
    res.status(500).json({ error: 'Failed to load rounds list' });
  }
};
