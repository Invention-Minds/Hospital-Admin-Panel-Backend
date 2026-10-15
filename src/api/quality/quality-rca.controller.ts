import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { resolveTargetRole } from '../../service/role-alias';
import { RULE_CATALOGUE } from '../incident/rule-catalogue';
import { raiseAutoIncident } from '../incident/incident.controller';
import type { Chapter } from './quality-indicator-catalogue';

// Phase 9.26 / Phase 3 — Quality Indicator RCA workflow.
//
// One QualityIndicatorRca per QualityIndicatorRecord (the relation is 1-1 on
// recordId). Created automatically on Red/Critical capture when the indicator's
// rcaRequiredRule says so (see ensureRcaForRecord below), then edited via the
// PUT endpoint. Saving an RCA does NOT change the record status — that's a
// deliberate split, mirroring the Incident ↔ IncidentCapa decoupling.

// ─── Internal helper: create-if-missing for the record ──────────────────
//
// Called from captureRecord and from the auto-source cron after the record
// is upserted. Idempotent thanks to the @unique constraint on recordId; if a
// row exists, we leave it alone (don't overwrite owner-filled fields).

export async function ensureRcaForRecord(opts: {
  recordId: number;
  qiCode: string;
  escalationOwner: string;
  notifyTargetRole?: string;
}): Promise<{ created: boolean; rcaId?: number }> {
  try {
    const existing = await prisma.qualityIndicatorRca.findUnique({
      where: { recordId: opts.recordId },
      select: { id: true },
    });
    if (existing) return { created: false, rcaId: existing.id };

    const row = await prisma.qualityIndicatorRca.create({
      data: {
        recordId: opts.recordId,
        owner: opts.escalationOwner,
        status: 'open',
      },
    });

    // Best-effort notification — alias resolves to a real role (or falls
    // back to the literal alias if no RoleAlias row exists yet).
    try {
      const targetRole = await resolveTargetRole(opts.notifyTargetRole ?? opts.escalationOwner);
      await prisma.notification.create({
        data: {
          type: 'qi_rca_opened',
          title: `RCA required · ${opts.qiCode}`,
          message: `A new quality-indicator RCA was opened for ${opts.qiCode}.`,
          status: 'unread',
          targetRole,
          isCritical: false,
          entityId: 0,
          entityType: `QualityIndicatorRca:${row.id}`,
        },
      });
    } catch (err) {
      console.warn('[qi-rca:notify] failed:', (err as Error).message);
    }

    return { created: true, rcaId: row.id };
  } catch (err) {
    console.warn('[qi-rca:ensure] failed:', (err as Error).message);
    return { created: false };
  }
}

// ─── Phase 3 — bridge: critical QI capture → auto-incident ─────────────
//
// When a QI record lands as 'critical', also raise an incident so the safety
// inbox surfaces it. Best-effort — failures are swallowed (the RCA workflow
// still proceeds even if the incident bridge fails).

// ─── Phase 4 — trend check hook (called after record upsert) ───────────
//
// Looks up the previous period's record, runs evaluateTrend, and if the
// indicator's rcaRequiredRule is trend-class, opens an RCA + fires a
// "trend breach" notification. Best-effort; failures are swallowed so the
// caller's main flow (capture / cron sweep) is never blocked.

import { evaluateTrend, shouldCreateRcaFromTrend, previousPeriod } from './quality-status-engine';

