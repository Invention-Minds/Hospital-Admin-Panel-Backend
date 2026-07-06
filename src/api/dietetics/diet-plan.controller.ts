import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { snapshotTemplateFields } from '../note-template/note-template.controller';

/**
 * DietPlan controller — clinical surface for the dietician.
 *
 * Lifecycle per admission:
 *   DRAFT → ACTIVE (signed) → SUPERSEDED (by a newer plan) | ENDED
 *
 * Re-assessment creates a new DietPlan row and demotes any prior ACTIVE row
 * to SUPERSEDED. So the table is an append-only history; queries that need
 * "current plan" look up the most-recent ACTIVE row.
 */

interface UpsertDietPlanBody {
  admissionId: string;
  dietMasterId: string;
  startDate?: string;
  endDate?: string;
  npoUntil?: string;
  restrictionsSnapshot?: string[];
  allergensSnapshot?: string[];
  notesForKitchen?: string;
  noteTemplateId?: string;
  templatedValueMap?: Record<string, unknown>;
  reassessmentReason?: string;
}

interface SignDietPlanBody {
  signatureId: string;
  signedBy?: string;
}

// ─── Reads ──────────────────────────────────────────────────────────

export const getCurrentForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const row = await prisma.dietPlan.findFirst({
      where: { admissionId, status: 'ACTIVE' },
      orderBy: { signedAt: 'desc' },
      include: { diet: true },
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
      include: { diet: true },
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

    const data = {
      admissionId: body.admissionId,
      dietMasterId: body.dietMasterId,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : null,
      npoUntil: body.npoUntil ? new Date(body.npoUntil) : null,
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
      status: 'DRAFT',
      createdBy: id ? undefined : (req.user?.username ?? null),
    };

    const row = id
      ? await prisma.dietPlan.update({ where: { id }, data })
      : await prisma.dietPlan.create({ data });

    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertDraft failed:', error);
    res.status(500).json({
      error: 'Failed to save diet plan draft',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Sign (lock the snapshot, demote any prior ACTIVE) ──────────────

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
      // Demote any other ACTIVE plan for this admission to SUPERSEDED.
      await tx.dietPlan.updateMany({
        where: { admissionId: existing.admissionId, status: 'ACTIVE', NOT: { id } },
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
      });
    });

    await auditLog(req, {
      module: 'dietetics',
      action: 'STATUS_CHANGE',
      entityType: 'DietPlan',
      entityId: result.id,
      payload: { admissionId: result.admissionId, from: 'DRAFT', to: 'ACTIVE' },
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[dietetics] signPlan failed:', error);
    res.status(500).json({
      error: 'Failed to sign diet plan',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── End plan (manual stop, e.g. patient discharged) ────────────────

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
 * Returns three buckets the dietician acts on:
 *   • pending — admitted patients with no ACTIVE diet plan yet (oldest first
 *     so the 24h SLA is visible)
 *   • reassess — admissions with low-intake flags or stale plans
 *   • active — all currently-active plans, for browsing
 */
export const getQueue = async (_req: Request, res: Response): Promise<void> => {
  try {
    const admitted = await prisma.ipdAdmission.findMany({
      where: { status: 'admitted' },
      select: {
        id: true, admissionNo: true, prn: true, admissionDate: true,
        department: true, diagnosis: true, admittingDoctor: true,
      },
      take: 500,
    });
    const admissionIds = admitted.map((a) => a.id);

    const activePlans = await prisma.dietPlan.findMany({
      where: { admissionId: { in: admissionIds }, status: 'ACTIVE' },
      include: { diet: true },
      orderBy: { signedAt: 'desc' },
    });
    const activeMap = new Map(activePlans.map((p) => [p.admissionId, p]));

    // Reassess if any intake row in last 48h was a negativeFlag.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const flaggedOrders = await prisma.mealIntake.findMany({
      where: { negativeFlag: true, recordedAt: { gte: twoDaysAgo } },
      select: { mealOrder: { select: { admissionId: true } } },
    });
    const reassessNeeded = new Set(flaggedOrders.map((f) => f.mealOrder.admissionId));

    const pending: typeof admitted = [];
    const reassess: typeof admitted = [];
    for (const a of admitted) {
      if (!activeMap.has(a.id)) pending.push(a);
      else if (reassessNeeded.has(a.id)) reassess.push(a);
    }
    pending.sort((a, b) => a.admissionDate.getTime() - b.admissionDate.getTime());

    res.status(200).json({
      pending,
      reassess,
      active: Array.from(activeMap.values()),
    });
  } catch (error) {
    console.error('[dietetics] getQueue failed:', error);
    res.status(500).json({ error: 'Failed to load dietician queue' });
  }
};
