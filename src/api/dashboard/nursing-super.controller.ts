import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { isNurse } from '../_shared/nursing-roles';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * GET /api/dashboard/nursing-superintendent/summary
 *
 * Hospital-wide nursing oversight: per-ward inpatient totals, nurse:patient
 * ratio per ward, bed request queue, staff handovers, ICU step-down requests.
 * Single round-trip.
 */
export const getNursingSuperintendentSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    // ─── Hospital-wide inpatient state ─────────────────────────────────
    const [wards, admissions, totalBeds, occupiedBeds] = await Promise.all([
      prisma.ipdWard.findMany({
        select: { id: true, wardName: true, wardCode: true, totalBeds: true, department: true },
      }),
      prisma.ipdAdmission.findMany({
        where: { status: { in: ['admitted', 'BED_ACCEPTED'] } },
        select: {
          id: true,
          wardId: true,
          icuAdmittedAt: true,
          icuDischargedAt: true,
        },
      }),
      prisma.ipdBed.count(),
      prisma.ipdBed.count({ where: { status: 'occupied' } }),
    ]);

    const wardById = new Map(wards.map((w) => [w.id, w]));
    const admissionsByWard = new Map<string, { count: number; icu: number }>();
    for (const a of admissions) {
      if (!a.wardId) continue;
      const cur = admissionsByWard.get(a.wardId) || { count: 0, icu: 0 };
      cur.count++;
      if (a.icuAdmittedAt && !a.icuDischargedAt) cur.icu++;
      admissionsByWard.set(a.wardId, cur);
    }

    // ─── Today's nursing roster — count per-ward assignments ──────────
    const todayAssignments = await prisma.staffShiftAssignment.findMany({
      where: {
        date: { gte: todayStart, lte: todayEnd },
        status: { in: ['SCHEDULED', 'ACKNOWLEDGED', 'COMPLETED'] },
      },
      select: {
        id: true,
        userId: true,
        wardId: true,
        status: true,
        shift: { select: { name: true } },
        user: { select: { subAdminType: true, username: true } },
      },
    });
    const nursingAssignments = todayAssignments.filter(
      (a) => isNurse(a.user?.subAdminType),
    );
    const nursesByWard = new Map<string, number>();
    for (const a of nursingAssignments) {
      if (!a.wardId) continue;
      nursesByWard.set(a.wardId, (nursesByWard.get(a.wardId) || 0) + 1);
    }
    const noShowNurses = todayAssignments.filter((a) => a.status === 'NO_SHOW').length;

    // ─── Per-ward summary table ───────────────────────────────────────
    const wardSummary = wards.map((w) => {
      const occ = admissionsByWard.get(w.id) || { count: 0, icu: 0 };
      const nurses = nursesByWard.get(w.id) || 0;
      const ratio = nurses > 0 ? (occ.count / nurses).toFixed(1) : null;
      return {
        wardId: w.id,
        wardName: w.wardName,
        wardCode: w.wardCode,
        department: w.department,
        totalBeds: w.totalBeds,
        occupied: occ.count,
        icu: occ.icu,
        nursesOnDuty: nurses,
        ratio,
        occupancyPercent:
          w.totalBeds > 0 ? Math.round((occ.count / w.totalBeds) * 100) : null,
      };
    });

    // ─── Critical patients hospital-wide ──────────────────────────────
    const criticalAdmissionIds = admissions
      .filter((a) => a.icuAdmittedAt && !a.icuDischargedAt)
      .map((a) => a.id);
    // Also count low-SpO2 from recent vitals.
    const recentVitalsLow = await prisma.ipdVitalsReading.findMany({
      where: {
        recordedAt: { gte: new Date(now.getTime() - 4 * 60 * 60000) },
        spo2: { lt: 92 },
      },
      select: { admissionId: true },
      distinct: ['admissionId'],
    });
    const lowSpo2Ids = new Set(recentVitalsLow.map((v) => v.admissionId));
    const criticalCount = new Set([...criticalAdmissionIds, ...lowSpo2Ids]).size;

    // ─── Pending bed requests queue (REQUESTED status) ────────────────
    const pendingBedRequests = await prisma.ipdBedRequest.findMany({
      where: { status: 'REQUESTED' },
      orderBy: { requestedAt: 'asc' },
      take: 25,
      select: {
        id: true,
        admissionId: true,
        wardId: true,
        preferredBedType: true,
        urgency: true,
        requestedAt: true,
        requestedBy: true,
      },
    });
    const bedRequests = pendingBedRequests.map((r) => ({
      id: r.id,
      admissionId: r.admissionId,
      wardName: r.wardId ? wardById.get(r.wardId)?.wardName || null : null,
      preferredBedType: r.preferredBedType,
      urgency: r.urgency,
      requestedAt: r.requestedAt.toISOString(),
      requestedBy: r.requestedBy,
      ageMinutes: Math.max(
        0,
        Math.floor((now.getTime() - new Date(r.requestedAt).getTime()) / 60000),
      ),
    }));

    // ─── ICU step-down requests in flight ─────────────────────────────
    const stepDownRows = await prisma.icuStepDownRequest.findMany({
      where: { status: { in: ['PROPOSED', 'ACKNOWLEDGED', 'ACCEPTED', 'IN_TRANSIT'] } },
      orderBy: { proposedAt: 'desc' },
      take: 15,
      select: {
        id: true,
        admissionId: true,
        status: true,
        proposedBy: true,
        proposedAt: true,
        toWardId: true,
      },
    });
    const icuStepDowns = stepDownRows.map((r) => ({
      id: r.id,
      admissionId: r.admissionId,
      status: r.status,
      proposedBy: r.proposedBy,
      proposedAt: r.proposedAt.toISOString(),
      toWardName: r.toWardId ? wardById.get(r.toWardId)?.wardName || null : null,
    }));

    // ─── Pending handovers today (status != 'ACKNOWLEDGED') ──────────
    const pendingHandovers = await prisma.ipdHandover.count({
      where: {
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60000) },
        NOT: { status: 'ACKNOWLEDGED' },
      },
    });

    // ─── Discharge readiness today (pipeline summary) ────────────────
    const dischargesToday = await prisma.ipdDischarge.findMany({
      where: { dischargeDate: { gte: todayStart, lte: todayEnd } },
      select: { summaryStatus: true },
    });
    const dischargePipeline = {
      drafted: dischargesToday.filter((d) => d.summaryStatus === 'DRAFTED' || d.summaryStatus === 'NONE').length,
      edited: dischargesToday.filter((d) => d.summaryStatus === 'EDITED').length,
      signed: dischargesToday.filter((d) => d.summaryStatus === 'SIGNED').length,
      delivered: dischargesToday.filter((d) => d.summaryStatus === 'DELIVERED').length,
      total: dischargesToday.length,
    };

    // ─── NABH-style compliance score (today) ─────────────────────────
    // Crude: % of (occupied admissions today) that have at least one vitals
    // reading in last 8h. Easy to extend with handovers/assessments.
    const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60000);
    const recentVitals = await prisma.ipdVitalsReading.findMany({
      where: { recordedAt: { gte: eightHoursAgo } },
      select: { admissionId: true },
      distinct: ['admissionId'],
    });
    const admissionsWithRecentVitals = new Set(recentVitals.map((v) => v.admissionId));
    const occupiedAdmissionIds = admissions.map((a) => a.id);
    const compliantCount = occupiedAdmissionIds.filter((id) =>
      admissionsWithRecentVitals.has(id),
    ).length;
    const complianceScore = {
      compliant: compliantCount,
      total: occupiedAdmissionIds.length,
      percent:
        occupiedAdmissionIds.length > 0
          ? Math.round((compliantCount / occupiedAdmissionIds.length) * 100)
          : null,
    };

    // ─── Hospital-wide MAR compliance ──────────────────────────────────
    const allActiveRx = await prisma.ipdPrescription.findMany({
      where: { admissionId: { in: admissions.map((a) => a.id) }, status: 'active' },
      select: { adminStatus: true },
    });
    const marAdmin = allActiveRx.filter((r) => r.adminStatus === 'administered').length;
    const marCompliance = {
      administered: marAdmin,
      total: allActiveRx.length,
      percent:
        allActiveRx.length > 0
          ? Math.round((marAdmin / allActiveRx.length) * 100)
          : null,
    };

    // ─── LOS by ward (avg days-of-stay among active admissions per ward) ─
    const losByWardMap = new Map<string, { sum: number; count: number }>();
    for (const a of admissions) {
      if (!a.wardId) continue;
      const days = Math.max(
        1,
        Math.floor(
          (now.getTime() - new Date((a as any).admissionDate || now).getTime()) /
            86400000,
        ) + 1,
      );
      const cur = losByWardMap.get(a.wardId) || { sum: 0, count: 0 };
      cur.sum += days;
      cur.count += 1;
      losByWardMap.set(a.wardId, cur);
    }
    // We pulled `admissionDate` for the LOS calc — but the existing select
    // didn't include it. Re-pull with admissionDate so the calc is real.
    const admissionsForLos = await prisma.ipdAdmission.findMany({
      where: { status: { in: ['admitted', 'BED_ACCEPTED'] } },
      select: { wardId: true, admissionDate: true },
    });
    losByWardMap.clear();
    for (const a of admissionsForLos) {
      if (!a.wardId) continue;
      const days = Math.max(
        1,
        Math.floor((now.getTime() - new Date(a.admissionDate).getTime()) / 86400000) + 1,
      );
      const cur = losByWardMap.get(a.wardId) || { sum: 0, count: 0 };
      cur.sum += days;
      cur.count += 1;
      losByWardMap.set(a.wardId, cur);
    }
    const losByWard = wards
      .map((w) => {
        const cur = losByWardMap.get(w.id);
        const avg = cur && cur.count > 0 ? Math.round((cur.sum / cur.count) * 10) / 10 : null;
        return { wardId: w.id, wardName: w.wardName, avgLosDays: avg };
      })
      .filter((r) => r.avgLosDays !== null) as Array<{
      wardId: string;
      wardName: string;
      avgLosDays: number;
    }>;

    // ─── Critical patients across all wards (top 15) ────────────────────
    const criticalIds = Array.from(
      new Set([...criticalAdmissionIds, ...Array.from(lowSpo2Ids)]),
    ).slice(0, 15);
    let criticalPatientList: Array<{
      admissionId: string;
      patientName: string;
      bedNumber: string | null;
      wardName: string | null;
      reason: string;
    }> = [];
    if (criticalIds.length > 0) {
      const critRows = await prisma.ipdAdmission.findMany({
        where: { id: { in: criticalIds } },
        select: {
          id: true,
          prn: true,
          icuAdmittedAt: true,
          icuDischargedAt: true,
          wardId: true,
          bed: { select: { bedNumber: true } },
        },
      });
      const prns = critRows.map((r) => parseInt(r.prn, 10)).filter((n) => !Number.isNaN(n));
      const patientRows = await prisma.patientDetails.findMany({
        where: { prn: { in: prns } },
        select: { prn: true, name: true },
      });
      const nameByPrn = new Map(patientRows.map((p) => [p.prn, p.name || '']));
      criticalPatientList = critRows.map((r) => {
        const prnInt = parseInt(r.prn, 10);
        const name = !Number.isNaN(prnInt) ? nameByPrn.get(prnInt) || '' : '';
        const inIcu = !!(r.icuAdmittedAt && !r.icuDischargedAt);
        const lowSpo2 = lowSpo2Ids.has(r.id);
        const reason = inIcu && lowSpo2
          ? 'ICU + low SpO₂'
          : inIcu
          ? 'ICU admission'
          : 'Low SpO₂';
        return {
          admissionId: r.id,
          patientName: name || `PRN ${r.prn}`,
          bedNumber: r.bed?.bedNumber || null,
          wardName: r.wardId ? wardById.get(r.wardId)?.wardName || null : null,
          reason,
        };
      });
    }

    // ─── NABH readiness score (composite, today) ───────────────────────
    // Three sub-metrics each 0-100%; final = average. Weighted equally.
    //   1. Vitals compliance (already in complianceScore)
    //   2. Handover sign-off rate (today's handovers ACKNOWLEDGED %)
    //   3. Initial assessment coverage (admissions with an initial-assessment row %)
    const todayHandovers = await prisma.ipdHandover.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60000) } },
      select: { status: true },
    });
    const handoverAck = todayHandovers.filter((h) => h.status === 'ACKNOWLEDGED').length;
    const handoverPct =
      todayHandovers.length > 0
        ? Math.round((handoverAck / todayHandovers.length) * 100)
        : null;
    const assessmentCovered = await prisma.ipdAdmission.count({
      where: {
        status: { in: ['admitted', 'BED_ACCEPTED'] },
        initialAssessment: { isNot: null },
      },
    });
    const assessmentPct =
      admissions.length > 0
        ? Math.round((assessmentCovered / admissions.length) * 100)
        : null;
    const components = [
      complianceScore.percent,
      handoverPct,
      assessmentPct,
    ].filter((n): n is number => n !== null);
    const nabhReadinessScore = {
      vitalsCompliancePercent: complianceScore.percent,
      handoverSignOffPercent: handoverPct,
      assessmentCoveragePercent: assessmentPct,
      overallPercent:
        components.length > 0
          ? Math.round(components.reduce((s, n) => s + n, 0) / components.length)
          : null,
    };

    res.json({
      kpis: {
        inpatientsTotal: admissions.length,
        criticalPatients: criticalCount,
        nursesOnDutyToday: nursingAssignments.length,
        noShowNurses,
        pendingHandovers,
        pendingBedRequests: bedRequests.length,
        bedOccupancyPercent:
          totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : null,
        complianceScore,
      },
      wardSummary,
      bedRequests,
      icuStepDowns,
      dischargePipeline,
      marCompliance,
      losByWard,
      criticalPatientList,
      nabhReadinessScore,
    });
  } catch (err) {
    console.error('[dashboard.nursing-super.summary] error:', err);
    res.status(500).json({ error: 'Failed to load nursing superintendent summary' });
  }
};
