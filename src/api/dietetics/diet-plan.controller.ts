import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { snapshotTemplateFields } from '../note-template/note-template.controller';
import { syncOrdersForAdmission } from './meal-order.cron';
import { loadPatientContext } from './patient-context';

/**
 * Push a plan change through to today's remaining + tomorrow's meal orders.
 * The plan write has already committed, so a sync failure is logged rather
 * than failing the request — the nightly run / manual regenerate will catch up.
 */
async function syncOrdersAfterPlanChange(admissionId: string): Promise<void> {
  try {
    await syncOrdersForAdmission(admissionId);
  } catch (err) {
    console.error(`[dietetics] meal-order sync failed for admission ${admissionId}:`, err);
  }
}

/**
 * DietPlan controller — clinical surface for the dietitian.
 *
 * Lifecycle per admission:
 *   (INTERIM from nursing census) → DRAFT → ACTIVE (signed) → SUPERSEDED | ENDED
 *
 * The dietitian prescribes; the doctor only records the initial assessment.
 * Re-assessment creates a new DietPlan row and demotes any prior ACTIVE /
 * INTERIM row to SUPERSEDED, so the table is an append-only history.
 * "Current plan" = newest ACTIVE, else the INTERIM plan from the census.
 */

interface UpsertDietPlanBody {
  admissionId: string;
  dietMasterId: string;
  startDate?: string;
  endDate?: string;
  npoFrom?: string;
  npoUntil?: string;
  restrictionsSnapshot?: string[];
  allergensSnapshot?: string[];
  notesForKitchen?: string;
  noteTemplateId?: string;
  templatedValueMap?: Record<string, unknown>;
  reassessmentReason?: string;
  textureId?: string | null;
  foodAvoid?: string | null;
  fluidRestrictionMl?: number | null;
  disposablePlate?: boolean;
  feedVolumeMl?: number | null;
  feedIntervalHours?: number | null;
  feedNotes?: string | null;
  needsCheck?: boolean;
  checkNote?: string | null;
  remarks?: string | null;
}

interface SignDietPlanBody {
  signatureId: string;
  signedBy?: string;
}

const PLAN_INCLUDE = { diet: true, texture: true };

/** Positive whole number or null (ml / day, ml per feed). */
const toPositiveInt = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const toPositiveFloat = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

// ─── Reads ──────────────────────────────────────────────────────────

export const getCurrentForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const row = await prisma.dietPlan.findFirst({
      where: { admissionId, status: 'ACTIVE' },
      orderBy: { signedAt: 'desc' },
      include: PLAN_INCLUDE,
    }) ?? await prisma.dietPlan.findFirst({
      where: { admissionId, status: 'INTERIM' },
      orderBy: { createdAt: 'desc' },
      include: PLAN_INCLUDE,
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] getCurrentForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to load current diet plan' });
  }
};

export const getHistoryForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const rows = await prisma.dietPlan.findMany({
      where: { admissionId },
      orderBy: { createdAt: 'desc' },
      include: PLAN_INCLUDE,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] getHistoryForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to load diet plan history' });
  }
};

// ─── Draft create / update ──────────────────────────────────────────

