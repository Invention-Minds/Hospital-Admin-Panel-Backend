import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { getQiDef } from './quality-indicator-catalogue';
import { TAT_TARGET_MINUTES } from './quality-indicator-auto-source';

// Phase 9.26 / Phase 5e — Generic TAT event capture.
//
// One row per (start, end) pair. Duration is computed at write time;
// withinTarget is computed against the static per-indicator target in
// quality-indicator-auto-source.ts. Auto-source uses the row's
// durationMinutes / withinTarget — no recomputation at month-end.

const VALID_TAT_CODES = new Set(Object.keys(TAT_TARGET_MINUTES));

interface CreateBody {
  qiCode?: string;
  startedAt?: string;
  endedAt?: string;
  location?: string | null;
  notes?: string | null;
}

export const createTatEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as CreateBody;
    if (!body.qiCode || !getQiDef(body.qiCode)) {
      res.status(400).json({ message: "'qiCode' is required and must be a valid catalogue code" });
      return;
    }
    if (!VALID_TAT_CODES.has(body.qiCode)) {
      res.status(400).json({ message: `qiCode ${body.qiCode} is not a TAT-event indicator` });
      return;
    }
    if (!body.startedAt || !body.endedAt) {
      res.status(400).json({ message: "'startedAt' and 'endedAt' are required" });
      return;
    }
    const startedAt = new Date(body.startedAt);
    const endedAt = new Date(body.endedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      res.status(400).json({ message: "Timestamps must be valid ISO dates" });
      return;
    }
    if (endedAt < startedAt) {
      res.status(400).json({ message: "'endedAt' must be at or after 'startedAt'" });
      return;
    }

    const durationMinutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
    const target = TAT_TARGET_MINUTES[body.qiCode];
    const withinTarget = typeof target === 'number' ? durationMinutes <= target : null;

    const row = await prisma.qualityTatEvent.create({
      data: {
        qiCode: body.qiCode,
        startedAt, endedAt,
        durationMinutes,
        withinTarget,
        location: body.location ?? null,
        notes: body.notes ?? null,
        capturedBy: req.user?.username ?? null,
        capturedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await auditLog(req, {
      module: 'quality-tat-event', action: 'CREATE', entityType: 'QualityTatEvent',
      entityId: String(row.id),
      payload: { qiCode: row.qiCode, durationMinutes, withinTarget },
    });

    res.status(201).json({ data: row, targetMinutes: target ?? null });
  } catch (error) {
    console.error('[quality-tat] create failed:', error);
    res.status(500).json({ message: 'Failed to record TAT event' });
  }
};

export const listTatEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qiCode, from, to, location } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (qiCode) where['qiCode'] = qiCode;
    if (location) where['location'] = { contains: location };
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range['gte'] = new Date(from);
      if (to) range['lte'] = new Date(to);
      where['startedAt'] = range;
    }
    const rows = await prisma.qualityTatEvent.findMany({
      where, orderBy: { startedAt: 'desc' }, take: 500,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-tat] list failed:', error);
    res.status(500).json({ message: 'Failed to load TAT events' });
  }
};

export const deleteTatEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.qualityTatEvent.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Event not found' }); return; }
    await prisma.qualityTatEvent.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-tat-event', action: 'DELETE', entityType: 'QualityTatEvent',
      entityId: String(id), payload: { qiCode: ex.qiCode },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-tat] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete event' });
  }
};

/** Return the static target table so the UI can show "target = X min" hints. */
export const getTatTargets = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ data: TAT_TARGET_MINUTES });
};
