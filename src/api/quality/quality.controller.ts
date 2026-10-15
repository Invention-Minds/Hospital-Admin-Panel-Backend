import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { EXPIRED_DISCHARGE_TYPES, HOSPITAL_TZ, INVALID, parseDateInput } from './quality-input.util';

// Phase 9.26 / Phase 5 — Quality / NABH KPI dashboard.
//
// Read-only aggregations on top of every module we've already built:
//   • Safety        — incidents (Phase 9.24) by severity, category, NABH clause
//   • Clinical      — mortality, LAMA / DAMA, average LoS
//   • Timeliness    — % initial assessments / discharge summaries / critical-lab acks within SLA
//   • Experience    — NPS + complaint SLA compliance
//   • OT            — cancellation rate, on-time start, delay
//   • NABH Scorecard — incidents grouped by NABH clause (open vs total)

/**
 * Default range: last 30 days. YYYY-MM-DD params are IST calendar days —
 * `from` is start-of-day, `to` is end-of-day. Sends 400 and returns null on bad input.
 */
function parseRange(req: Request, res: Response): { from: Date; to: Date } | null {
  const fromQ = parseDateInput(req.query.from as string | undefined);
  const toQ = parseDateInput(req.query.to as string | undefined, true);
  if (fromQ === INVALID || toQ === INVALID) {
    res.status(400).json({ message: "'from' / 'to' must be valid dates (YYYY-MM-DD)" });
    return null;
  }
  const to = toQ ?? moment.tz(HOSPITAL_TZ).endOf('day').toDate();
  const from = fromQ ?? moment.tz(to, HOSPITAL_TZ).subtract(30, 'days').startOf('day').toDate();
  if (from > to) {
    res.status(400).json({ message: "'from' must be on or before 'to'" });
    return null;
  }
  return { from, to };
}
const round = (n: number): number => Math.round(n * 10) / 10;

// ─── Safety ──────────────────────────────────────────────────────────

export const safety = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to } = range;
    const where = { reportedAt: { gte: from, lte: to } };

    const [total, open, sentinel, bySeverity, byCategory, bySource, byNabh] = await Promise.all([
      prisma.incident.count({ where }),
      prisma.incident.count({ where: { ...where, status: { in: ['open', 'triaged', 'investigated', 'capa_in_progress'] } } }),
      prisma.incident.count({ where: { ...where, severity: 'sentinel' } }),
      prisma.incident.groupBy({ by: ['severity'], where, _count: { _all: true } }),
      prisma.incident.groupBy({ by: ['category'], where, _count: { _all: true } }),
      prisma.incident.groupBy({ by: ['source'], where, _count: { _all: true } }),
      prisma.incident.groupBy({ by: ['nabhClause'], where, _count: { _all: true } }),
    ]);
    const nearMiss = bySeverity.find((g) => g.severity === 'near_miss')?._count._all ?? 0;
    res.status(200).json({
      total, open, sentinel,
      nearMissRate: total > 0 ? round((nearMiss / total) * 100) : 0,
      bySeverity: Object.fromEntries(bySeverity.map((g) => [g.severity, g._count._all])),
      byCategory: Object.fromEntries(byCategory.map((g) => [g.category, g._count._all])),
      bySource: Object.fromEntries(bySource.map((g) => [g.source, g._count._all])),
      byNabh: Object.fromEntries(byNabh.filter((g) => g.nabhClause).map((g) => [g.nabhClause as string, g._count._all])),
      window: { from, to },
    });
  } catch (error) {
    console.error('[quality:safety] failed:', error);
    res.status(500).json({ message: 'Failed to load safety KPIs' });
  }
};

// ─── Clinical ────────────────────────────────────────────────────────

export const clinical = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to } = range;
    const [admissions, discharges, expired, lama, dama, dischargedWithLos] = await Promise.all([
      prisma.ipdAdmission.count({ where: { admissionDate: { gte: from, lte: to } } }),
      prisma.ipdDischarge.count({ where: { dischargeDate: { gte: from, lte: to } } }),
      prisma.ipdDischarge.count({ where: { dischargeDate: { gte: from, lte: to }, dischargeType: { in: EXPIRED_DISCHARGE_TYPES } } }),
      // IPD-only so ER LAMA/DAMA aren't divided by IPD discharges.
      prisma.lamaRecord.count({ where: { lamaTime: { gte: from, lte: to }, admissionId: { not: null } } }).catch(() => 0),
      prisma.damaRecord.count({ where: { dischargeTime: { gte: from, lte: to }, admissionId: { not: null } } }).catch(() => 0),
      // Row data needed for LoS; cap matches the auto-source sweep.
      prisma.ipdDischarge.findMany({
        where: { dischargeDate: { gte: from, lte: to } },
        select: { dischargeDate: true, admission: { select: { admissionDate: true } } },
        take: 20000,
      }),
    ]);
    const losSum = dischargedWithLos.reduce(
      (acc, d) => acc + (new Date(d.dischargeDate).getTime() - new Date(d.admission.admissionDate).getTime()) / 86_400_000,
      0,
    );
    const avgLosDays = dischargedWithLos.length > 0 ? round(losSum / dischargedWithLos.length) : 0;
    res.status(200).json({
      admissions, discharges, expired, lama, dama,
      mortalityRate: discharges > 0 ? round((expired / discharges) * 100) : 0,
      lamaRate: discharges > 0 ? round((lama / discharges) * 100) : 0,
      damaRate: discharges > 0 ? round((dama / discharges) * 100) : 0,
      avgLosDays,
      window: { from, to },
    });
  } catch (error) {
    console.error('[quality:clinical] failed:', error);
    res.status(500).json({ message: 'Failed to load clinical KPIs' });
  }
};

