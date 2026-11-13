import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { syncOrdersQuietly } from './meal-order.cron';
import { loadPatientContext, loadCurrentPlans } from './patient-context';
import { isDietNight } from './diet-notify';
import { readSettings } from './masters.controller';

/**
 * Dietary care — the hospital's additions to the closed loop:
 *   • Night diet acknowledgement — dietitian works 07:00–19:00; at night any
 *     doctor acknowledges a new admission / diet change (interim diet). The
 *     dietitian reviews and signs next morning.
 *   • Nurse "Received" — the ward confirms the tray reached the patient.
 *   • Food quality check — 10 parameters rated 1-5, total /50 → grade.
 *   • Patient dietary feedback — the Patient Dietary Service Feedback Form.
 */

const actorOf = (req: Request) => ({
  name: req.user?.username ?? null,
  id: typeof req.user?.id === 'number' ? req.user.id : null,
});

// ─── Night diet acknowledgement (any doctor) ─────────────────────────

/**
 * GET /night-ack — patients a doctor should acknowledge:
 *   • no diet at all (new admission),
 *   • on an interim diet nobody has reviewed,
 *   • the ward reported a change / allergy after the last acknowledgement.
 */
export const listNightAck = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [settings, night, patients] = await Promise.all([readSettings(), isDietNight(), loadPatientContext({})]);
    const ids = patients.map((p) => p.admissionId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [plans, censusLines] = await Promise.all([
      loadCurrentPlans(ids),
      ids.length
        ? prisma.dietCensusLine.findMany({
            where: {
              admissionId: { in: ids },
              changeFlag: { in: ['NEW', 'CHANGED'] },
              census: { submittedAt: { gte: since }, status: { in: ['SUBMITTED', 'RECEIVED', 'ACKNOWLEDGED'] } },
            },
            include: { census: { select: { submittedAt: true, wardName: true } } },
          })
        : [],
    ]);
    const ackRows = ids.length
      ? await prisma.dietPlan.findMany({
          where: { admissionId: { in: ids }, status: { in: ['ACTIVE', 'INTERIM'] } },
          select: { admissionId: true, doctorAckAt: true, doctorAckBy: true, doctorAckNote: true, signedAt: true },
        })
      : [];
    const ackBy = new Map(ackRows.map((r) => [r.admissionId, r]));
    const lineBy = new Map<string, (typeof censusLines)[number]>();
    for (const l of censusLines) {
      const cur = lineBy.get(l.admissionId);
      if (!cur || cur.census.submittedAt < l.census.submittedAt) lineBy.set(l.admissionId, l);
    }

    const rows = patients.flatMap((p) => {
      const plan = plans.get(p.admissionId);
      const ack = ackBy.get(p.admissionId);
      const line = lineBy.get(p.admissionId);
      const lastReview = [ack?.doctorAckAt, ack?.signedAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      let reason: string | null = null;
      if (!plan) reason = 'New admission — no diet yet';
      else if (plan.status === 'INTERIM' && !ack?.doctorAckAt) reason = 'Interim diet from the ward census — not reviewed';
      else if (line && (!lastReview || lastReview < line.census.submittedAt)) {
        const parts = [line.foodAllergy ? `allergy: ${line.foodAllergy}` : null, line.dietText ? `diet: ${line.dietText}` : null, line.remarks]
          .filter(Boolean);
        reason = `Ward reported a change${parts.length ? ` (${parts.join(' · ')})` : ''}`;
      }
      if (!reason) return [];
      return [{
        admissionId: p.admissionId,
        admissionNo: p.admissionNo,
        prn: p.prn,
        patientName: p.patientName,
        ageSex: [p.age, p.sex].filter(Boolean).join('/') || null,
        wardName: p.wardName,
        bedNumber: p.bedNumber,
        consultant: p.consultant,
        diagnosis: p.diagnosis,
        foodAllergy: line?.foodAllergy ?? p.ia?.allergyOthers ?? (p.ia?.foodAllergy ? 'Food allergy (details not recorded)' : null),
        foodPreference: line?.foodPreference ?? p.ia?.dietPattern ?? null,
        currentDiet: plan ? { code: plan.displayCode, name: plan.dietName, status: plan.status } : null,
        doctorAck: ack?.doctorAckAt ? { at: ack.doctorAckAt, by: ack.doctorAckBy, note: ack.doctorAckNote } : null,
        reason,
        admittedAt: p.admissionDate,
      }];
    }).sort((a, b) => (a.bedNumber ?? '').localeCompare(b.bedNumber ?? '', undefined, { numeric: true }));

    res.status(200).json({ night, nightFrom: settings.nightFrom, nightUntil: settings.nightUntil, rows });
  } catch (error) {
    console.error('[dietetics] listNightAck failed:', error);
    res.status(500).json({ error: 'Failed to load night acknowledgement list' });
  }
};

