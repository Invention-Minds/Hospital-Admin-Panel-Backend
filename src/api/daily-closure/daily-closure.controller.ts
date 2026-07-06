import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 4 (WF-3) — IPD Daily Closure controller.
 *
 * One row per (admissionId, closureDate). Captures:
 *   • Doctor visit time + name (NABH COP.4)
 *   • Nursing summary + vitals digest
 *   • Attender satisfaction score + concerns (NABH PSQ.5)
 *   • Attender signature that locks the row for the day
 *
 * Negative-flag detection: if score ≤ 2 OR concerns has non-empty text the
 * row sets `negativeFlag=true`, surfacing it on the PSQ dashboard for
 * follow-up. (Auto-creating the PSQ ticket itself is Phase 9 — incident.)
 */

interface OpenClosureBody {
  admissionId: string;
  closureDate?: string; // ISO date — defaults to today
  doctorVisitedAt?: string;
  doctorVisitedBy?: string;
  nursingSummary?: string;
  vitalsSummary?: string;
}

interface SubmitClosureBody {
  satisfactionScore: number;
  concerns?: string;
  doctorVisitedAt?: string;
  doctorVisitedBy?: string;
  nursingSummary?: string;
  vitalsSummary?: string;
  attenderName: string;
  attenderRelation: string;
  attenderSignatureId: string;
}

/** Compute a midnight-anchored Date for the given input. */
function toClosureDate(input?: string): Date {
  const d = input ? new Date(input) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** POST /api/daily-closure — open a new closure row (or upsert). */
export const openClosure = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as OpenClosureBody;
    if (!body.admissionId) {
      res.status(400).json({ error: 'admissionId is required' });
      return;
    }
    const admission = await prisma.ipdAdmission.findUnique({ where: { id: body.admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }
    if (admission.status !== 'admitted') {
      res
        .status(400)
        .json({ error: `Admission status=${admission.status}; daily closure only applies to admitted patients` });
      return;
    }

    const closureDate = toClosureDate(body.closureDate);

    const row = await prisma.ipdDailyClosure.upsert({
      where: { admissionId_closureDate: { admissionId: body.admissionId, closureDate } },
      create: {
        admissionId: body.admissionId,
        closureDate,
        doctorVisitedAt: body.doctorVisitedAt ? new Date(body.doctorVisitedAt) : null,
        doctorVisitedBy: body.doctorVisitedBy ?? null,
        nursingSummary: body.nursingSummary ?? null,
        vitalsSummary: body.vitalsSummary ?? null,
        status: 'OPEN',
      },
      update: {
        doctorVisitedAt: body.doctorVisitedAt ? new Date(body.doctorVisitedAt) : undefined,
        doctorVisitedBy: body.doctorVisitedBy ?? undefined,
        nursingSummary: body.nursingSummary ?? undefined,
        vitalsSummary: body.vitalsSummary ?? undefined,
      },
    });

    await auditLog(req, {
      module: 'daily-closure',
      action: 'CREATE',
      entityType: 'IpdDailyClosure',
      entityId: row.id,
      payload: { admissionId: body.admissionId, closureDate: closureDate.toISOString() },
    });

    res.status(201).json(row);
  } catch (error) {
    console.error('[daily-closure] openClosure failed:', error);
    res.status(500).json({ error: 'Failed to open daily closure' });
  }
};

/** GET /api/daily-closure?admissionId=&date= — list or fetch latest. */
export const listClosures = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.query.admissionId as string | undefined;
    const date = req.query.date as string | undefined;
    const where: { admissionId?: string; closureDate?: Date } = {};
    if (admissionId) where.admissionId = admissionId;
    if (date) where.closureDate = toClosureDate(date);

    const rows = await prisma.ipdDailyClosure.findMany({
      where,
      orderBy: [{ closureDate: 'desc' }, { createdAt: 'desc' }],
      include: { admission: true },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[daily-closure] listClosures failed:', error);
    res.status(500).json({ error: 'Failed to list closures' });
  }
};

/** GET /api/daily-closure/:id */
export const getClosure = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.ipdDailyClosure.findUnique({
      where: { id: req.params.id },
      include: { admission: true },
    });
    if (!row) {
      res.status(404).json({ error: 'Daily closure not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[daily-closure] getClosure failed:', error);
    res.status(500).json({ error: 'Failed to fetch closure' });
  }
};

/** POST /api/daily-closure/:id/submit — attender signs, row locks. */
export const submitClosure = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as SubmitClosureBody;

    if (
      typeof body.satisfactionScore !== 'number' ||
      body.satisfactionScore < 1 ||
      body.satisfactionScore > 5
    ) {
      res.status(400).json({ error: 'satisfactionScore must be 1..5' });
      return;
    }
    if (!body.attenderName || !body.attenderRelation || !body.attenderSignatureId) {
      res.status(400).json({
        error: 'attenderName, attenderRelation, attenderSignatureId are all required',
      });
      return;
    }

    const row = await prisma.ipdDailyClosure.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Daily closure not found' });
      return;
    }
    if (row.status === 'CLOSED') {
      res.status(409).json({ error: 'Daily closure is already locked' });
      return;
    }

    const concernsTrimmed = body.concerns?.trim() || null;
    const negativeFlag = body.satisfactionScore <= 2 || !!concernsTrimmed;

    const updated = await prisma.ipdDailyClosure.update({
      where: { id },
      data: {
        satisfactionScore: body.satisfactionScore,
        concerns: concernsTrimmed,
        negativeFlag,
        doctorVisitedAt: body.doctorVisitedAt ? new Date(body.doctorVisitedAt) : undefined,
        doctorVisitedBy: body.doctorVisitedBy ?? undefined,
        nursingSummary: body.nursingSummary ?? undefined,
        vitalsSummary: body.vitalsSummary ?? undefined,
        attenderName: body.attenderName.trim(),
        attenderRelation: body.attenderRelation.trim(),
        attenderSignatureId: body.attenderSignatureId,
        closedAt: new Date(),
        closedBy: req.user?.username ?? null,
        closedById: typeof req.user?.id === 'number' ? req.user.id : null,
        status: 'CLOSED',
      },
    });

    await auditLog(req, {
      module: 'daily-closure',
      action: 'STATUS_CHANGE',
      entityType: 'IpdDailyClosure',
      entityId: updated.id,
      payload: {
        from: 'OPEN',
        to: 'CLOSED',
        satisfactionScore: body.satisfactionScore,
        negativeFlag,
      },
      notes: negativeFlag
        ? `Negative flag raised — score=${body.satisfactionScore}, concerns="${concernsTrimmed?.slice(0, 80) ?? ''}"`
        : undefined,
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[daily-closure] submitClosure failed:', error);
    res.status(500).json({ error: 'Failed to submit daily closure' });
  }
};
