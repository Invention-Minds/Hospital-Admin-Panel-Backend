import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { getQiDef } from './quality-indicator-catalogue';

// Phase 9.26 / Phase 5c — Manual monthly denominators.
//
// Backs ~15 indicators whose denominator is something no existing model
// tracks: total medication administrations, total surgeries, total
// transfusions, total at-risk admitted patients, total encounters, etc.
// One row per (qiCode, period). Auto-source pulls these; when missing the
// indicator is silently skipped (no-data).

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

interface UpsertBody {
  qiCode?: string;
  period?: string;
  value?: number;
  notes?: string | null;
}

// ─── Upsert ────────────────────────────────────────────────────────────

export const upsertDenominator = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as UpsertBody;
    if (!body.qiCode || !getQiDef(body.qiCode)) {
      res.status(400).json({ message: "Field 'qiCode' is required and must be a valid catalogue code" });
      return;
    }
    if (!body.period || !PERIOD_RE.test(body.period)) {
      res.status(400).json({ message: "'period' must be YYYY-MM" });
      return;
    }
    if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0) {
      res.status(400).json({ message: "'value' must be a non-negative number" });
      return;
    }

    const username = req.user?.username ?? null;
    const userId = typeof req.user?.id === 'number' ? req.user.id : null;

    const row = await prisma.qualityMonthlyDenominator.upsert({
      where: { qiCode_period: { qiCode: body.qiCode, period: body.period } },
      create: {
        qiCode: body.qiCode,
        period: body.period,
        value: body.value,
        notes: body.notes ?? null,
        capturedBy: username,
        capturedById: userId,
      },
      update: {
        value: body.value,
        notes: body.notes ?? null,
        capturedBy: username,
        capturedById: userId,
      },
    });

    await auditLog(req, {
      module: 'quality-denominator', action: 'UPSERT', entityType: 'QualityMonthlyDenominator',
      entityId: String(row.id),
      payload: { qiCode: row.qiCode, period: row.period, value: row.value },
    });

    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[quality-denominator] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save denominator' });
  }
};

// ─── List + per-period summary ─────────────────────────────────────────

export const listDenominators = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qiCode, period } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (qiCode) where['qiCode'] = qiCode;
    if (period) where['period'] = period;

    const rows = await prisma.qualityMonthlyDenominator.findMany({
      where,
      orderBy: [{ period: 'desc' }, { qiCode: 'asc' }],
      take: 500,
    });

    // Surface a small per-indicator "untagged incidents" hint so a manager can
    // see whether reporter tagging is keeping pace.
    let untaggedHint: Record<string, number> | undefined;
    if (qiCode === 'PSQ-016' && period && PERIOD_RE.test(period)) {
      const [, yr, mo] = PERIOD_RE.exec(period)!;
      const start = new Date(Number(yr), Number(mo) - 1, 1, 0, 0, 0);
      const end = new Date(Number(yr), Number(mo), 0, 23, 59, 59, 999);
      const untagged = await prisma.incident.count({
        where: { category: 'medication', qiCode: null, reportedAt: { gte: start, lte: end } },
      });
      untaggedHint = { 'medication-untagged': untagged };
    }

    res.status(200).json({ data: rows, total: rows.length, hints: untaggedHint });
  } catch (error) {
    console.error('[quality-denominator] list failed:', error);
    res.status(500).json({ message: 'Failed to load denominators' });
  }
};

export const deleteDenominator = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.qualityMonthlyDenominator.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Denominator not found' }); return; }
    await prisma.qualityMonthlyDenominator.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-denominator', action: 'DELETE', entityType: 'QualityMonthlyDenominator',
      entityId: String(id),
      payload: { qiCode: existing.qiCode, period: existing.period },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-denominator] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete denominator' });
  }
};