/**
 * POST /night-ack/:admissionId  { dietMasterId?, note? }
 * Doctor acknowledges. No diet yet → an INTERIM diet (doctor-picked) starts
 * trays at once. Diet change on a signed diet → the signed plan is superseded
 * by an INTERIM one the dietitian re-signs next morning.
 */
export const acknowledgeNight = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const { dietMasterId, note } = (req.body ?? {}) as { dietMasterId?: string | null; note?: string | null };
    const actor = actorOf(req);
    const [patient] = await loadPatientContext({ admissionIds: [admissionId] });
    if (!patient) { res.status(400).json({ error: 'Patient is not currently admitted' }); return; }
    if (dietMasterId) {
      const diet = await prisma.dietMaster.findFirst({ where: { id: dietMasterId, isActive: true }, select: { id: true } });
      if (!diet) { res.status(400).json({ error: 'Pick an active diet' }); return; }
    }
    const current = await prisma.dietPlan.findMany({
      where: { admissionId, status: { in: ['ACTIVE', 'INTERIM'] } },
      orderBy: { createdAt: 'desc' },
    });
    const plan = current.find((p) => p.status === 'ACTIVE') ?? current[0] ?? null;
    const ack = { doctorAckAt: new Date(), doctorAckBy: actor.name, doctorAckNote: note?.trim() || null };

    let planId: string;
    if (!plan) {
      if (!dietMasterId) { res.status(400).json({ error: 'No diet yet — pick a diet to start' }); return; }
      const created = await prisma.dietPlan.create({
        data: {
          admissionId, dietMasterId, status: 'INTERIM', source: 'DOCTOR',
          foodAvoid: patient.ia?.allergyOthers ?? null,
          remarks: note?.trim() ? `Night: ${note.trim()}` : 'Started by doctor at night — dietitian to review',
          createdBy: actor.name, ...ack,
        },
      });
      planId = created.id;
    } else if (dietMasterId && dietMasterId !== plan.dietMasterId) {
      if (plan.status === 'INTERIM') {
        await prisma.dietPlan.update({ where: { id: plan.id }, data: { dietMasterId, ...ack } });
        planId = plan.id;
      } else {
        // Signed diet changed at night: keep the patient's details, dietitian re-signs.
        await prisma.dietPlan.update({ where: { id: plan.id }, data: { status: 'SUPERSEDED', endDate: new Date(), endReason: 'NIGHT_CHANGE' } });
        const created = await prisma.dietPlan.create({
          data: {
            admissionId, dietMasterId, status: 'INTERIM', source: 'DOCTOR',
            textureId: plan.textureId, foodAvoid: plan.foodAvoid, fluidRestrictionMl: plan.fluidRestrictionMl,
            disposablePlate: plan.disposablePlate, feedVolumeMl: plan.feedVolumeMl, feedIntervalHours: plan.feedIntervalHours,
            feedStartTime: plan.feedStartTime, feedWindowFrom: plan.feedWindowFrom, feedWindowUntil: plan.feedWindowUntil,
            feedNotes: plan.feedNotes, notesForKitchen: plan.notesForKitchen,
            remarks: [`Night change by doctor${note?.trim() ? `: ${note.trim()}` : ''}`, plan.remarks].filter(Boolean).join(' · '),
            createdBy: actor.name, ...ack,
          },
        });
        planId = created.id;
      }
    } else {
      await prisma.dietPlan.update({ where: { id: plan.id }, data: ack });
      planId = plan.id;
    }

    await auditLog(req, {
      module: 'dietetics', action: 'SIGN', entityType: 'DietNightAck', entityId: planId,
      payload: { admissionId, dietMasterId: dietMasterId ?? null, note: note ?? null },
      notes: 'Night diet acknowledgement by doctor',
    });
    await syncOrdersQuietly(admissionId);
    res.status(200).json({ ok: true, planId });
  } catch (error) {
    console.error('[dietetics] acknowledgeNight failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge' });
  }
};

// ─── Nurse: tray received on the ward ────────────────────────────────