export const upsertDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id; // optional — when provided, updates the DRAFT row in place
    const body = req.body as UpsertDietPlanBody;

    if (!body.admissionId || !body.dietMasterId) {
      res.status(400).json({ error: 'admissionId and dietMasterId are required' });
      return;
    }

    // Don't let edits leak into a SIGNED plan; force creating a new draft instead.
    if (id) {
      const existing = await prisma.dietPlan.findUnique({ where: { id } });
      if (!existing) { res.status(404).json({ error: 'Diet plan not found' }); return; }
      if (existing.status !== 'DRAFT') {
        res.status(409).json({ error: `Cannot edit a ${existing.status} plan — raise a new draft instead` });
        return;
      }
    }

    const npoFrom = body.npoFrom ? new Date(body.npoFrom) : null;
    const npoUntil = body.npoUntil ? new Date(body.npoUntil) : null;
    if (npoFrom && npoUntil && npoUntil <= npoFrom) {
      res.status(400).json({ error: 'NPO until must be after NPO from' });
      return;
    }

    const data = {
      admissionId: body.admissionId,
      dietMasterId: body.dietMasterId,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : null,
      npoFrom,
      npoUntil,
      restrictionsSnapshot: body.restrictionsSnapshot
        ? JSON.stringify(body.restrictionsSnapshot)
        : null,
      allergensSnapshot: body.allergensSnapshot
        ? JSON.stringify(body.allergensSnapshot)
        : null,
      notesForKitchen: body.notesForKitchen ?? null,
      noteTemplateId: body.noteTemplateId ?? null,
      templatedValues: body.templatedValueMap
        ? JSON.stringify({ _schema: null, _values: body.templatedValueMap })
        : null,
      reassessmentReason: body.reassessmentReason ?? null,
      textureId: body.textureId || null,
      foodAvoid: body.foodAvoid?.trim() || null,
      fluidRestrictionMl: toPositiveInt(body.fluidRestrictionMl),
      disposablePlate: !!body.disposablePlate,
      feedVolumeMl: toPositiveInt(body.feedVolumeMl),
      feedIntervalHours: toPositiveFloat(body.feedIntervalHours),
      feedNotes: body.feedNotes?.trim() || null,
      needsCheck: !!body.needsCheck,
      checkNote: body.needsCheck ? (body.checkNote?.trim() || null) : null,
      remarks: body.remarks?.trim() || null,
      source: 'DIETITIAN',
      status: 'DRAFT',
      createdBy: id ? undefined : (req.user?.username ?? null),
    };

    const row = id
      ? await prisma.dietPlan.update({ where: { id }, data, include: PLAN_INCLUDE })
      : await prisma.dietPlan.create({ data, include: PLAN_INCLUDE });

    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertDraft failed:', error);
    res.status(500).json({
      error: 'Failed to save diet plan draft',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Sign (lock the snapshot, demote any prior ACTIVE / INTERIM) ─────

export const signPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as SignDietPlanBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }

    const existing = await prisma.dietPlan.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Diet plan not found' }); return; }
    if (existing.status !== 'DRAFT') {
      res.status(409).json({ error: `Plan is already ${existing.status}` });
      return;
    }

    // Snapshot any noteTemplate fields at sign-time.
    let templatedValues = existing.templatedValues;
    if (existing.noteTemplateId && existing.templatedValues) {
      try {
        const parsed = JSON.parse(existing.templatedValues);
        const fieldDefs = await snapshotTemplateFields(existing.noteTemplateId);
        templatedValues = JSON.stringify({
          _schema: fieldDefs ?? [],
          _values: parsed?._values ?? {},
        });
      } catch { /* leave the existing string as-is */ }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Demote any other ACTIVE plan + the census INTERIM plan to SUPERSEDED.
      await tx.dietPlan.updateMany({
        where: { admissionId: existing.admissionId, status: { in: ['ACTIVE', 'INTERIM'] }, NOT: { id } },
        data: { status: 'SUPERSEDED' },
      });
      return tx.dietPlan.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          signedAt: new Date(),
          signedBy: body.signedBy ?? req.user?.username ?? null,
          signedById: typeof req.user?.id === 'number' ? req.user.id : null,
          signatureId: body.signatureId,
          templatedValues,
        },
        include: PLAN_INCLUDE,
      });
    });

    await auditLog(req, {
      module: 'dietetics',
      action: 'STATUS_CHANGE',
      entityType: 'DietPlan',
      entityId: result.id,
      payload: { admissionId: result.admissionId, from: 'DRAFT', to: 'ACTIVE' },
    });

    await syncOrdersAfterPlanChange(result.admissionId);

    res.status(200).json(result);
  } catch (error) {
    console.error('[dietetics] signPlan failed:', error);
    res.status(500).json({
      error: 'Failed to sign diet plan',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── End plan (manual stop) ─────────────────────────────────────────

export const endPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.dietPlan.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Diet plan not found' }); return; }
    const updated = await prisma.dietPlan.update({
      where: { id },
      data: { status: 'ENDED', endDate: new Date() },
    });
    await auditLog(req, {
      module: 'dietetics',
      action: 'STATUS_CHANGE',
      entityType: 'DietPlan',
      entityId: id,
      payload: { from: existing.status, to: 'ENDED' },
    });
    await syncOrdersAfterPlanChange(updated.admissionId);
    res.status(200).json(updated);
  } catch (error) {
    console.error('[dietetics] endPlan failed:', error);
    res.status(500).json({ error: 'Failed to end diet plan' });
  }
};

// ─── Dietician queue ────────────────────────────────────────────────

/**
 * GET /api/dietetics/queue
 *
 * Returns the buckets the dietitian acts on:
 *   • pending  — admitted, no signed (ACTIVE) plan yet, oldest first (24h SLA).
 *                Rows on an INTERIM census diet carry `interimDiet`.
 *   • reassess — low-intake flag in the last 48h
 *   • check    — current plan flagged "needs check"
 *   • active   — all currently-active plans, for browsing
 */
export const getQueue = async (_req: Request, res: Response): Promise<void> => {
  try {
    const admitted = await prisma.ipdAdmission.findMany({
      where: { status: 'admitted' },
      select: {
        id: true, admissionNo: true, prn: true, admissionDate: true,
        department: true, diagnosis: true, admittingDoctor: true,
        ward: { select: { wardName: true } },
        bed: { select: { bedNumber: true } },
      },
      take: 500,
    });
    const admissionIds = admitted.map((a) => a.id);

    const currentPlans = await prisma.dietPlan.findMany({
      where: { admissionId: { in: admissionIds }, status: { in: ['ACTIVE', 'INTERIM'] } },
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const activeMap = new Map<string, (typeof currentPlans)[number]>();
    const interimMap = new Map<string, (typeof currentPlans)[number]>();
    for (const p of currentPlans) {
      const map = p.status === 'ACTIVE' ? activeMap : interimMap;
      if (!map.has(p.admissionId)) map.set(p.admissionId, p);
    }

    // Reassess if any intake row in last 48h was a negativeFlag.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const flaggedOrders = await prisma.mealIntake.findMany({
      where: { negativeFlag: true, recordedAt: { gte: twoDaysAgo } },
      select: { mealOrder: { select: { admissionId: true } } },
    });
    const reassessNeeded = new Set(flaggedOrders.map((f) => f.mealOrder.admissionId));

    // Patient name / age / sex for the worklist (PatientDetails is keyed by PRN).
    const ctx = await loadPatientContext({ admissionIds });
    const ctxById = new Map(ctx.map((c) => [c.admissionId, c]));

    const row = (a: (typeof admitted)[number]) => {
      const c = ctxById.get(a.id);
      return {
        id: a.id, admissionNo: a.admissionNo, prn: a.prn, admissionDate: a.admissionDate,
        department: a.department, diagnosis: a.diagnosis, admittingDoctor: a.admittingDoctor,
        wardName: a.ward?.wardName ?? null, bedNumber: a.bed?.bedNumber ?? null,
        patientName: c?.patientName ?? null, age: c?.age ?? null, sex: c?.sex ?? null,
      };
    };
    const admById = new Map(admitted.map((a) => [a.id, a]));

    const pending = [];
    const reassess = [];
    const check = [];
    for (const a of admitted) {
      const active = activeMap.get(a.id);
      const interim = interimMap.get(a.id);
      if (!active) {
        pending.push({
          ...row(a),
          interimDiet: interim ? { code: interim.diet.code, name: interim.diet.name } : null,
        });
      } else if (reassessNeeded.has(a.id)) {
        reassess.push(row(a));
      }
      const current = active ?? interim;
      if (current?.needsCheck) check.push({ ...row(a), checkNote: current.checkNote });
    }
    pending.sort((x, y) => x.admissionDate.getTime() - y.admissionDate.getTime());

    res.status(200).json({
      pending,
      reassess,
      check,
      // Each active plan carries its patient row so the worklist can show bed / name.
      active: Array.from(activeMap.values()).map((p) => {
        const a = admById.get(p.admissionId);
        return { ...p, patient: a ? row(a) : null };
      }),
    });
  } catch (error) {
    console.error('[dietetics] getQueue failed:', error);
    res.status(500).json({ error: 'Failed to load dietician queue' });
  }
};
