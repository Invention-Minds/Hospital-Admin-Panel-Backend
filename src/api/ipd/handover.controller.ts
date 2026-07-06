import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * IPD per-admission SBAR Hand-off controller (Phase 3).
 *
 * One row per (admission × date × shift). The outgoing nurse fills the
 * writable SBAR fields and signs; the incoming nurse acknowledges with
 * their own signature. NABH HRM.5 / PSQ.5 audit anchor.
 *
 * Two endpoint groups:
 *   • CRUD on the row itself (list, upsert, sign-handed-over,
 *     sign-taken-over).
 *   • `/handover-pull` — a live aggregator that returns the
 *     auto-populated context the SBAR view needs but doesn't store
 *     (drugs given today, drugs due, vitals trend, I/O totals, current
 *     problems from the initial assessment). The receiving nurse always
 *     sees the freshest data; nothing here is snapshotted on sign.
 */

// ─── Helpers ────────────────────────────────────────────────────────

function dayStart(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayEnd(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function shiftWindow(date: Date, shift: 'M' | 'E' | 'N'): { start: Date; end: Date } {
  const start = new Date(date);
  const end = new Date(date);
  if (shift === 'M') { start.setHours(6, 0, 0, 0); end.setHours(13, 59, 59, 999); }
  else if (shift === 'E') { start.setHours(14, 0, 0, 0); end.setHours(21, 59, 59, 999); }
  else { start.setHours(22, 0, 0, 0); end.setDate(end.getDate() + 1); end.setHours(5, 59, 59, 999); }
  return { start, end };
}

// ─── Handover CRUD ──────────────────────────────────────────────────

interface UpsertHandoverBody {
  chartDate: string;
  shift: 'M' | 'E' | 'N';

  postOpDay?: number | null;
  diet?: string | null;
  ventilation?: string | null;
  invasiveLines?: string | null;

  infusionsTransfusions?: string | null;
  puProphylaxis?: string | null;
  dvtProphylaxis?: string | null;
  painScale?: number | null;
  gcsLoc?: string | null;
  skinIntegrity?: string | null;
  restraints?: string | null;
  fallRisk?: string | null;
  adl?: string | null;
  ambulation?: string | null;
  criticalLabValues?: string | null;
  currentProblems?: string | null;

  investigationsOrdered?: string | null;
  reportsPending?: string | null;
  referrals?: string | null;
  nextShiftPriorities?: string | null;
}

export const listForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const fromParam = req.query.from as string | undefined;
    const toParam = req.query.to as string | undefined;
    const where: Record<string, unknown> = { admissionId };
    if (fromParam || toParam) {
      const range: Record<string, Date> = {};
      if (fromParam) range.gte = dayStart(new Date(`${fromParam}T00:00:00`));
      if (toParam) range.lte = dayEnd(new Date(`${toParam}T00:00:00`));
      where.chartDate = range;
    }
    const rows = await prisma.ipdHandover.findMany({
      where,
      orderBy: [{ chartDate: 'desc' }, { shift: 'asc' }],
      take: 60,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[ipd-handover] listForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to load handovers' });
  }
};

export const upsertHandover = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as UpsertHandoverBody;
    if (!body.chartDate || !body.shift) {
      res.status(400).json({ error: 'chartDate and shift are required' });
      return;
    }
    if (!['M', 'E', 'N'].includes(body.shift)) {
      res.status(400).json({ error: 'shift must be M, E or N' });
      return;
    }
    const date = dayStart(new Date(`${body.chartDate}T00:00:00`));
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ error: 'chartDate must be YYYY-MM-DD' });
      return;
    }

    // Block edits once the receiver acknowledges — that's the immutable point.
    const existing = await prisma.ipdHandover.findUnique({
      where: { admissionId_chartDate_shift: { admissionId, chartDate: date, shift: body.shift } },
    });
    if (existing?.status === 'ACKNOWLEDGED') {
      res.status(409).json({ error: 'Handover already acknowledged — open a new shift entry instead' });
      return;
    }

    // Strip undefined so section saves don't clear unrelated fields.
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (['chartDate', 'shift'].includes(key)) continue;
      if (value !== undefined) data[key] = value;
    }

    const row = await prisma.ipdHandover.upsert({
      where: { admissionId_chartDate_shift: { admissionId, chartDate: date, shift: body.shift } },
      update: {
        ...data,
        updatedBy: req.user?.username ?? null,
        updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      create: {
        admissionId,
        chartDate: date,
        shift: body.shift,
        ...data,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(existing ? 200 : 201).json(row);
  } catch (error) {
    console.error('[ipd-handover] upsertHandover failed:', error);
    res.status(500).json({
      error: 'Failed to save handover',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

interface SignBody {
  signatureId: string;
  nurseName?: string;
}

export const signHandedOver = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as SignBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }
    const existing = await prisma.ipdHandover.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Handover not found' }); return; }
    if (existing.status === 'ACKNOWLEDGED') {
      res.status(409).json({ error: 'Already acknowledged' });
      return;
    }

    const row = await prisma.ipdHandover.update({
      where: { id },
      data: {
        handedOverByName: body.nurseName ?? req.user?.username ?? null,
        handedOverById: typeof req.user?.id === 'number' ? req.user.id : null,
        handedOverBySignatureId: body.signatureId,
        handedOverAt: new Date(),
        status: 'HANDED_OVER',
      },
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdHandover',
      entityId: id,
      payload: { from: existing.status, to: 'HANDED_OVER' },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[ipd-handover] signHandedOver failed:', error);
    res.status(500).json({ error: 'Failed to sign as outgoing nurse' });
  }
};

export const signTakenOver = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as SignBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }
    const existing = await prisma.ipdHandover.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Handover not found' }); return; }
    if (existing.status !== 'HANDED_OVER') {
      res.status(409).json({ error: `Cannot acknowledge before outgoing nurse signs. Status: ${existing.status}` });
      return;
    }

    const row = await prisma.ipdHandover.update({
      where: { id },
      data: {
        takenOverByName: body.nurseName ?? req.user?.username ?? null,
        takenOverById: typeof req.user?.id === 'number' ? req.user.id : null,
        takenOverBySignatureId: body.signatureId,
        takenOverAt: new Date(),
        status: 'ACKNOWLEDGED',
      },
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdHandover',
      entityId: id,
      payload: { from: 'HANDED_OVER', to: 'ACKNOWLEDGED' },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[ipd-handover] signTakenOver failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge as incoming nurse' });
  }
};

// ─── Live-pull aggregator ───────────────────────────────────────────

/**
 * GET /api/ipd/admission/:admissionId/handover-pull?date=YYYY-MM-DD&shift=M|E|N
 *
 * Returns the live context the SBAR view shows above the writable fields.
 * Nothing stored — every call re-queries source tables so the receiving
 * nurse always sees the current state.
 */
export const handoverPull = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const shift = (req.query.shift as 'M' | 'E' | 'N') ?? 'M';
    if (!['M', 'E', 'N'].includes(shift)) {
      res.status(400).json({ error: 'shift must be M, E or N' });
      return;
    }
    const date = dayStart(new Date(`${dateParam}T00:00:00`));
    const { start, end } = shiftWindow(date, shift);
    const dayBegin = dayStart(date);
    const dayFinish = dayEnd(date);

    const [admission, initialAssessment, medsGiven, prescriptions, vitals, ioEntries] = await Promise.all([
      prisma.ipdAdmission.findUnique({
        where: { id: admissionId },
        select: {
          admissionNo: true, prn: true, diagnosis: true, department: true,
          admittingDoctor: true, admissionDate: true,
          bed: { select: { bedNumber: true } },
          ward: { select: { wardName: true, wardCode: true } },
        },
      }),
      prisma.ipdInitialAssessment.findUnique({
        where: { admissionId },
        select: {
          allergyDrug: true, allergyFood: true, allergyTransfusion: true,
          allergyOthers: true,
          hasHypertension: true, hasDiabetes: true, hasCardiacDisease: true,
          hasCopd: true, hasThyroidDisorder: true, hasCva: true,
          provisionalDiagnosis: true, problems: true, treatmentPlan: true,
        },
      }),
      prisma.ipdMedicationLog.findMany({
        where: { admissionId, administeredAt: { gte: start, lte: end } },
        orderBy: { administeredAt: 'asc' },
        take: 200,
      }),
      prisma.ipdPrescription.findMany({
        where: { admissionId, status: 'active' },
        orderBy: { nextAdminTime: 'asc' },
      }),
      prisma.ipdVitalsReading.findMany({
        where: { admissionId, recordedAt: { gte: dayBegin, lte: dayFinish } },
        orderBy: { recordedAt: 'asc' },
        take: 100,
      }),
      prisma.ipdIntakeOutputEntry.findMany({
        where: { admissionId, recordedAt: { gte: dayBegin, lte: dayFinish } },
        orderBy: { recordedAt: 'asc' },
      }),
    ]);

    // Match each medication log to its prescription so the view shows drug
    // name with the admin time.
    const rxIds = Array.from(new Set(medsGiven.map((m) => m.prescriptionId)));
    const rxRows = await prisma.ipdPrescription.findMany({
      where: { id: { in: rxIds } },
      select: { id: true, genericName: true, brandName: true, dose: true, route: true },
    });
    const rxMap = new Map(rxRows.map((r) => [r.id, r]));

    // Day-level intake/output totals.
    let intakeTotalMl = 0;
    let outputTotalMl = 0;
    for (const e of ioEntries) {
      if (e.entryType === 'INTAKE') intakeTotalMl += e.amountMl;
      else outputTotalMl += e.amountMl;
    }

    res.status(200).json({
      admissionId,
      date: date.toISOString(),
      shift,
      shiftWindow: { start: start.toISOString(), end: end.toISOString() },
      admission,
      allergies: initialAssessment
        ? {
            drug: initialAssessment.allergyDrug,
            food: initialAssessment.allergyFood,
            transfusion: initialAssessment.allergyTransfusion,
            others: initialAssessment.allergyOthers,
          }
        : null,
      coMorbidities: initialAssessment
        ? [
            initialAssessment.hasHypertension && 'Hypertension',
            initialAssessment.hasDiabetes && 'Diabetes',
            initialAssessment.hasCardiacDisease && 'Cardiac disease',
            initialAssessment.hasCopd && 'COPD',
            initialAssessment.hasThyroidDisorder && 'Thyroid disorder',
            initialAssessment.hasCva && 'CVA / epilepsy',
          ].filter(Boolean)
        : [],
      problemsAtAdmission: initialAssessment?.problems ?? null,
      provisionalDiagnosis: initialAssessment?.provisionalDiagnosis ?? null,
      medsGivenInShift: medsGiven.map((m) => ({
        id: m.id,
        administeredAt: m.administeredAt.toISOString(),
        administeredBy: m.administeredBy,
        route: m.route,
        quantity: m.quantity,
        drug: rxMap.get(m.prescriptionId) ?? null,
        remarks: m.remarks,
      })),
      activePrescriptions: prescriptions.map((p) => ({
        id: p.id,
        genericName: p.genericName,
        brandName: p.brandName,
        dose: p.dose,
        frequency: p.frequency,
        route: p.route,
        nextAdminTime: p.nextAdminTime?.toISOString() ?? null,
        adminStatus: p.adminStatus,
        prescriptionType: p.prescriptionType,
      })),
      vitalsToday: vitals.map((v) => ({
        recordedAt: v.recordedAt.toISOString(),
        shift: v.shift,
        temperatureF: v.temperatureF,
        temperatureC: v.temperatureC,
        pulse: v.pulse,
        respiration: v.respiration,
        bpSystolic: v.bpSystolic,
        bpDiastolic: v.bpDiastolic,
        spo2: v.spo2,
        painScore: v.painScore,
      })),
      intakeTotalMl,
      outputTotalMl,
    });
  } catch (error) {
    console.error('[ipd-handover] handoverPull failed:', error);
    res.status(500).json({ error: 'Failed to pull handover context' });
  }
};
