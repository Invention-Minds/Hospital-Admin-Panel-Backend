import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { getQiDef } from './quality-indicator-catalogue';

// Phase 9.26 / Phase 5a — Generic audit observation log.
//
// Single table backing ~30 indicators whose formula is "compliant
// observations / total observations × 100" — hand hygiene, BMW, surgical
// safety checklist, MRD audits, HR training compliance, etc. Auto-source
// is in quality-indicator-auto-source.ts and counts per (qiCode, period).

// ─── Period helper ─────────────────────────────────────────────────────
function deriveMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Create ────────────────────────────────────────────────────────────

interface CreateBody {
  qiCode?: string;
  observedAt?: string;
  location?: string | null;
  checkpointKey?: string | null;
  checkpointLabel?: string | null;
  compliant?: boolean;
  notes?: string | null;
}

export const createObservation = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as CreateBody;
    if (!body.qiCode || typeof body.compliant !== 'boolean') {
      res.status(400).json({ message: "Fields 'qiCode' and 'compliant' (boolean) are required" });
      return;
    }
    const def = getQiDef(body.qiCode);
    if (!def) {
      res.status(400).json({ message: `Unknown qiCode: ${body.qiCode}` });
      return;
    }
    const observedAt = body.observedAt ? new Date(body.observedAt) : new Date();
    if (Number.isNaN(observedAt.getTime())) {
      res.status(400).json({ message: "'observedAt' must be a valid ISO date" });
      return;
    }

    const row = await prisma.qualityAuditObservation.create({
      data: {
        qiCode: body.qiCode,
        observedAt,
        period: deriveMonth(observedAt),
        location: body.location ?? null,
        checkpointKey: body.checkpointKey ?? null,
        checkpointLabel: body.checkpointLabel ?? null,
        compliant: body.compliant,
        notes: body.notes ?? null,
        auditor: req.user?.username ?? null,
        auditorId: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await auditLog(req, {
      module: 'quality-audit', action: 'CREATE', entityType: 'QualityAuditObservation',
      entityId: String(row.id),
      payload: { qiCode: row.qiCode, period: row.period, compliant: row.compliant },
    });

    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[quality-audit] create failed:', error);
    res.status(500).json({ message: 'Failed to record observation' });
  }
};

// ─── List + per-period summary ─────────────────────────────────────────

export const listObservations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qiCode, period, auditor, location } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (qiCode) where['qiCode'] = qiCode;
    if (period) where['period'] = period;
    if (auditor) where['auditor'] = auditor;
    if (location) where['location'] = { contains: location };

    const rows = await prisma.qualityAuditObservation.findMany({
      where,
      orderBy: { observedAt: 'desc' },
      take: 500,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-audit] list failed:', error);
    res.status(500).json({ message: 'Failed to load observations' });
  }
};

/** Period summary — counts per qiCode, useful for the inbox + auto-source preview. */
export const periodSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const period = (req.query['period'] as string | undefined) ?? deriveMonth(new Date());
    const groups = await prisma.qualityAuditObservation.groupBy({
      by: ['qiCode', 'compliant'],
      where: { period },
      _count: { _all: true },
    });
    // Roll up to { qiCode: { total, compliant } }
    const rolled: Record<string, { total: number; compliant: number }> = {};
    for (const g of groups) {
      const k = g.qiCode;
      if (!rolled[k]) rolled[k] = { total: 0, compliant: 0 };
      rolled[k].total += g._count._all;
      if (g.compliant) rolled[k].compliant += g._count._all;
    }
    res.status(200).json({ period, data: rolled });
  } catch (error) {
    console.error('[quality-audit] summary failed:', error);
    res.status(500).json({ message: 'Failed to load period summary' });
  }
};

// ─── Delete (typo / wrong entry) ───────────────────────────────────────

export const deleteObservation = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.qualityAuditObservation.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Observation not found' }); return; }
    await prisma.qualityAuditObservation.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-audit', action: 'DELETE', entityType: 'QualityAuditObservation',
      entityId: String(id),
      payload: { qiCode: existing.qiCode, period: existing.period },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-audit] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete observation' });
  }
};