export async function checkTrendForRecord(opts: {
  indicatorId: number;
  qiCode: string;
  recordId: number;
  recordStatus: 'green' | 'amber' | 'red' | 'critical';
  period: string;
  rcaRequiredRule: string;
  escalationOwner: string;
}): Promise<{ trendBreach: boolean; rcaCreated: boolean }> {
  try {
    const prevKey = previousPeriod(opts.period);
    if (!prevKey) return { trendBreach: false, rcaCreated: false };

    const prev = await prisma.qualityIndicatorRecord.findUnique({
      where: { indicatorId_period: { indicatorId: opts.indicatorId, period: prevKey } },
      select: { status: true },
    });

    const trend = evaluateTrend(opts.recordStatus, prev as { status: 'green' | 'amber' | 'red' | 'critical' } | null);
    if (!trend) return { trendBreach: false, rcaCreated: false };

    if (!shouldCreateRcaFromTrend(opts.rcaRequiredRule as never, trend)) {
      return { trendBreach: true, rcaCreated: false };
    }

    const ensured = await ensureRcaForRecord({
      recordId: opts.recordId,
      qiCode: opts.qiCode,
      escalationOwner: opts.escalationOwner,
    });

    // Loud bell — trend breach is one of the strongest QI signals. Only on
    // the first open; re-captures of the same period must not re-notify.
    if (!ensured.created) return { trendBreach: true, rcaCreated: false };
    try {
      const targetRole = await resolveTargetRole(opts.escalationOwner);
      await prisma.notification.create({
        data: {
          type: 'qi_trend_breach',
          title: `Trend breach · ${opts.qiCode}`,
          message: `${opts.qiCode} was Red/Critical for two consecutive periods (latest: ${opts.period}).`,
          status: 'unread',
          targetRole,
          isCritical: true,
          entityId: 0,
          entityType: `QualityIndicatorRcaTrend:${ensured.rcaId ?? opts.recordId}`,
        },
      });
    } catch (err) {
      console.warn('[qi-trend:notify] failed:', (err as Error).message);
    }

    return { trendBreach: true, rcaCreated: ensured.created };
  } catch (err) {
    console.warn('[qi-trend:check] failed:', (err as Error).message);
    return { trendBreach: false, rcaCreated: false };
  }
}

export async function bridgeCriticalQiToIncident(opts: {
  qiCode: string;
  chapter: Chapter;
  indicatorName: string;
  period: string;
  calculatedValue: number;
  unit: string;
  nabhClause?: string | null;
  criticalRule?: string | null;
}): Promise<void> {
  try {
    const def = RULE_CATALOGUE['QI_CRITICAL_BREACH'];
    // Honour the runtime IncidentRule toggle (same as raiseByRule).
    const rule = await prisma.incidentRule.findUnique({ where: { key: def.key } }).catch(() => null);
    if (rule && rule.isActive === false) return;
    const ctx = {
      extras: {
        qiCode: opts.qiCode,
        chapter: opts.chapter,
        indicator: opts.indicatorName,
        period: opts.period,
        value: opts.calculatedValue,
        unit: opts.unit,
        criticalTrigger: opts.criticalRule ?? null,
        nabhClause: opts.nabhClause ?? null,
      },
    };
    // qiCode + qiPeriod let raiseAutoIncident dedupe per indicator-period
    // (no patient/encounter context here); title carries the period.
    await raiseAutoIncident({
      ruleKey: def.key,
      category: def.category,
      severity: def.defaultSeverity,
      nabhClause: def.nabhClause,
      title: `QI critical breach: ${opts.qiCode} (${opts.period})`,
      description: def.buildDescription(ctx),
      qiCode: opts.qiCode,
      qiPeriod: opts.period,
    });
  } catch (err) {
    console.warn('[qi-rca:incident-bridge] failed:', (err as Error).message);
  }
}

// ─── List + stats ───────────────────────────────────────────────────────

function findRcaBucket(where: Record<string, unknown>, take: number) {
  return prisma.qualityIndicatorRca.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      record: {
        select: {
          id: true, qiCode: true, period: true, calculatedValue: true,
          status: true, severity: true, benchmarkUsed: true,
          indicator: { select: { name: true, chapter: true, department: true, unit: true, escalationOwner: true } },
        },
      },
    },
    take,
  });
}

export const listRcas = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, owner, qiCode, overdue } = req.query as Record<string, string | undefined>;

    if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    const where: Record<string, unknown> = {};
    if (owner) where['owner'] = owner;
    if (qiCode) where['record'] = { qiCode };
    if (overdue === 'true') where['dueDate'] = { lt: new Date() };

    // Workflow order (open → in_progress → closed), queried bucket by bucket
    // so the cap can only ever drop closed rows, never open ones.
    let buckets: string[] = status ? [status] : [...VALID_STATUSES];
    if (overdue === 'true') buckets = buckets.filter((s) => s !== 'closed');

    const LIMIT = 500;
    const rows: Array<Awaited<ReturnType<typeof findRcaBucket>>[number]> = [];
    for (const s of buckets) {
      if (rows.length >= LIMIT) break;
      rows.push(...await findRcaBucket({ ...where, status: s }, LIMIT - rows.length));
    }
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[qi-rca] list failed:', error);
    res.status(500).json({ message: 'Failed to load RCAs' });
  }
};