/** POST /meal-orders/:id/receive  { receivedByName? } */
export const receiveTray = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.mealOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Tray not found' }); return; }
    if (!['DELIVERED', 'CONSUMED'].includes(existing.status)) {
      res.status(409).json({ error: 'The kitchen has not served this tray yet' });
      return;
    }
    if (existing.receivedAt) { res.status(409).json({ error: `Already received by ${existing.receivedByName ?? existing.receivedBy}` }); return; }
    const actor = actorOf(req);
    const name = ((req.body ?? {}) as { receivedByName?: string }).receivedByName?.trim() || actor.name;
    const row = await prisma.mealOrder.update({
      where: { id: existing.id },
      data: { receivedAt: new Date(), receivedBy: actor.name, receivedByName: name },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'STATUS_CHANGE', entityType: 'MealOrderReceived', entityId: row.id,
      payload: { admissionId: row.admissionId },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] receiveTray failed:', error);
    res.status(500).json({ error: 'Failed to record receipt' });
  }
};

// ─── Food quality check ──────────────────────────────────────────────

export const QUALITY_PARAMETERS = [
  'appearance', 'taste', 'aroma', 'texture', 'portion',
  'temperature', 'freshness', 'hygiene', 'recipe', 'therapeutic',
] as const;

/** Total out of 50 → grade (bands follow the 1-5 scale: avg 4.5+ Excellent …). */
export function qualityGrade(total: number): string {
  if (total >= 45) return 'Excellent';
  if (total >= 38) return 'Very good';
  if (total >= 30) return 'Satisfactory';
  if (total >= 20) return 'Poor';
  return 'Unacceptable';
}

const dayRange = (from?: string, to?: string) => {
  const today = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = new Date(`${from || ymd(new Date(today.getTime() - 6 * 86400000))}T00:00:00`);
  const end = new Date(`${to || ymd(today)}T23:59:59.999`);
  return { start, end };
};

/** POST /quality-checks */
export const createQualityCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = (req.body ?? {}) as {
      checkDate?: string; mealTimeSlotId?: string | null; dietMasterId?: string | null; item?: string | null;
      ratings?: Record<string, unknown>; observations?: string | null; correctiveAction?: string | null;
    };
    const ratings: Record<string, number> = {};
    for (const k of QUALITY_PARAMETERS) {
      const v = Number(b.ratings?.[k]);
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        res.status(400).json({ error: 'Rate all 10 parameters from 1 (Unacceptable) to 5 (Excellent)' });
        return;
      }
      ratings[k] = v;
    }
    const total = Object.values(ratings).reduce((s, v) => s + v, 0);
    const grade = qualityGrade(total);
    if ((grade === 'Poor' || grade === 'Unacceptable') && !b.correctiveAction?.trim()) {
      res.status(400).json({ error: `Grade is ${grade} — record the corrective action` });
      return;
    }
    const actor = actorOf(req);
    const row = await prisma.foodQualityCheck.create({
      data: {
        checkDate: b.checkDate ? new Date(`${b.checkDate}T12:00:00`) : new Date(),
        mealTimeSlotId: b.mealTimeSlotId || null,
        dietMasterId: b.dietMasterId || null,
        item: b.item?.trim() || null,
        ratings: JSON.stringify(ratings),
        totalScore: total,
        ratedCount: QUALITY_PARAMETERS.length,
        grade,
        observations: b.observations?.trim() || null,
        correctiveAction: b.correctiveAction?.trim() || null,
        checkedBy: actor.name,
        checkedById: actor.id,
      },
    });
    await auditLog(req, { module: 'dietetics', action: 'CREATE', entityType: 'FoodQualityCheck', entityId: row.id, payload: { total, grade } });
    res.status(201).json({ ...row, ratings });
  } catch (error) {
    console.error('[dietetics] createQualityCheck failed:', error);
    res.status(500).json({ error: 'Failed to save quality check' });
  }
};

/** GET /quality-checks?from&to — newest first, with slot / diet names. */
export const listQualityChecks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = dayRange(req.query.from as string, req.query.to as string);
    const [rows, slots, diets] = await Promise.all([
      prisma.foodQualityCheck.findMany({ where: { checkDate: { gte: start, lte: end } }, orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.mealTimeSlot.findMany({ select: { id: true, name: true } }),
      prisma.dietMaster.findMany({ select: { id: true, code: true, name: true } }),
    ]);
    const slotName = new Map(slots.map((s) => [s.id, s.name]));
    const dietName = new Map(diets.map((d) => [d.id, `${d.code} · ${d.name}`]));
    res.status(200).json(rows.map((r) => ({
      ...r,
      ratings: JSON.parse(r.ratings) as Record<string, number>,
      mealName: r.mealTimeSlotId ? slotName.get(r.mealTimeSlotId) ?? null : null,
      dietName: r.dietMasterId ? dietName.get(r.dietMasterId) ?? null : null,
    })));
  } catch (error) {
    console.error('[dietetics] listQualityChecks failed:', error);
    res.status(500).json({ error: 'Failed to load quality checks' });
  }
};

