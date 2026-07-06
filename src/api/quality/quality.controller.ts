import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.26 / Phase 5 — Quality / NABH KPI dashboard.
//
// Read-only aggregations on top of every module we've already built:
//   • Safety        — incidents (Phase 9.24) by severity, category, NABH clause
//   • Clinical      — mortality, LAMA / DAMA, average LoS
//   • Timeliness    — % initial assessments / discharge summaries / critical-lab acks within SLA
//   • Experience    — NPS + complaint SLA compliance
//   • OT            — cancellation rate, on-time start, delay
//   • NABH Scorecard — incidents grouped by NABH clause (open vs total)

/** Default range: last 30 days. */
function parseRange(req: Request): { from: Date; to: Date } {
  const to = req.query.to ? new Date(req.query.to as string) : new Date();
  const from = req.query.from ? new Date(req.query.from as string) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}
const round = (n: number): number => Math.round(n * 10) / 10;

// ─── Safety ──────────────────────────────────────────────────────────

export const safety = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
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
    const { from, to } = parseRange(req);
    const [admissions, discharges, expired, lama, dama, dischargedWithLos] = await Promise.all([
      prisma.ipdAdmission.count({ where: { admissionDate: { gte: from, lte: to } } }),
      prisma.ipdDischarge.count({ where: { dischargeDate: { gte: from, lte: to } } }),
      prisma.ipdDischarge.count({ where: { dischargeDate: { gte: from, lte: to }, dischargeType: 'expired' } }),
      prisma.lamaRecord.count({ where: { lamaTime: { gte: from, lte: to } } }).catch(() => 0),
      prisma.damaRecord.count({ where: { dischargeTime: { gte: from, lte: to } } }).catch(() => 0),
      prisma.ipdDischarge.findMany({
        where: { dischargeDate: { gte: from, lte: to } },
        select: { dischargeDate: true, admission: { select: { admissionDate: true } } },
        take: 1000,
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
    const { from, to } = parseRange(req);

    // (1) Initial assessment within 24h of admission.
    const admits = await prisma.ipdAdmission.findMany({
      where: { admissionDate: { gte: from, lte: to } },
      select: { admissionDate: true, initialAssessment: { select: { status: true, updatedAt: true } } },
      take: 2000,
    });
    let iaWithin = 0;
    for (const a of admits) {
      const ia = a.initialAssessment;
      if (ia?.status === 'CONSULTANT_SIGNED' && ia.updatedAt) {
        const diffH = (new Date(ia.updatedAt).getTime() - new Date(a.admissionDate).getTime()) / 3_600_000;
        if (diffH <= 24) iaWithin += 1;
      }
    }

    // (2) Discharge summary signed within 24h.
    const dischs = await prisma.ipdDischarge.findMany({
      where: { dischargeDate: { gte: from, lte: to } },
      select: { dischargeDate: true, summaryStatus: true, updatedAt: true },
      take: 2000,
    });
    let dsWithin = 0;
    for (const d of dischs) {
      if ((d.summaryStatus === 'SIGNED' || d.summaryStatus === 'DELIVERED') && d.updatedAt) {
        const diffH = (new Date(d.updatedAt).getTime() - new Date(d.dischargeDate).getTime()) / 3_600_000;
        if (diffH <= 24) dsWithin += 1;
      }
    }

    // (3) Critical labs acknowledged within 30 min.
    const labs = await prisma.investigationResult.findMany({
      where: { criticalFlag: true, isDeleted: false, reportedAt: { gte: from, lte: to } },
      select: { reportedAt: true, acknowledgedAt: true },
      take: 2000,
    });
    let labWithin = 0;
    for (const l of labs) {
      if (l.acknowledgedAt && l.reportedAt) {
        const diffM = (new Date(l.acknowledgedAt).getTime() - new Date(l.reportedAt).getTime()) / 60_000;
        if (diffM <= 30) labWithin += 1;
      }
    }

    res.status(200).json({
      initialAssessmentWithin24h: { within: iaWithin, total: admits.length, pct: admits.length > 0 ? round((iaWithin / admits.length) * 100) : 0 },
      dischargeSummarySignedWithin24h: { within: dsWithin, total: dischs.length, pct: dischs.length > 0 ? round((dsWithin / dischs.length) * 100) : 0 },
      criticalLabAckWithin30m: { within: labWithin, total: labs.length, pct: labs.length > 0 ? round((labWithin / labs.length) * 100) : 0 },
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
    const { from, to } = parseRange(req);
    const surveys = await prisma.feedbackSurvey.findMany({
      where: { status: 'completed', npsScore: { not: null }, respondedAt: { gte: from, lte: to } },
      select: { npsScore: true },
      take: 10000,
    });
    let promoters = 0, passives = 0, detractors = 0;
    for (const r of surveys) {
      const s = r.npsScore!;
      if (s >= 9) promoters += 1;
      else if (s >= 7) passives += 1;
      else detractors += 1;
    }
    const npsScore = surveys.length > 0 ? Math.round(((promoters - detractors) / surveys.length) * 100) : 0;

    const [complaints, resolved, slaBreached, active] = await Promise.all([
      prisma.complaint.count({ where: { raisedAt: { gte: from, lte: to } } }),
      prisma.complaint.count({ where: { raisedAt: { gte: from, lte: to }, status: 'resolved' } }),
      prisma.complaint.count({ where: { raisedAt: { gte: from, lte: to }, slaDueAt: { lt: new Date() }, status: { not: 'resolved' } } }),
      prisma.complaint.count({ where: { raisedAt: { gte: from, lte: to }, status: { in: ['open', 'acknowledged', 'escalated'] } } }),
    ]);

    res.status(200).json({
      nps: { score: npsScore, promoters, passives, detractors, total: surveys.length },
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
    const { from, to } = parseRange(req);
    const [total, cancelled, started] = await Promise.all([
      prisma.otSchedule.count({ where: { plannedStart: { gte: from, lte: to } } }).catch(() => 0),
      prisma.otSchedule.count({ where: { plannedStart: { gte: from, lte: to }, status: 'cancelled' } }).catch(() => 0),
      prisma.otSchedule.findMany({
        where: { plannedStart: { gte: from, lte: to }, actualStart: { not: null } },
        select: { plannedStart: true, actualStart: true },
        take: 2000,
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
    const { from, to } = parseRange(req);
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
