import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.26 / Phase 5i — Lab/Radiology amendment / rejection / repeat log.
// Backs PSQ-002, PSQ-003, LAB-001, RAD-003. Denominators come from
// InvestigationResult counts (already populated by the existing lab/rad
// controllers); this table holds the numerator events.

const VALID_TYPES = ['lab_amended', 'rad_amended', 'lab_sample_rejected', 'rad_repeat'] as const;

function deriveMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface CreateBody {
  eventType?: string;
  observedAt?: string;
  prn?: string | null;
  testName?: string | null;
  reason?: string | null;
}

export const createLabRadEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as CreateBody;
    if (!body.eventType || !VALID_TYPES.includes(body.eventType as typeof VALID_TYPES[number])) {
      res.status(400).json({ message: `'eventType' must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    const observedAt = body.observedAt ? new Date(body.observedAt) : new Date();
    if (Number.isNaN(observedAt.getTime())) {
      res.status(400).json({ message: "'observedAt' must be a valid date" });
      return;
    }

    const row = await prisma.qualityLabRadEvent.create({
      data: {
        eventType: body.eventType,
        observedAt, period: deriveMonth(observedAt),
        prn: body.prn ?? null,
        testName: body.testName ?? null,
        reason: body.reason ?? null,
        reporter: req.user?.username ?? null,
        reporterId: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'quality-lab-rad', action: 'CREATE', entityType: 'QualityLabRadEvent',
      entityId: String(row.id),
      payload: { eventType: row.eventType, period: row.period },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[quality-lab-rad] create failed:', error);
    res.status(500).json({ message: 'Failed to record event' });
  }
};

export const listLabRadEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventType, period, prn } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (eventType) where['eventType'] = eventType;
    if (period) where['period'] = period;
    if (prn) where['prn'] = prn;
    const rows = await prisma.qualityLabRadEvent.findMany({
      where, orderBy: { observedAt: 'desc' }, take: 500,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-lab-rad] list failed:', error);
    res.status(500).json({ message: 'Failed to load events' });
  }
};

export const deleteLabRadEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.qualityLabRadEvent.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Event not found' }); return; }
    await prisma.qualityLabRadEvent.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-lab-rad', action: 'DELETE', entityType: 'QualityLabRadEvent',
      entityId: String(id), payload: { eventType: ex.eventType },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-lab-rad] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete event' });
  }
};