// ─── Patient dietary feedback ────────────────────────────────────────

export const FEEDBACK_PARAMETERS = ['taste', 'temperature', 'timeliness', 'courtesy', 'qualityHygiene', 'overall'] as const;

/** POST /feedback */
export const createFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = (req.body ?? {}) as {
      admissionId?: string; ratings?: Record<string, unknown>; correctDiet?: boolean | null; comments?: string | null;
      respondent?: string; respondentName?: string | null; signatureId?: string | null; staffName?: string | null;
    };
    if (!b.admissionId) { res.status(400).json({ error: 'Pick the patient' }); return; }
    const adm = await prisma.ipdAdmission.findUnique({ where: { id: b.admissionId }, select: { id: true } });
    if (!adm) { res.status(404).json({ error: 'Admission not found' }); return; }
    const ratings: Record<string, number> = {};
    for (const k of FEEDBACK_PARAMETERS) {
      const v = Number(b.ratings?.[k]);
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        res.status(400).json({ error: 'Rate every parameter from 1 (Poor) to 5 (Excellent)' });
        return;
      }
      ratings[k] = v;
    }
    const avg = Math.round((Object.values(ratings).reduce((s, v) => s + v, 0) / FEEDBACK_PARAMETERS.length) * 10) / 10;
    const actor = actorOf(req);
    const row = await prisma.dietFeedback.create({
      data: {
        admissionId: b.admissionId,
        ratings: JSON.stringify(ratings),
        averageScore: avg,
        correctDiet: typeof b.correctDiet === 'boolean' ? b.correctDiet : null,
        comments: b.comments?.trim() || null,
        respondent: b.respondent === 'ATTENDANT' ? 'ATTENDANT' : 'PATIENT',
        respondentName: b.respondentName?.trim() || null,
        signatureId: b.signatureId || null,
        staffName: b.staffName?.trim() || actor.name,
        createdBy: actor.name,
        createdById: actor.id,
      },
    });
    await auditLog(req, { module: 'dietetics', action: 'CREATE', entityType: 'DietFeedback', entityId: row.id, payload: { avg } });
    res.status(201).json({ ...row, ratings });
  } catch (error) {
    console.error('[dietetics] createFeedback failed:', error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
};

/** GET /feedback?from&to — rows with patient context + average per parameter. */
export const listFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = dayRange(req.query.from as string, req.query.to as string);
    const rows = await prisma.dietFeedback.findMany({
      where: { feedbackDate: { gte: start, lte: end } },
      orderBy: { feedbackDate: 'desc' },
      take: 1000,
    });
    const patients = await loadPatientContext({ admissionIds: Array.from(new Set(rows.map((r) => r.admissionId))), admittedOnly: false });
    const pMap = new Map(patients.map((p) => [p.admissionId, p]));
    const parsed = rows.map((r) => {
      const p = pMap.get(r.admissionId);
      return {
        ...r,
        ratings: JSON.parse(r.ratings) as Record<string, number>,
        patientName: p?.patientName ?? null, prn: p?.prn ?? null, admissionNo: p?.admissionNo ?? null,
        wardName: p?.wardName ?? null, bedNumber: p?.bedNumber ?? null,
      };
    });
    const averages: Record<string, number | null> = {};
    for (const k of FEEDBACK_PARAMETERS) {
      averages[k] = parsed.length ? Math.round((parsed.reduce((s, r) => s + (r.ratings[k] ?? 0), 0) / parsed.length) * 10) / 10 : null;
    }
    const answered = parsed.filter((r) => r.correctDiet !== null);
    res.status(200).json({
      rows: parsed,
      count: parsed.length,
      averages,
      correctDietPct: answered.length ? Math.round((answered.filter((r) => r.correctDiet).length / answered.length) * 100) : null,
    });
  } catch (error) {
    console.error('[dietetics] listFeedback failed:', error);
    res.status(500).json({ error: 'Failed to load feedback' });
  }
};