// ─── Process timeliness ──────────────────────────────────────────────

export const timeliness = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to } = range;

    // Denominators via count(); rows are fetched only for the candidates whose
    // timestamps must be diffed (Prisma can't filter on column arithmetic).
    const labWhere = { criticalFlag: true, isDeleted: false, reportedAt: { gte: from, lte: to } };
    const [admitTotal, dischTotal, labTotal, signedIa, signedDs, ackedLabs] = await Promise.all([
      prisma.ipdAdmission.count({ where: { admissionDate: { gte: from, lte: to } } }),
      prisma.ipdDischarge.count({ where: { dischargeDate: { gte: from, lte: to } } }),
      prisma.investigationResult.count({ where: labWhere }),
      // (1) Initial assessment consultant-signed within 24h of admission.
      prisma.ipdAdmission.findMany({
        where: {
          admissionDate: { gte: from, lte: to },
          initialAssessment: { status: 'CONSULTANT_SIGNED' },
        },
        select: { admissionDate: true, initialAssessment: { select: { consultantSignedAt: true, filledAt: true } } },
        take: 20000,
      }),
      // (2) Discharge summary clinician-signed within 24h of discharge.
      prisma.ipdDischarge.findMany({
        where: {
          dischargeDate: { gte: from, lte: to },
          summaryStatus: { in: ['SIGNED', 'DELIVERED'] },
          clinicianSignedAt: { not: null },
        },
        select: { dischargeDate: true, clinicianSignedAt: true },
        take: 20000,
      }),
      // (3) Critical labs acknowledged within 30 min.
      prisma.investigationResult.findMany({
        where: { ...labWhere, acknowledgedAt: { not: null } },
        select: { reportedAt: true, acknowledgedAt: true },
        take: 20000,
      }),
    ]);

    let iaWithin = 0;
    for (const a of signedIa) {
      // Legacy rows may lack consultantSignedAt — fall back to filledAt.
      const signedAt = a.initialAssessment?.consultantSignedAt ?? a.initialAssessment?.filledAt;
      if (!signedAt) continue;
      const diffH = (new Date(signedAt).getTime() - new Date(a.admissionDate).getTime()) / 3_600_000;
      if (diffH <= 24) iaWithin += 1;
    }
    let dsWithin = 0;
    for (const d of signedDs) {
      if (!d.clinicianSignedAt) continue;
      const diffH = (new Date(d.clinicianSignedAt).getTime() - new Date(d.dischargeDate).getTime()) / 3_600_000;
      if (diffH <= 24) dsWithin += 1;
    }
    let labWithin = 0;
    for (const l of ackedLabs) {
      if (!l.acknowledgedAt || !l.reportedAt) continue;
      const diffM = (new Date(l.acknowledgedAt).getTime() - new Date(l.reportedAt).getTime()) / 60_000;
      if (diffM <= 30) labWithin += 1;
    }

    const pct = (n: number, d: number): number => (d > 0 ? round((n / d) * 100) : 0);
    res.status(200).json({
      initialAssessmentWithin24h: { within: iaWithin, total: admitTotal, pct: pct(iaWithin, admitTotal) },
      dischargeSummarySignedWithin24h: { within: dsWithin, total: dischTotal, pct: pct(dsWithin, dischTotal) },
      criticalLabAckWithin30m: { within: labWithin, total: labTotal, pct: pct(labWithin, labTotal) },
      window: { from, to },
    });
  } catch (error) {
    console.error('[quality:timeliness] failed:', error);
    res.status(500).json({ message: 'Failed to load timeliness KPIs' });
  }
};

// ─── Patient experience (NPS + complaints) ──────────────────────────

