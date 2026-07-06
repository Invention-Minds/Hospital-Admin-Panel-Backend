import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysAgoYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function firstOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * GET /api/dashboard/management/summary?date=YYYY-MM-DD
 *
 * Hospital-wide snapshot for admin / manager dashboards. Aggregates today's
 * footfall across all modules, bed-occupancy, revenue, OT utilization, plus
 * a 30-day trend and an alerts feed for governance items (LAMA/DAMA, open
 * MLCs, HMIS sync failures). Single round-trip.
 */
export const getManagementSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const dateParam = (req.query.date as string | undefined) || todayYmd();
    const todayStart = startOfDay(dateParam);
    const todayEnd = endOfDay(dateParam);
    const thirtyDaysAgo = daysAgoYmd(29);
    const monthStart = firstOfMonthYmd();

    // ─── Today's footfall (4-way split) ─────────────────────────────────
    const [opdCount, ipdAdmits, erCount, dayCareCount] = await Promise.all([
      prisma.appointment.count({ where: { date: dateParam } }),
      prisma.ipdAdmission.count({
        where: { admissionDate: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.emergency.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.dayCareSession.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
      }),
    ]);
    const footfallToday = {
      total: opdCount + ipdAdmits + erCount + dayCareCount,
      opd: opdCount,
      ipd: ipdAdmits,
      er: erCount,
      dayCare: dayCareCount,
    };

    // ─── Bed occupancy ─────────────────────────────────────────────────
    const [totalBeds, occupiedBeds] = await Promise.all([
      prisma.ipdBed.count(),
      prisma.ipdBed.count({ where: { status: 'occupied' } }),
    ]);
    const bedOccupancy = {
      total: totalBeds,
      occupied: occupiedBeds,
      percent: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : null,
    };

    // ─── Revenue (today + MTD) from RevenueRollup ──────────────────────
    const [todayRevenueRows, mtdRevenueRows] = await Promise.all([
      prisma.revenueRollup.findMany({
        where: { date: dateParam },
        select: { totalAmount: true, departmentName: true, serviceType: true },
      }),
      prisma.revenueRollup.findMany({
        where: { date: { gte: monthStart, lte: dateParam } },
        select: { totalAmount: true },
      }),
    ]);
    const revenueToday = todayRevenueRows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    const revenueMtd = mtdRevenueRows.reduce((s, r) => s + (r.totalAmount || 0), 0);

    // Department revenue mix (today). Empty if no rollups yet.
    const deptMap = new Map<string, number>();
    for (const r of todayRevenueRows) {
      const k = r.departmentName || 'Unspecified';
      deptMap.set(k, (deptMap.get(k) || 0) + (r.totalAmount || 0));
    }
    const departmentRevenueMix = Array.from(deptMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // ─── Discharges today (completed vs pending sign-off) ──────────────
    const [dischargesCompleted, dischargesPending] = await Promise.all([
      prisma.ipdDischarge.count({
        where: {
          dischargeDate: { gte: todayStart, lte: todayEnd },
          summaryStatus: { in: ['SIGNED', 'DELIVERED'] },
        },
      }),
      prisma.ipdDischarge.count({
        where: {
          dischargeDate: { gte: todayStart, lte: todayEnd },
          NOT: { summaryStatus: { in: ['SIGNED', 'DELIVERED'] } },
        },
      }),
    ]);

    // ─── OT utilization today ──────────────────────────────────────────
    // Crude: (sum actual minutes for closed schedules) / (sum planned minutes
    // for all non-cancelled schedules today). 0-100% range.
    const otTodayRows = await prisma.otSchedule.findMany({
      where: {
        date: { gte: todayStart, lte: todayEnd },
        status: { not: 'CANCELLED' },
      },
      select: {
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        status: true,
      },
    });
    let plannedMin = 0;
    let actualMin = 0;
    for (const r of otTodayRows) {
      if (r.plannedStart && r.plannedEnd) {
        plannedMin += Math.max(0, (new Date(r.plannedEnd).getTime() - new Date(r.plannedStart).getTime()) / 60000);
      }
      if (r.actualStart && r.actualEnd) {
        actualMin += Math.max(0, (new Date(r.actualEnd).getTime() - new Date(r.actualStart).getTime()) / 60000);
      }
    }
    const otUtilization = {
      scheduledCases: otTodayRows.length,
      plannedMinutes: Math.round(plannedMin),
      actualMinutes: Math.round(actualMin),
      utilizationPercent:
        plannedMin > 0 ? Math.min(100, Math.round((actualMin / plannedMin) * 100)) : null,
    };

    // ─── Active emergencies (red triage subcount) ──────────────────────
    const activeErs = await prisma.emergency.findMany({
      where: { status: { in: ['arrived', 'stabilized'] } },
      select: { triageCategory: true },
    });
    const activeEmergencies = {
      total: activeErs.length,
      red: activeErs.filter((e) => (e.triageCategory || '').toLowerCase() === 'red').length,
    };

    // ─── 30-day footfall trend (stacked) ───────────────────────────────
    // Per-day buckets. Three parallel queries; merge by date.
    const [opdPerDay, ipdRows, erRows] = await Promise.all([
      prisma.appointment.groupBy({
        by: ['date'],
        where: { date: { gte: thirtyDaysAgo, lte: dateParam } },
        _count: { _all: true },
      }),
      prisma.ipdAdmission.findMany({
        where: { admissionDate: { gte: startOfDay(thirtyDaysAgo) } },
        select: { admissionDate: true },
      }),
      prisma.emergency.findMany({
        where: { createdAt: { gte: startOfDay(thirtyDaysAgo) } },
        select: { createdAt: true },
      }),
    ]);
    const dateBuckets = new Map<string, { opd: number; ipd: number; er: number }>();
    for (let i = 29; i >= 0; i--) {
      dateBuckets.set(daysAgoYmd(i), { opd: 0, ipd: 0, er: 0 });
    }
    for (const o of opdPerDay) {
      const b = dateBuckets.get(o.date);
      if (b) b.opd = o._count._all;
    }
    const toYmd = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const r of ipdRows) {
      const k = toYmd(new Date(r.admissionDate));
      const b = dateBuckets.get(k);
      if (b) b.ipd += 1;
    }
    for (const r of erRows) {
      const k = toYmd(new Date(r.createdAt));
      const b = dateBuckets.get(k);
      if (b) b.er += 1;
    }
    const footfallTrend30d = Array.from(dateBuckets.entries()).map(([date, v]) => ({
      date,
      opd: v.opd,
      ipd: v.ipd,
      er: v.er,
    }));

    // ─── Doctor productivity leaderboard (today, OPD completions) ──────
    const completionsToday = await prisma.appointment.groupBy({
      by: ['doctorId', 'doctorName'],
      where: {
        date: dateParam,
        OR: [{ status: 'completed' }, { endConsultation: true }],
      },
      _count: { _all: true },
      orderBy: { _count: { doctorId: 'desc' } },
      take: 8,
    });
    const doctorLeaderboard = completionsToday
      .filter((r) => r.doctorId !== null && r.doctorName)
      .map((r) => ({
        doctorId: r.doctorId as number,
        doctorName: r.doctorName,
        count: r._count._all,
      }));

    // ─── Hospital flow funnel (last 30d) ───────────────────────────────
    // Walk-in → Consulted → Investigation ordered → Admitted → Discharged.
    // Built from Appointment + InvestigationOrder + IpdAdmission + IpdDischarge.
    const [walkIn, consulted, investigated, admitted, discharged] = await Promise.all([
      prisma.appointment.count({
        where: { date: { gte: thirtyDaysAgo, lte: dateParam } },
      }),
      prisma.appointment.count({
        where: {
          date: { gte: thirtyDaysAgo, lte: dateParam },
          OR: [{ status: 'completed' }, { endConsultation: true }],
        },
      }),
      prisma.investigationOrder.count({
        where: { date: { gte: thirtyDaysAgo, lte: dateParam } },
      }),
      prisma.ipdAdmission.count({
        where: { admissionDate: { gte: startOfDay(thirtyDaysAgo) } },
      }),
      prisma.ipdDischarge.count({
        where: { dischargeDate: { gte: startOfDay(thirtyDaysAgo) } },
      }),
    ]);
    const flowFunnel = [
      { stage: 'Walk-in', value: walkIn },
      { stage: 'Consulted', value: consulted },
      { stage: 'Investigated', value: investigated },
      { stage: 'Admitted', value: admitted },
      { stage: 'Discharged', value: discharged },
    ];

    // ─── Alerts feed ───────────────────────────────────────────────────
    const [lamaTodayCount, damaTodayCount, openMlcCount, hmisDeadCount] = await Promise.all([
      prisma.lamaRecord.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.damaRecord.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.mlcCase.count({
        where: { NOT: { status: { in: ['CLOSED', 'closed'] } } },
      }),
      prisma.hmisDeadLetter.count({
        where: { status: 'QUARANTINED' },
      }),
    ]);
    const alerts: Array<{
      type: string;
      severity: 'high' | 'medium' | 'low';
      title: string;
      message: string;
      count: number;
      link: string | null;
    }> = [];
    if (lamaTodayCount > 0) {
      alerts.push({
        type: 'lama',
        severity: 'high',
        title: 'LAMA today',
        message: `${lamaTodayCount} patient${lamaTodayCount === 1 ? '' : 's'} left against medical advice today`,
        count: lamaTodayCount,
        link: '/lama-dama',
      });
    }
    if (damaTodayCount > 0) {
      alerts.push({
        type: 'dama',
        severity: 'medium',
        title: 'DAMA today',
        message: `${damaTodayCount} discharge${damaTodayCount === 1 ? '' : 's'} against medical advice today`,
        count: damaTodayCount,
        link: '/lama-dama',
      });
    }
    if (openMlcCount > 0) {
      alerts.push({
        type: 'mlc',
        severity: 'medium',
        title: 'Open MLC cases',
        message: `${openMlcCount} medico-legal case${openMlcCount === 1 ? '' : 's'} still open`,
        count: openMlcCount,
        link: '/mlc',
      });
    }
    if (hmisDeadCount > 0) {
      alerts.push({
        type: 'hmis-dead',
        severity: 'high',
        title: 'HMIS sync failures',
        message: `${hmisDeadCount} entries quarantined — operator action needed`,
        count: hmisDeadCount,
        link: '/hmis-sync',
      });
    }

    // ─── Admissions vs discharges (last 30d, paired bars) ──────────────
    const [admissionPerDay, dischargePerDay] = await Promise.all([
      prisma.ipdAdmission.findMany({
        where: { admissionDate: { gte: startOfDay(thirtyDaysAgo) } },
        select: { admissionDate: true },
      }),
      prisma.ipdDischarge.findMany({
        where: { dischargeDate: { gte: startOfDay(thirtyDaysAgo) } },
        select: { dischargeDate: true },
      }),
    ]);
    const admDisMap = new Map<string, { admissions: number; discharges: number }>();
    for (let i = 29; i >= 0; i--) {
      admDisMap.set(daysAgoYmd(i), { admissions: 0, discharges: 0 });
    }
    for (const a of admissionPerDay) {
      const k = `${a.admissionDate.getFullYear()}-${String(a.admissionDate.getMonth() + 1).padStart(2, '0')}-${String(a.admissionDate.getDate()).padStart(2, '0')}`;
      const b = admDisMap.get(k);
      if (b) b.admissions++;
    }
    for (const d of dischargePerDay) {
      const k = `${d.dischargeDate.getFullYear()}-${String(d.dischargeDate.getMonth() + 1).padStart(2, '0')}-${String(d.dischargeDate.getDate()).padStart(2, '0')}`;
      const b = admDisMap.get(k);
      if (b) b.discharges++;
    }
    const admissionsVsDischarges30d = Array.from(admDisMap.entries()).map(([date, v]) => ({
      date,
      admissions: v.admissions,
      discharges: v.discharges,
    }));

    // ─── LOS distribution (closed admissions last 30d) ─────────────────
    const closedAdmissions = await prisma.ipdAdmission.findMany({
      where: {
        admissionDate: { gte: startOfDay(thirtyDaysAgo) },
        discharge: { isNot: null },
      },
      select: {
        admissionDate: true,
        discharge: { select: { dischargeDate: true } },
      },
    });
    const losBuckets = { '1-2d': 0, '3-5d': 0, '6-10d': 0, '11-20d': 0, '20+d': 0 };
    for (const a of closedAdmissions) {
      if (!a.discharge?.dischargeDate) continue;
      const days = Math.max(
        1,
        Math.floor(
          (new Date(a.discharge.dischargeDate).getTime() - new Date(a.admissionDate).getTime()) /
            86400000,
        ),
      );
      if (days <= 2) losBuckets['1-2d']++;
      else if (days <= 5) losBuckets['3-5d']++;
      else if (days <= 10) losBuckets['6-10d']++;
      else if (days <= 20) losBuckets['11-20d']++;
      else losBuckets['20+d']++;
    }
    const losDistribution = Object.entries(losBuckets).map(([band, count]) => ({
      band,
      count,
    }));

    // ─── Hospital-wide demographics (last 30d, gender + age) ──────────
    const recentAppts = await prisma.appointment.findMany({
      where: { date: { gte: thirtyDaysAgo, lte: dateParam } },
      select: { gender: true, age: true },
    });
    const genderMap = new Map<string, number>();
    const ageBuckets: Record<string, number> = {
      '0-18': 0,
      '19-30': 0,
      '31-50': 0,
      '51-70': 0,
      '70+': 0,
    };
    for (const a of recentAppts) {
      const g = (a.gender || 'Unknown').trim();
      const norm =
        g.toLowerCase().startsWith('m') ? 'Male' :
        g.toLowerCase().startsWith('f') ? 'Female' :
        g.toLowerCase().startsWith('o') ? 'Other' : 'Unknown';
      genderMap.set(norm, (genderMap.get(norm) || 0) + 1);
      const m = (a.age || '').match(/(\d+)/);
      if (m) {
        const age = parseInt(m[1], 10);
        if (age <= 18) ageBuckets['0-18']++;
        else if (age <= 30) ageBuckets['19-30']++;
        else if (age <= 50) ageBuckets['31-50']++;
        else if (age <= 70) ageBuckets['51-70']++;
        else ageBuckets['70+']++;
      }
    }
    const hospitalDemographics = {
      gender: Array.from(genderMap.entries()).map(([name, value]) => ({ name, value })),
      ageBands: Object.entries(ageBuckets).map(([band, count]) => ({ band, count })),
    };

    // ─── Revenue trend (last 30d, sum across departments per day) ──────
    const revenueRows = await prisma.revenueRollup.findMany({
      where: { date: { gte: thirtyDaysAgo, lte: dateParam } },
      select: { date: true, totalAmount: true },
    });
    const revByDate = new Map<string, number>();
    for (let i = 29; i >= 0; i--) revByDate.set(daysAgoYmd(i), 0);
    for (const r of revenueRows) {
      const cur = revByDate.get(r.date);
      if (cur !== undefined) revByDate.set(r.date, cur + (r.totalAmount || 0));
    }
    const revenueTrend30d = Array.from(revByDate.entries()).map(([date, amount]) => ({
      date,
      amount,
    }));

    // ─── ER triage donut for today ─────────────────────────────────────
    const erToday = await prisma.emergency.findMany({
      where: { createdAt: { gte: todayStart, lte: todayEnd } },
      select: { triageCategory: true },
    });
    const triageMap = new Map<string, number>();
    for (const e of erToday) {
      const k = (e.triageCategory || 'unknown').toLowerCase();
      triageMap.set(k, (triageMap.get(k) || 0) + 1);
    }
    const erTriageToday = ['red', 'yellow', 'green', 'black'].map((c) => ({
      category: c,
      count: triageMap.get(c) || 0,
    }));

    res.json({
      date: dateParam,
      footfallToday,
      bedOccupancy,
      revenue: { today: revenueToday, mtd: revenueMtd },
      departmentRevenueMix,
      discharges: { completed: dischargesCompleted, pending: dischargesPending },
      otUtilization,
      activeEmergencies,
      footfallTrend30d,
      doctorLeaderboard,
      flowFunnel,
      alerts,
      admissionsVsDischarges30d,
      losDistribution,
      hospitalDemographics,
      revenueTrend30d,
      erTriageToday,
    });
  } catch (err) {
    console.error('[dashboard.management.summary] error:', err);
    res.status(500).json({ error: 'Failed to load management summary' });
  }
};