export const getRcaStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [byStatus, overdueCount, total] = await Promise.all([
      prisma.qualityIndicatorRca.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.qualityIndicatorRca.count({
        where: { status: { not: 'closed' }, dueDate: { lt: new Date() } },
      }),
      prisma.qualityIndicatorRca.count(),
    ]);
    res.status(200).json({
      total,
      overdue: overdueCount,
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    });
  } catch (error) {
    console.error('[qi-rca] stats failed:', error);
    res.status(500).json({ message: 'Failed to load RCA stats' });
  }
};

export const getRca = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }

    const rca = await prisma.qualityIndicatorRca.findUnique({
      where: { id },
      include: {
        record: {
          include: {
            indicator: { select: {
              qiCode: true, name: true, chapter: true, department: true,
              unit: true, direction: true, escalationOwner: true,
              numeratorDef: true, denominatorDef: true, criticalRule: true,
            } },
          },
        },
      },
    });
    if (!rca) { res.status(404).json({ message: 'RCA not found' }); return; }
    res.status(200).json({ data: rca });
  } catch (error) {
    console.error('[qi-rca] detail failed:', error);
    res.status(500).json({ message: 'Failed to load RCA' });
  }
};

// ─── Update (PUT) — same shape as incident CAPA ─────────────────────────

interface RcaBody {
  immediateActions?: string | null;
  why1?: string | null; why2?: string | null; why3?: string | null;
  why4?: string | null; why5?: string | null;
  rootCause?: string | null;
  correctiveActions?: string | null;
  preventiveActions?: string | null;
  owner?: string | null;
  ownerId?: number | null;
  dueDate?: string | null;
  completedAt?: string | null;
  effectivenessReview?: string | null;
  effectivenessReviewAt?: string | null;
  status?: 'open' | 'in_progress' | 'closed';
}

const VALID_STATUSES = ['open', 'in_progress', 'closed'] as const;

export const updateRca = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }

    const body = (req.body ?? {}) as RcaBody;
    const existing = await prisma.qualityIndicatorRca.findUnique({
      where: { id },
      select: { id: true, status: true, rootCause: true, correctiveActions: true, preventiveActions: true, completedAt: true },
    });
    if (!existing) { res.status(404).json({ message: 'RCA not found' }); return; }

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    // Dates: undefined = leave as is, '' / null = clear, otherwise must parse.
    const dates: Record<string, Date | null | undefined> = {};
    for (const key of ['dueDate', 'completedAt', 'effectivenessReviewAt'] as const) {
      const raw = body[key];
      if (raw === undefined) continue;
      if (raw === null || raw === '') { dates[key] = null; continue; }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ message: `Invalid date for '${key}'` });
        return;
      }
      dates[key] = d;
    }

    // Closing requires a documented root cause and at least one action plan.
    if (body.status === 'closed' && existing.status !== 'closed') {
      const pick = (k: 'rootCause' | 'correctiveActions' | 'preventiveActions') =>
        (body[k] !== undefined ? body[k] : existing[k])?.trim() ?? '';
      if (!pick('rootCause')) {
        res.status(400).json({ message: 'Root cause is required before closing the RCA' });
        return;
      }
      if (!pick('correctiveActions') && !pick('preventiveActions')) {
        res.status(400).json({ message: 'Corrective or preventive actions are required before closing the RCA' });
        return;
      }
    }

    const data: Record<string, unknown> = {
      immediateActions: body.immediateActions ?? undefined,
      why1: body.why1 ?? undefined, why2: body.why2 ?? undefined,
      why3: body.why3 ?? undefined, why4: body.why4 ?? undefined, why5: body.why5 ?? undefined,
      rootCause: body.rootCause ?? undefined,
      correctiveActions: body.correctiveActions ?? undefined,
      preventiveActions: body.preventiveActions ?? undefined,
      owner: body.owner ?? undefined,
      ownerId: body.ownerId ?? undefined,
      effectivenessReview: body.effectivenessReview ?? undefined,
      ...dates,
    };
    if (body.status) data['status'] = body.status;
    // Auto-stamp completedAt when transitioning to closed and not already set.
    if (body.status === 'closed' && !dates['completedAt'] && !(dates['completedAt'] === undefined && existing.completedAt)) {
      data['completedAt'] = new Date();
    }

    const row = await prisma.qualityIndicatorRca.update({ where: { id }, data });

    await auditLog(req, {
      module: 'quality-rca', action: 'UPDATE', entityType: 'QualityIndicatorRca',
      entityId: String(row.id),
      payload: { id, status: body.status ?? existing.status },
    });

    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[qi-rca] update failed:', error);
    res.status(500).json({ message: 'Failed to update RCA' });
  }
};
