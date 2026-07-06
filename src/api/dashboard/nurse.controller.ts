import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { resolveWardScope } from '../_shared/nursing-roles';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.max(0, b.getTime() - a.getTime()) / 86400000);
}

/**
 * GET /api/dashboard/nurse/summary?userId=N&blockId=N
 *
 * Bedside nurse persona, scoped to a single block / ward area. Returns the
 * patient cards the nurse must round on this shift + counts of overdue or
 * upcoming tasks. Single round-trip.
 */
export const getNurseSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userIdRaw = req.query.userId as string | undefined;
    const blockIdRaw = (req.query.blockId as string | undefined) || '';
    if (!userIdRaw) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const userId = parseInt(userIdRaw, 10);
    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'userId must be a number' });
      return;
    }

    // Resolve user — we use this for shift-assignment lookup and to derive
    // block from employeeId if no blockId param was given.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, employeeId: true, subAdminType: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const blockId = blockIdRaw;

    const now = new Date();
    const todayStart = startOfDay(now);
    const oneHourFromNow = new Date(now.getTime() + 60 * 60000);

    // ─── Ward scope (NS-3) ────────────────────────────────────────────
    // Replaces the old employeeId "B<N>" block-parse + fuzzy ward-name match
    // (which silently fell back to ALL wards). A bedside nurse is now scoped
    // to the wards covered by their station(s) / home ward / today's shift;
    // super_admin + Nursing Superintendent are unrestricted.
    const allWards = await prisma.ipdWard.findMany({
      select: { id: true, wardName: true, wardCode: true, totalBeds: true },
    });
    const scope = await resolveWardScope(userId);
    const scopedWardIds: string[] = scope.unrestricted
      ? allWards.map((w) => w.id)
      : scope.wardIds;
    // True when the view is limited to a subset (i.e. an actually-scoped nurse).
    const blockResolved = !scope.unrestricted;
    const wardById = new Map(allWards.map((w) => [w.id, w]));

    // ─── Active admissions in this nurse's wards ──────────────────────
    const admissions = await prisma.ipdAdmission.findMany({
      where: {
        wardId: { in: scopedWardIds },
        status: { in: ['admitted', 'BED_ACCEPTED'] },
      },
      select: {
        id: true,
        admissionNo: true,
        prn: true,
        admissionDate: true,
        diagnosis: true,
        admittingDoctor: true,
        roomType: true,
        wardId: true,
        bed: { select: { bedNumber: true } },
        icuAdmittedAt: true,
        icuDischargedAt: true,
      },
      orderBy: { admissionDate: 'asc' },
    });
    const admissionIds = admissions.map((a) => a.id);
    const prnNumbers = admissions
      .map((a) => parseInt(a.prn, 10))
      .filter((n) => !Number.isNaN(n));

    // Patient names (best-effort via PatientDetails.prn).
    let prnNameMap = new Map<number, string>();
    let allergyMap = new Map<string, string[]>();
    if (prnNumbers.length > 0) {
      const patientRows = await prisma.patientDetails.findMany({
        where: { prn: { in: prnNumbers } },
        select: { prn: true, name: true },
      });
      prnNameMap = new Map(
        patientRows
          .filter((p) => p.prn !== null && p.prn !== undefined)
          .map((p) => [p.prn as number, p.name || '']),
      );
      // Pull current allergies for these PRNs so the nurse can scan them.
      const allergyRows = await prisma.allergy.findMany({
        where: { prn: { in: prnNumbers.map(String) } },
        select: { prn: true, genericName: true },
      });
      for (const row of allergyRows) {
        const cur = allergyMap.get(row.prn) || [];
        cur.push(row.genericName);
        allergyMap.set(row.prn, cur);
      }
    }

    // Last vitals per admission (batched).
    const lastVitalsByAdmission = new Map<string, any>();
    if (admissionIds.length > 0) {
      const vitals = await prisma.ipdVitalsReading.findMany({
        where: { admissionId: { in: admissionIds } },
        orderBy: { recordedAt: 'desc' },
        select: {
          admissionId: true,
          recordedAt: true,
          bpSystolic: true,
          bpDiastolic: true,
          pulse: true,
          spo2: true,
          temperatureC: true,
        },
      });
      for (const v of vitals) {
        if (!lastVitalsByAdmission.has(v.admissionId)) {
          lastVitalsByAdmission.set(v.admissionId, v);
        }
      }
    }

    // Upcoming meds (next 1h) per admission, plus overdue (next admin < now,
    // status=pending). Rely on IpdPrescription.nextAdminTime + adminStatus.
    const upcomingMedsByAdmission = new Map<string, number>();
    const overdueMedsByAdmission = new Map<string, number>();
    let totalUpcomingMeds = 0;
    let totalOverdueMeds = 0;
    if (admissionIds.length > 0) {
      const rxRows = await prisma.ipdPrescription.findMany({
        where: {
          admissionId: { in: admissionIds },
          status: 'active',
          adminStatus: 'pending',
          nextAdminTime: { not: null },
        },
        select: { admissionId: true, nextAdminTime: true },
      });
      for (const rx of rxRows) {
        if (!rx.nextAdminTime) continue;
        const t = new Date(rx.nextAdminTime).getTime();
        if (t < now.getTime()) {
          overdueMedsByAdmission.set(
            rx.admissionId,
            (overdueMedsByAdmission.get(rx.admissionId) || 0) + 1,
          );
          totalOverdueMeds++;
        } else if (t <= oneHourFromNow.getTime()) {
          upcomingMedsByAdmission.set(
            rx.admissionId,
            (upcomingMedsByAdmission.get(rx.admissionId) || 0) + 1,
          );
          totalUpcomingMeds++;
        }
      }
    }

    // Pending non-drug orders per admission (ORDERED status — not yet acknowledged).
    const pendingOrdersByAdmission = new Map<string, number>();
    let totalPendingOrders = 0;
    if (admissionIds.length > 0) {
      const ordRows = await prisma.ipdNonDrugOrder.groupBy({
        by: ['admissionId'],
        where: {
          admissionId: { in: admissionIds },
          status: 'ORDERED',
        },
        _count: { _all: true },
      });
      for (const r of ordRows) {
        pendingOrdersByAdmission.set(r.admissionId, r._count._all);
        totalPendingOrders += r._count._all;
      }
    }

    // Overdue vitals: no reading in last 4 hours during day-shift convention.
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60000);
    let overdueVitalsCount = 0;
    const overdueVitalsIds = new Set<string>();
    for (const a of admissions) {
      const lv = lastVitalsByAdmission.get(a.id);
      if (!lv || new Date(lv.recordedAt).getTime() < fourHoursAgo.getTime()) {
        overdueVitalsCount++;
        overdueVitalsIds.add(a.id);
      }
    }

    // Critical patients in block (ICU active OR SpO2 < 92 on last vitals).
    let criticalCount = 0;
    const isCritical = new Map<string, boolean>();
    for (const a of admissions) {
      const lv = lastVitalsByAdmission.get(a.id);
      const icu = !!(a.icuAdmittedAt && !a.icuDischargedAt);
      const lowSpo2 = !!(lv && lv.spo2 !== null && lv.spo2 < 92);
      const flag = icu || lowSpo2;
      if (flag) criticalCount++;
      isCritical.set(a.id, flag);
    }

    // ─── Build patient card list ───────────────────────────────────────
    const patients = admissions.map((a) => {
      const prnInt = parseInt(a.prn, 10);
      const patientName = !Number.isNaN(prnInt) ? prnNameMap.get(prnInt) || '' : '';
      const dayOfStay = daysBetween(new Date(a.admissionDate), todayStart) + 1;
      const lv = lastVitalsByAdmission.get(a.id) || null;
      const ward = a.wardId ? wardById.get(a.wardId) : null;
      const allergies = allergyMap.get(a.prn) || [];
      return {
        admissionId: a.id,
        admissionNo: a.admissionNo,
        prn: a.prn,
        patientName,
        bedNumber: a.bed?.bedNumber || null,
        wardName: ward?.wardName || null,
        roomType: a.roomType,
        dayOfStay,
        diagnosisShort:
          a.diagnosis && a.diagnosis.length > 80 ? a.diagnosis.slice(0, 80) + '…' : a.diagnosis || '',
        admittingDoctor: a.admittingDoctor,
        icu: !!(a.icuAdmittedAt && !a.icuDischargedAt),
        critical: isCritical.get(a.id) || false,
        allergies,
        lastVitals: lv
          ? {
              recordedAt: lv.recordedAt,
              bp:
                lv.bpSystolic !== null && lv.bpDiastolic !== null
                  ? `${lv.bpSystolic}/${lv.bpDiastolic}`
                  : null,
              pulse: lv.pulse,
              spo2: lv.spo2,
              temperatureC: lv.temperatureC,
            }
          : null,
        upcomingMeds: upcomingMedsByAdmission.get(a.id) || 0,
        overdueMeds: overdueMedsByAdmission.get(a.id) || 0,
        pendingOrders: pendingOrdersByAdmission.get(a.id) || 0,
        vitalsOverdue: overdueVitalsIds.has(a.id),
      };
    });

    // ─── Today's shift assignment for this nurse (if any) ──────────────
    const todayAssignments = await prisma.staffShiftAssignment.findMany({
      where: {
        userId,
        date: { gte: todayStart, lte: new Date(todayStart.getTime() + 86400000) },
      },
      select: {
        id: true,
        status: true,
        shift: { select: { name: true, code: true, startTime: true, endTime: true } },
        ward: { select: { wardName: true, wardCode: true } },
      },
    });
    const myShifts = todayAssignments.map((s) => ({
      id: s.id,
      status: s.status,
      shiftName: s.shift?.name || '',
      shiftCode: s.shift?.code || '',
      startTime: s.shift?.startTime || '',
      endTime: s.shift?.endTime || '',
      ward: s.ward?.wardName || null,
    }));

    // ─── Acuity mix donut ─────────────────────────────────────────────
    const stable = patients.filter((p) => !p.critical && !p.icu).length;
    const monitor = patients.filter((p) => !p.critical && p.upcomingMeds + p.overdueMeds + p.pendingOrders > 0).length;
    const critical = patients.filter((p) => p.critical).length;
    const acuityMix = [
      { name: 'Stable', value: stable },
      { name: 'Active care', value: Math.max(0, monitor - critical) },
      { name: 'Critical', value: critical },
    ];

    // ─── Medication timeline (next 4 hours) ────────────────────────────
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60000);
    let medTimeline: Array<{
      prescriptionId: string;
      admissionId: string;
      patientName: string;
      bedNumber: string | null;
      genericName: string;
      brandName: string | null;
      dose: string;
      route: string;
      nextAdminTime: string;
      minutesFromNow: number;
      isOverdue: boolean;
    }> = [];
    if (admissionIds.length > 0) {
      const timelineRows = await prisma.ipdPrescription.findMany({
        where: {
          admissionId: { in: admissionIds },
          status: 'active',
          adminStatus: 'pending',
          nextAdminTime: { lte: fourHoursFromNow },
        },
        orderBy: { nextAdminTime: 'asc' },
        select: {
          id: true,
          admissionId: true,
          genericName: true,
          brandName: true,
          dose: true,
          route: true,
          nextAdminTime: true,
        },
      });
      // Build per-admission lookup for patientName + bedNumber
      const admById = new Map(patients.map((p) => [p.admissionId, p]));
      medTimeline = timelineRows
        .filter((r) => r.nextAdminTime !== null)
        .map((r) => {
          const t = new Date(r.nextAdminTime as Date).getTime();
          const minutesFromNow = Math.round((t - now.getTime()) / 60000);
          const adm = admById.get(r.admissionId);
          return {
            prescriptionId: r.id,
            admissionId: r.admissionId,
            patientName: adm?.patientName || `PRN ${adm?.prn || '—'}`,
            bedNumber: adm?.bedNumber || null,
            genericName: r.genericName,
            brandName: r.brandName,
            dose: r.dose,
            route: r.route,
            nextAdminTime: (r.nextAdminTime as Date).toISOString(),
            minutesFromNow,
            isOverdue: minutesFromNow < 0,
          };
        });
    }

    // ─── Block census 7-day sparkline (admissions count per day in this
    //     block's wards) ────────────────────────────────────────────────
    const sevenDayAgo = new Date(now.getTime() - 7 * 86400000);
    const wardsForCensus = scopedWardIds;
    const censusRows = await prisma.ipdAdmission.findMany({
      where: {
        wardId: { in: wardsForCensus },
        admissionDate: { lte: now },
      },
      select: { admissionDate: true, status: true },
    });
    const censusByDate = new Map<string, number>();
    function toYmd(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      censusByDate.set(toYmd(d), 0);
    }
    for (const r of censusRows) {
      const k = toYmd(new Date(r.admissionDate));
      const cur = censusByDate.get(k);
      if (cur !== undefined) censusByDate.set(k, cur + 1);
    }
    const blockCensus7d = Array.from(censusByDate.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // ─── My MAR compliance today (prescriptions I've administered) ─────
    let myMarCompliance: { administered: number; total: number; percent: number | null } = {
      administered: 0,
      total: 0,
      percent: null,
    };
    if (admissionIds.length > 0) {
      const allRx = await prisma.ipdPrescription.findMany({
        where: { admissionId: { in: admissionIds }, status: 'active' },
        select: { adminStatus: true },
      });
      const total = allRx.length;
      const administered = allRx.filter((r) => r.adminStatus === 'administered').length;
      myMarCompliance = {
        administered,
        total,
        percent: total > 0 ? Math.round((administered / total) * 100) : null,
      };
    }

    res.json({
      blockId: blockId || null,
      blockResolved,
      kpis: {
        patientsAllotted: patients.length,
        upcomingMeds1h: totalUpcomingMeds,
        overdueMeds: totalOverdueMeds,
        overdueVitals: overdueVitalsCount,
        pendingOrders: totalPendingOrders,
        criticalPatients: criticalCount,
      },
      myShifts,
      patients,
      acuityMix,
      medTimeline,
      blockCensus7d,
      myMarCompliance,
    });
  } catch (err) {
    console.error('[dashboard.nurse.summary] error:', err);
    res.status(500).json({ error: 'Failed to load nurse summary' });
  }
};