export const experience = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to } = range;
    const npsGroups = await prisma.feedbackSurvey.groupBy({
      by: ['npsScore'],
      where: { status: 'completed', npsScore: { not: null }, respondedAt: { gte: from, lte: to } },
      _count: { _all: true },
    });
    let promoters = 0, passives = 0, detractors = 0;
    for (const g of npsGroups) {
      const s = g.npsScore;
      if (s === null) continue;
      const n = g._count._all;
      if (s >= 9) promoters += n;
      else if (s >= 7) passives += n;
      else detractors += n;
    }
    const surveyTotal = promoters + passives + detractors;
    const npsScore = surveyTotal > 0 ? Math.round(((promoters - detractors) / surveyTotal) * 100) : 0;

    const raised = { raisedAt: { gte: from, lte: to } };
    const [complaints, resolved, slaBreached, active] = await Promise.all([
      prisma.complaint.count({ where: raised }),
      prisma.complaint.count({ where: { ...raised, status: 'resolved' } }),
      // Breached = still open past SLA, or resolved after SLA.
      prisma.complaint.count({
        where: {
          ...raised,
          OR: [
            { slaDueAt: { lt: new Date() }, status: { not: 'resolved' } },
            { status: 'resolved', resolvedAt: { gt: prisma.complaint.fields.slaDueAt } },
          ],
        },
      }),
      prisma.complaint.count({ where: { ...raised, status: { in: ['open', 'acknowledged', 'escalated'] } } }),
    ]);

    res.status(200).json({
      nps: { score: npsScore, promoters, passives, detractors, total: surveyTotal },
      complaints: {
        total: complaints, resolved, slaBreached, active,
        slaCompliancePct: complaints > 0 ? round(((complaints - slaBreached) / complaints) * 100) : 100,
      },
      window: { from, to },
    });
  } catch (error) {
    console.error('[quality:experience] failed:', error);
    res.status(500).json({ message: 'Failed to load experience KPIs' });
  }
};

// ─── OT efficiency ───────────────────────────────────────────────────

export const otEfficiency = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to } = range;
    const [total, cancelled, started] = await Promise.all([
      prisma.otSchedule.count({ where: { plannedStart: { gte: from, lte: to } } }).catch(() => 0),
      // ot-schedule writes 'CANCELLED'; legacy rows may be lower-case.
      prisma.otSchedule.count({ where: { plannedStart: { gte: from, lte: to }, status: { in: ['CANCELLED', 'cancelled'] } } }).catch(() => 0),
      // Row data needed for delay maths.
      prisma.otSchedule.findMany({
        where: { plannedStart: { gte: from, lte: to }, actualStart: { not: null } },
        select: { plannedStart: true, actualStart: true },
        take: 20000,
      }).catch(() => [] as Array<{ plannedStart: Date; actualStart: Date | null }>),
    ]);
    let onTime = 0;
    let totalDelay = 0;
    for (const r of started) {
      if (!r.actualStart) continue;
      const diff = (new Date(r.actualStart).getTime() - new Date(r.plannedStart).getTime()) / 60_000;
      if (diff <= 15) onTime += 1;
      totalDelay += Math.max(0, diff);
    }
    res.status(200).json({
      total, cancelled, started: started.length,
      cancelRate: total > 0 ? round((cancelled / total) * 100) : 0,
      onTimePct: started.length > 0 ? round((onTime / started.length) * 100) : 0,
      avgDelayMin: started.length > 0 ? round(totalDelay / started.length) : 0,
      window: { from, to },
    });
  } catch (error) {
    console.error('[quality:ot] failed:', error);
    res.status(500).json({ message: 'Failed to load OT KPIs' });
  }
};

// ─── NABH chapter scorecard ──────────────────────────────────────────

export const nabhScorecard = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req, res);
    if (!range) return;
    const { from, to } = range;
    const groups = await prisma.incident.groupBy({
      by: ['nabhClause', 'status'],
      where: { reportedAt: { gte: from, lte: to }, nabhClause: { not: null } },
      _count: { _all: true },
    });
    // Roll up into { clause: { total, open, closed } }
    const byClause: Record<string, { total: number; open: number; closed: number; chapter: string }> = {};
    for (const g of groups) {
      const clause = g.nabhClause as string;
      const chapter = clause.split('.')[0] || clause;
      if (!byClause[clause]) byClause[clause] = { total: 0, open: 0, closed: 0, chapter };
      byClause[clause].total += g._count._all;
      if (g.status === 'closed' || g.status === 'cancelled') byClause[clause].closed += g._count._all;
      else byClause[clause].open += g._count._all;
    }
    // Sort by total desc.
    const data = Object.entries(byClause)
      .map(([clause, v]) => ({ clause, ...v }))
      .sort((a, b) => b.total - a.total);

    res.status(200).json({ data, window: { from, to } });
  } catch (error) {
    console.error('[quality:nabhScorecard] failed:', error);
    res.status(500).json({ message: 'Failed to load NABH scorecard' });
  }
};
