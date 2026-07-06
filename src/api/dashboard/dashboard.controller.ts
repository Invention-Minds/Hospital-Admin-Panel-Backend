import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

function todayYmd(): string {
  // Server-local date is fine: the existing Appointment.date column stores
  // YYYY-MM-DD strings written by the frontend in the user's clock.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgoYmd(daysBack: number): string {
  const now = new Date();
  now.setDate(now.getDate() - daysBack);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.max(0, b.getTime() - a.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export type SpecialtyGroup =
  | 'SURGICAL'
  | 'EMERGENCY'
  | 'OBGYN'
  | 'PEDIATRICS'
  | 'CARDIAC'
  | 'GENERAL';

/**
 * Map a free-text department name to a coarse specialty group. Priority
 * matters — surgical sub-specialties (pediatric surgery, cardiothoracic
 * surgery) are routed to SURGICAL because the OT-board / pre-op pipeline
 * widgets are more actionable than their non-surgical counterparts.
 */
export function specialtyGroupFor(departmentName: string): SpecialtyGroup {
  const d = (departmentName || '').toLowerCase();
  if (!d) return 'GENERAL';
  // SURGICAL — must run before CARDIAC/PEDIATRICS so sub-specialties like
  // 'cardiothoracic surgery' or 'pediatric surgery' route here.
  if (
    /\bsurg(ery|ical|eon)?\b/.test(d) ||
    /\bortho/.test(d) ||
    /\burolog/.test(d) ||
    /\bent\b/.test(d) ||
    /otorhino|otolaryng/.test(d) ||
    /neurosurg/.test(d) ||
    /\blaparoscop/.test(d) ||
    /\bplastic\b/.test(d)
  ) {
    return 'SURGICAL';
  }
  if (/\bemerg/.test(d) || /\ber\b/.test(d) || /\btrauma\b/.test(d)) {
    return 'EMERGENCY';
  }
  if (/\bob.?gyn\b/.test(d) || /obstetric/.test(d) || /gyn[ae]c/.test(d) || /maternity/.test(d)) {
    return 'OBGYN';
  }
  if (/p(a)?ediatric/.test(d) || /neonat/.test(d)) {
    return 'PEDIATRICS';
  }
  if (/cardio/.test(d) || /\bcardiac\b/.test(d)) {
    return 'CARDIAC';
  }
  return 'GENERAL';
}

/**
 * GET /api/dashboard/doctor/summary?userId=N&date=YYYY-MM-DD
 *
 * Single-shot summary for the doctor-role dashboard. Returns KPIs, today's
 * consultation queue, 30-day trend, IPD round list, OT board for today,
 * diagnosis mix, follow-up adherence and an alerts feed in one round-trip
 * so the page can hydrate without N HTTP calls.
 *
 * Pulls only data scoped to this doctor — no admin-level leakage.
 */
export const getDoctorDashboardSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userIdRaw = req.query.userId as string | undefined;
    const dateParam = (req.query.date as string | undefined) || todayYmd();

    if (!userIdRaw) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const userId = parseInt(userIdRaw, 10);
    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'userId must be a number' });
      return;
    }

    // Resolve Doctor row from the User->Doctor relation.
    const doctor = await prisma.doctor.findFirst({
      where: { userId },
      select: { id: true, name: true, departmentName: true },
    });
    if (!doctor) {
      res.status(404).json({ error: 'No doctor record linked to this user' });
      return;
    }

    const todayStart = startOfDay(dateParam);
    const todayEnd = endOfDay(dateParam);
    const thirtyDaysAgo = daysAgoYmd(29);
    const thirtyDaysAgoDate = startOfDay(thirtyDaysAgo);
    const sevenDaysAgoStart = startOfDay(daysAgoYmd(6));

    // ─── Today's appointments for this doctor ──────────────────────────
    const todayAppts = await prisma.appointment.findMany({
      where: { doctorId: doctor.id, date: dateParam },
      orderBy: { time: 'asc' },
      select: {
        id: true,
        patientName: true,
        phoneNumber: true,
        age: true,
        gender: true,
        time: true,
        status: true,
        checkedIn: true,
        checkedInTime: true,
        endConsultation: true,
        endConsultationTime: true,
        BPs: true,
        BPd: true,
        pulse: true,
        spo2: true,
        temp: true,
        type: true,
        patientType: true,
      },
    });

    const todayScheduled = todayAppts.length;
    const todayDone = todayAppts.filter(
      (a) => a.status === 'completed' || a.endConsultation === true,
    ).length;
    const todayRemaining = Math.max(0, todayScheduled - todayDone);

    const nowMs = Date.now();
    const queue = todayAppts.map((a) => {
      let waitMins: number | null = null;
      if (a.checkedIn && a.checkedInTime && !a.endConsultation) {
        waitMins = Math.max(
          0,
          Math.floor((nowMs - new Date(a.checkedInTime).getTime()) / 60000),
        );
      }
      return {
        id: a.id,
        patientName: a.patientName,
        phoneNumber: a.phoneNumber,
        age: a.age,
        gender: a.gender,
        time: a.time,
        status: a.status,
        checkedIn: !!a.checkedIn,
        checkedInTime: a.checkedInTime,
        endConsultation: !!a.endConsultation,
        waitMins,
        BPs: a.BPs,
        BPd: a.BPd,
        pulse: a.pulse,
        spo2: a.spo2,
        temp: a.temp,
        type: a.type,
        patientType: a.patientType,
      };
    });

    // ─── IPD admissions under this doctor (active) ─────────────────────
    // IpdAdmission.admittingDoctor is a free-text snapshot — match by
    // contains so prefixes (e.g. "Dr. ") still hit.
    const activeIpdStatuses = ['admitted', 'BED_ACCEPTED'];
    const ipdAdmissions = await prisma.ipdAdmission.findMany({
      where: {
        admittingDoctor: { contains: doctor.name },
        status: { in: activeIpdStatuses },
      },
      select: {
        id: true,
        prn: true,
        admissionNo: true,
        admissionDate: true,
        diagnosis: true,
        roomType: true,
        icuAdmittedAt: true,
        icuDischargedAt: true,
        bed: { select: { bedNumber: true } },
        ward: { select: { wardName: true } },
      },
    });

    const ipdActive = ipdAdmissions.length;
    const ipdIcu = ipdAdmissions.filter(
      (a) => a.icuAdmittedAt && !a.icuDischargedAt,
    ).length;
    const admissionIds = ipdAdmissions.map((a) => a.id);

    // Patient names for the round list — pull via PRN. PRN on Appointment
    // is an Int; PatientDetails has the demographics. Best-effort.
    const prnNumbers = ipdAdmissions
      .map((a) => parseInt(a.prn, 10))
      .filter((n) => !Number.isNaN(n));

    let prnNameMap = new Map<number, string>();
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
    }

    // Last vitals per admission (batched — one query, grouped client-side).
    let lastVitalsByAdmission = new Map<
      string,
      {
        recordedAt: Date;
        bpSystolic: number | null;
        bpDiastolic: number | null;
        pulse: number | null;
        spo2: number | null;
        temperatureC: number | null;
      }
    >();
    if (admissionIds.length > 0) {
      const allVitals = await prisma.ipdVitalsReading.findMany({
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
      for (const v of allVitals) {
        if (!lastVitalsByAdmission.has(v.admissionId)) {
          lastVitalsByAdmission.set(v.admissionId, {
            recordedAt: v.recordedAt,
            bpSystolic: v.bpSystolic,
            bpDiastolic: v.bpDiastolic,
            pulse: v.pulse,
            spo2: v.spo2,
            temperatureC: v.temperatureC,
          });
        }
      }
    }

    // Pending non-drug orders per admission (status ORDERED|ACKNOWLEDGED).
    let pendingOrdersByAdmission = new Map<string, number>();
    if (admissionIds.length > 0) {
      const orderRows = await prisma.ipdNonDrugOrder.groupBy({
        by: ['admissionId'],
        where: {
          admissionId: { in: admissionIds },
          status: { in: ['ORDERED', 'ACKNOWLEDGED'] },
        },
        _count: { _all: true },
      });
      pendingOrdersByAdmission = new Map(
        orderRows.map((r) => [r.admissionId, r._count._all]),
      );
    }

    const todayDateOnly = startOfDay(dateParam);
    const ipdRound = ipdAdmissions.map((a) => {
      const prnInt = parseInt(a.prn, 10);
      const patientName = !Number.isNaN(prnInt)
        ? prnNameMap.get(prnInt) || ''
        : '';
      const dayOfStay = daysBetween(new Date(a.admissionDate), todayDateOnly) + 1;
      const lv = lastVitalsByAdmission.get(a.id);
      return {
        admissionId: a.id,
        admissionNo: a.admissionNo,
        prn: a.prn,
        patientName,
        bedNumber: a.bed?.bedNumber || null,
        wardName: a.ward?.wardName || null,
        roomType: a.roomType,
        dayOfStay,
        diagnosisShort:
          a.diagnosis && a.diagnosis.length > 80
            ? a.diagnosis.slice(0, 80) + '…'
            : a.diagnosis || '',
        icu: !!(a.icuAdmittedAt && !a.icuDischargedAt),
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
        pendingOrders: pendingOrdersByAdmission.get(a.id) || 0,
      };
    });

    // ─── Pending discharge summaries (not yet signed/delivered) ─────────
    const pendingDischargeSummaries = await prisma.ipdDischarge.count({
      where: {
        admission: { admittingDoctor: { contains: doctor.name } },
        NOT: { summaryStatus: { in: ['SIGNED', 'DELIVERED'] } },
      },
    });

    // ─── OT cases scheduled today (surgeon = me) ────────────────────────
    const otRows = await prisma.otSchedule.findMany({
      where: {
        surgeonId: doctor.id,
        date: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { plannedStart: 'asc' },
      select: {
        id: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        procedureName: true,
        patientName: true,
        prn: true,
        urgency: true,
        status: true,
        otRoom: { select: { name: true, code: true } },
      },
    });
    const otToday = otRows.map((r) => ({
      scheduleId: r.id,
      plannedStart: r.plannedStart,
      plannedEnd: r.plannedEnd,
      actualStart: r.actualStart,
      procedureName: r.procedureName,
      patientName: r.patientName || '',
      prn: r.prn || '',
      urgency: r.urgency,
      status: r.status,
      roomName: r.otRoom?.name || r.otRoom?.code || '',
    }));
    const otCasesToday = otRows.filter((r) => r.status !== 'CANCELLED').length;

    // ─── Avg consultation time last 7d ──────────────────────────────────
    const last7dCompleted = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        endConsultation: true,
        endConsultationTime: { gte: sevenDaysAgoStart },
        checkedInTime: { not: null },
      },
      select: { checkedInTime: true, endConsultationTime: true },
    });
    let avgConsultMins7d: number | null = null;
    if (last7dCompleted.length > 0) {
      const totalMs = last7dCompleted.reduce((sum, a) => {
        if (!a.checkedInTime || !a.endConsultationTime) return sum;
        return (
          sum +
          (new Date(a.endConsultationTime).getTime() -
            new Date(a.checkedInTime).getTime())
        );
      }, 0);
      avgConsultMins7d = Math.round(totalMs / last7dCompleted.length / 60000);
    }

    // ─── Patients-seen last 30 days (per-day count) ─────────────────────
    const last30Rows = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: thirtyDaysAgo, lte: dateParam },
        OR: [{ status: 'completed' }, { endConsultation: true }],
      },
      select: { date: true },
    });
    const countByDate = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      countByDate.set(daysAgoYmd(i), 0);
    }
    for (const row of last30Rows) {
      if (countByDate.has(row.date)) {
        countByDate.set(row.date, (countByDate.get(row.date) || 0) + 1);
      }
    }
    const last30Days = Array.from(countByDate.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // ─── Diagnosis mix (last 30 days, from ICD codes on this doctor's
    //     admissions) ─────────────────────────────────────────────────────
    // Pull admissions in last 30 days where this doctor admitted; aggregate
    // their AdmissionDiagnosisCode rows (icd-provisional + icd-final).
    const recentAdmissions = await prisma.ipdAdmission.findMany({
      where: {
        admittingDoctor: { contains: doctor.name },
        admissionDate: { gte: thirtyDaysAgoDate },
      },
      select: { id: true },
    });
    let diagnosisMix: Array<{ code: string; label: string; count: number }> = [];
    if (recentAdmissions.length > 0) {
      const diagnosisRows = await prisma.admissionDiagnosisCode.groupBy({
        by: ['code', 'description'],
        where: {
          admissionId: { in: recentAdmissions.map((a) => a.id) },
          category: { in: ['icd-provisional', 'icd-final'] },
        },
        _count: { _all: true },
        orderBy: { _count: { code: 'desc' } },
        take: 6,
      });
      diagnosisMix = diagnosisRows.map((d) => ({
        code: d.code,
        label:
          d.description && d.description.length > 40
            ? d.description.slice(0, 40) + '…'
            : d.description || d.code,
        count: d._count._all,
      }));
    }

    // ─── Follow-up adherence (last 30 days) ─────────────────────────────
    // Uses Appointment.isfollowup as the marker (per-doctor, simple). An
    // adherent follow-up = the patient actually checked in (or consultation
    // ended). Non-adherent = scheduled but did not arrive.
    const followUpAppts = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        isfollowup: true,
        date: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: { checkedIn: true, endConsultation: true, status: true },
    });
    const followUpScheduled = followUpAppts.length;
    const followUpReturned = followUpAppts.filter(
      (a) =>
        a.checkedIn === true ||
        a.endConsultation === true ||
        a.status === 'completed',
    ).length;
    const followUpAdherence = {
      scheduled: followUpScheduled,
      returned: followUpReturned,
      percent:
        followUpScheduled > 0
          ? Math.round((followUpReturned / followUpScheduled) * 100)
          : null,
    };

    // ─── Alerts feed ────────────────────────────────────────────────────
    // 1. Critical lab/radiology results for this doctor's IPD patients
    //    (last 24h, criticalFlag = true).
    const dayAgo = new Date();
    dayAgo.setDate(dayAgo.getDate() - 1);

    const ipdPrns = ipdAdmissions.map((a) => a.prn).filter(Boolean);
    let criticalResultsRaw: Array<{
      id: number;
      prn: string;
      testName: string;
      department: string;
      reportedAt: Date | null;
      createdAt: Date;
    }> = [];
    if (ipdPrns.length > 0) {
      criticalResultsRaw = await prisma.investigationResult.findMany({
        where: {
          prn: { in: ipdPrns },
          criticalFlag: true,
          createdAt: { gte: dayAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          prn: true,
          testName: true,
          department: true,
          reportedAt: true,
          createdAt: true,
        },
      });
    }
    const criticalLabAlerts = criticalResultsRaw.map((r) => {
      const prnInt = parseInt(r.prn, 10);
      const patientName = !Number.isNaN(prnInt)
        ? prnNameMap.get(prnInt) || ''
        : '';
      return {
        type: 'critical-result' as const,
        severity: 'high' as const,
        title: `Critical ${r.department === 'radiology' ? 'imaging' : 'lab'} result`,
        message: patientName
          ? `${r.testName} — ${patientName} (PRN ${r.prn})`
          : `${r.testName} — PRN ${r.prn}`,
        at: r.reportedAt || r.createdAt,
        link: null as string | null,
      };
    });

    // 2. Pending consent signatures for this doctor's admissions (status
    //    DEFERRED — not yet completed).
    let pendingConsentAlerts: Array<{
      type: 'pending-consent';
      severity: 'medium';
      title: string;
      message: string;
      at: Date;
      link: string | null;
    }> = [];
    if (admissionIds.length > 0) {
      const consents = await prisma.consentSignature.findMany({
        where: {
          contextType: 'admission',
          contextId: { in: admissionIds },
          status: 'DEFERRED',
        },
        orderBy: { signedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          contextId: true,
          consentType: true,
          patientName: true,
          signedAt: true,
          deferredReason: true,
        },
      });
      pendingConsentAlerts = consents.map((c) => ({
        type: 'pending-consent' as const,
        severity: 'medium' as const,
        title: 'Deferred consent',
        message: c.patientName
          ? `${c.consentType} — ${c.patientName}`
          : c.consentType,
        at: c.signedAt,
        link: null,
      }));
    }

    // 3. Unsigned discharge summaries (already counted in KPI; surface as
    //    individual rows for action).
    let pendingDischargeAlerts: Array<{
      type: 'pending-discharge';
      severity: 'medium';
      title: string;
      message: string;
      at: Date;
      link: string | null;
    }> = [];
    if (admissionIds.length > 0) {
      const dischargeRows = await prisma.ipdDischarge.findMany({
        where: {
          admissionId: { in: admissionIds },
          NOT: { summaryStatus: { in: ['SIGNED', 'DELIVERED'] } },
        },
        orderBy: { dischargeDate: 'desc' },
        take: 5,
        select: {
          admissionId: true,
          dischargeDate: true,
          summaryStatus: true,
          admission: { select: { prn: true } },
        },
      });
      pendingDischargeAlerts = dischargeRows.map((d) => {
        const prnInt = parseInt(d.admission?.prn || '', 10);
        const patientName = !Number.isNaN(prnInt)
          ? prnNameMap.get(prnInt) || ''
          : '';
        return {
          type: 'pending-discharge' as const,
          severity: 'medium' as const,
          title: 'Discharge summary unsigned',
          message: patientName
            ? `${patientName} — PRN ${d.admission?.prn}`
            : `PRN ${d.admission?.prn || '—'}`,
          at: d.dischargeDate,
          link: `/ipd/admission/${d.admissionId}/discharge`,
        };
      });
    }

    const alerts = [
      ...criticalLabAlerts,
      ...pendingDischargeAlerts,
      ...pendingConsentAlerts,
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    // ─── Performance strip ──────────────────────────────────────────────
    // Today's avg wait time: arrivedTime - checkedInTime for today's appts.
    // 7d sparkline: per-day avg wait for last 7 days (oldest first).
    const todayWaitSamples = todayAppts
      .map((a) => {
        if (!a.checkedInTime) return null;
        const at = (a as any).arrivedTime as Date | null | undefined;
        if (!at) return null;
        return Math.max(
          0,
          (new Date(at).getTime() - new Date(a.checkedInTime).getTime()) / 60000,
        );
      })
      .filter((n): n is number => n !== null);
    const avgWaitMinsToday =
      todayWaitSamples.length > 0
        ? Math.round(
            todayWaitSamples.reduce((s, n) => s + n, 0) / todayWaitSamples.length,
          )
        : null;

    // Per-day wait for last 7 days (sparkline). One query, then bucket.
    const sevenDayAppts = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: daysAgoYmd(6), lte: dateParam },
        checkedInTime: { not: null },
        arrivedTime: { not: null },
      },
      select: { date: true, checkedInTime: true, arrivedTime: true },
    });
    const waitByDate = new Map<string, number[]>();
    for (let i = 6; i >= 0; i--) waitByDate.set(daysAgoYmd(i), []);
    for (const a of sevenDayAppts) {
      if (!a.checkedInTime || !a.arrivedTime) continue;
      const w = Math.max(
        0,
        (new Date(a.arrivedTime).getTime() -
          new Date(a.checkedInTime).getTime()) /
          60000,
      );
      const bucket = waitByDate.get(a.date);
      if (bucket) bucket.push(w);
    }
    const avgWaitMinsLast7d = Array.from(waitByDate.entries()).map(
      ([, arr]) =>
        arr.length > 0
          ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length)
          : 0,
    );

    // No-show today: scheduled, past-time, not arrived/checkedIn, not cancelled.
    const nowDate = new Date();
    const isToday = dateParam === todayYmd();
    const noShowToday = (() => {
      if (!isToday) return { count: 0, total: todayAppts.length, percent: null as number | null };
      const scheduledCount = todayAppts.filter(
        (a) => a.status !== 'cancelled',
      ).length;
      // Approximate "past time" by string-comparing HH:MM components when possible.
      const noShows = todayAppts.filter((a) => {
        if (a.status === 'cancelled') return false;
        if (a.checkedIn || a.endConsultation) return false;
        if (a.status === 'completed') return false;
        // Parse appt time "HH:MM AM/PM" — if it's already past now, count as no-show.
        const t = a.time?.trim() || '';
        const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (!m) return false;
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const period = (m[3] || '').toUpperCase();
        if (period === 'PM' && h < 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        const apptMinutes = h * 60 + min;
        const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
        return apptMinutes < nowMinutes - 15; // 15-min grace window
      }).length;
      return {
        count: noShows,
        total: scheduledCount,
        percent:
          scheduledCount > 0 ? Math.round((noShows / scheduledCount) * 100) : null,
      };
    })();

    // No-show rate last 7d (excluding today).
    const past7dAppts = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: daysAgoYmd(7), lt: dateParam },
        status: { not: 'cancelled' },
      },
      select: { checkedIn: true, endConsultation: true, status: true },
    });
    const past7dNoShows = past7dAppts.filter(
      (a) =>
        !a.checkedIn && !a.endConsultation && a.status !== 'completed',
    ).length;
    const noShowLast7dPercent =
      past7dAppts.length > 0
        ? Math.round((past7dNoShows / past7dAppts.length) * 100)
        : null;

    // Patient mix (last 30d): new vs follow-up vs referral.
    const last30AllAppts = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: { isNew: true, isfollowup: true, isReferred: true },
    });
    const patientMix = {
      newCount: last30AllAppts.filter((a) => a.isNew === true).length,
      followupCount: last30AllAppts.filter((a) => a.isfollowup === true).length,
      referralCount: last30AllAppts.filter((a) => a.isReferred === true).length,
    };

    // Critical-result rate (7d): for this doctor's IPD-patient PRNs.
    let criticalRate7d: { critical: number; total: number; percent: number | null } = {
      critical: 0,
      total: 0,
      percent: null,
    };
    if (ipdPrns.length > 0) {
      const sevenDayAgo = new Date();
      sevenDayAgo.setDate(sevenDayAgo.getDate() - 7);
      const sevenDayResults = await prisma.investigationResult.findMany({
        where: {
          prn: { in: ipdPrns },
          createdAt: { gte: sevenDayAgo },
        },
        select: { criticalFlag: true },
      });
      const total = sevenDayResults.length;
      const critical = sevenDayResults.filter((r) => r.criticalFlag).length;
      criticalRate7d = {
        critical,
        total,
        percent: total > 0 ? Math.round((critical / total) * 100) : null,
      };
    }

    const performance = {
      avgWaitMinsToday,
      avgWaitMinsLast7d,
      noShowToday,
      noShowLast7dPercent,
      patientMix,
      criticalRate7d,
    };

    // ─── Demographics (last 30d) ────────────────────────────────────────
    // Pulled from the same last30AllAppts list. Age field is a free-text
    // string ("45", "45 yrs", "2 mo") — best-effort parse to leading int.
    const genderCounts = new Map<string, number>();
    const ageBandCounts: Record<string, number> = {
      '0-18': 0,
      '19-30': 0,
      '31-50': 0,
      '51-70': 0,
      '70+': 0,
    };
    // Pull a fuller select for demographics — we only had isNew/isfollowup/
    // isReferred above. Cheaper to refetch with the demographic fields.
    const demoAppts = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: { gender: true, age: true },
    });
    for (const a of demoAppts) {
      const g = (a.gender || 'Unknown').trim();
      const norm =
        g.toLowerCase().startsWith('m') ? 'Male' :
        g.toLowerCase().startsWith('f') ? 'Female' :
        g.toLowerCase().startsWith('o') ? 'Other' : 'Unknown';
      genderCounts.set(norm, (genderCounts.get(norm) || 0) + 1);

      const ageMatch = (a.age || '').match(/(\d+)/);
      if (ageMatch) {
        const ageInt = parseInt(ageMatch[1], 10);
        if (ageInt <= 18) ageBandCounts['0-18']++;
        else if (ageInt <= 30) ageBandCounts['19-30']++;
        else if (ageInt <= 50) ageBandCounts['31-50']++;
        else if (ageInt <= 70) ageBandCounts['51-70']++;
        else ageBandCounts['70+']++;
      }
    }
    const demographics = {
      gender: Array.from(genderCounts.entries()).map(([name, value]) => ({
        name,
        value,
      })),
      ageBands: Object.entries(ageBandCounts).map(([band, count]) => ({
        band,
        count,
      })),
    };

    // ─── Hour-of-day arrival heatmap (last 30d) ─────────────────────────
    // Bucket Appointment.time into 24 hour-of-day slots. Time strings are
    // "h:mm AM/PM" so we parse to hours-since-midnight.
    const hourBuckets = new Array(24).fill(0);
    const timeRows = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: { time: true },
    });
    for (const r of timeRows) {
      const t = (r.time || '').trim();
      const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!m) continue;
      let h = parseInt(m[1], 10);
      const period = (m[3] || '').toUpperCase();
      if (period === 'PM' && h < 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      if (h >= 0 && h < 24) hourBuckets[h]++;
    }
    const hourHeatmap = hourBuckets.map((count, hour) => ({ hour, count }));

    // ─── Top medications prescribed (last 30d) ──────────────────────────
    // Match prescriptions by `prescribedBy` containing the doctor's name
    // (snapshot field) within the last 30 days. Aggregate tablets by
    // genericName.
    const recentPrescriptions = await prisma.prescription.findMany({
      where: {
        prescribedBy: { contains: doctor.name },
        prescribedDate: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: {
        tablets: { select: { genericName: true, brandName: true } },
      },
    });
    const medCounts = new Map<string, number>();
    for (const p of recentPrescriptions) {
      for (const t of p.tablets) {
        const key = (t.genericName || t.brandName || '').trim();
        if (!key) continue;
        medCounts.set(key, (medCounts.get(key) || 0) + 1);
      }
    }
    const topMedications = Array.from(medCounts.entries())
      .map(([genericName, count]) => ({ genericName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ─── Top investigations ordered (last 30d) ──────────────────────────
    const recentOrders = await prisma.investigationOrder.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: {
        labTests: { select: { description: true } },
        radiologyTests: { select: { description: true } },
      },
    });
    const testCounts = new Map<string, { count: number; type: 'lab' | 'radiology' }>();
    for (const o of recentOrders) {
      for (const lt of o.labTests) {
        const name = (lt.description || '').trim();
        if (!name) continue;
        const k = `lab::${name}`;
        const cur = testCounts.get(k);
        testCounts.set(k, { count: (cur?.count || 0) + 1, type: 'lab' });
      }
      for (const rt of o.radiologyTests) {
        const name = (rt.description || '').trim();
        if (!name) continue;
        const k = `radiology::${name}`;
        const cur = testCounts.get(k);
        testCounts.set(k, { count: (cur?.count || 0) + 1, type: 'radiology' });
      }
    }
    const topInvestigations = Array.from(testCounts.entries())
      .map(([k, v]) => ({
        name: k.split('::')[1],
        type: v.type,
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ─── Specialty-aware blocks ─────────────────────────────────────────
    // One blob keyed by group; only the matching one is populated. The
    // frontend renders conditional sections on `specialtyGroup`.
    const specialtyGroup = specialtyGroupFor(doctor.departmentName || '');

    // SURGICAL — OT performance stats (30d) + Pre-op pipeline (next 7d)
    let otPerformance: {
      avgPlannedMins: number | null;
      avgActualMins: number | null;
      onTimeStartPercent: number | null;
      last30dCases: number;
      cancelPercent: number | null;
    } | null = null;
    let preOpPipeline: Array<{
      scheduleId: string;
      plannedStart: string;
      procedureName: string;
      patientName: string;
      prn: string;
      urgency: string;
      status: string;
      roomName: string;
      daysFromNow: number;
    }> = [];
    if (specialtyGroup === 'SURGICAL') {
      const last30OtRows = await prisma.otSchedule.findMany({
        where: {
          surgeonId: doctor.id,
          date: { gte: thirtyDaysAgoDate, lte: todayEnd },
        },
        select: {
          plannedStart: true,
          plannedEnd: true,
          actualStart: true,
          actualEnd: true,
          status: true,
        },
      });
      const last30dCases = last30OtRows.length;
      const cancelled = last30OtRows.filter((r) => r.status === 'CANCELLED').length;
      const cancelPercent =
        last30dCases > 0 ? Math.round((cancelled / last30dCases) * 100) : null;

      const plannedDurations = last30OtRows
        .map((r) => {
          if (!r.plannedStart || !r.plannedEnd) return null;
          return (
            (new Date(r.plannedEnd).getTime() -
              new Date(r.plannedStart).getTime()) /
            60000
          );
        })
        .filter((n): n is number => n !== null && n > 0);
      const actualDurations = last30OtRows
        .map((r) => {
          if (!r.actualStart || !r.actualEnd) return null;
          return (
            (new Date(r.actualEnd).getTime() -
              new Date(r.actualStart).getTime()) /
            60000
          );
        })
        .filter((n): n is number => n !== null && n > 0);
      const onTimeSamples = last30OtRows
        .map((r) => {
          if (!r.plannedStart || !r.actualStart) return null;
          const drift =
            (new Date(r.actualStart).getTime() -
              new Date(r.plannedStart).getTime()) /
            60000;
          return drift;
        })
        .filter((n): n is number => n !== null);

      otPerformance = {
        avgPlannedMins:
          plannedDurations.length > 0
            ? Math.round(plannedDurations.reduce((s, n) => s + n, 0) / plannedDurations.length)
            : null,
        avgActualMins:
          actualDurations.length > 0
            ? Math.round(actualDurations.reduce((s, n) => s + n, 0) / actualDurations.length)
            : null,
        onTimeStartPercent:
          onTimeSamples.length > 0
            ? Math.round(
                (onTimeSamples.filter((n) => n <= 15).length / onTimeSamples.length) *
                  100,
              )
            : null,
        last30dCases,
        cancelPercent,
      };

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const preOpRows = await prisma.otSchedule.findMany({
        where: {
          surgeonId: doctor.id,
          date: { gt: todayEnd, lte: nextWeek },
          status: { in: ['BOOKED', 'CONFIRMED'] },
        },
        orderBy: { plannedStart: 'asc' },
        take: 20,
        select: {
          id: true,
          plannedStart: true,
          procedureName: true,
          patientName: true,
          prn: true,
          urgency: true,
          status: true,
          otRoom: { select: { name: true, code: true } },
        },
      });
      const todayMs = todayStart.getTime();
      preOpPipeline = preOpRows.map((r) => ({
        scheduleId: r.id,
        plannedStart: r.plannedStart.toISOString(),
        procedureName: r.procedureName,
        patientName: r.patientName || '',
        prn: r.prn || '',
        urgency: r.urgency,
        status: r.status,
        roomName: r.otRoom?.name || r.otRoom?.code || '',
        daysFromNow: Math.max(
          0,
          Math.floor((new Date(r.plannedStart).getTime() - todayMs) / 86400000),
        ),
      }));
    }

    // CARDIAC — count cardiac-specific tests (heuristic) + signal that the
    // IPD round list should be re-sorted with ICU patients first.
    let cardiacTests30d: Array<{ name: string; count: number }> = [];
    if (specialtyGroup === 'CARDIAC') {
      const cardiacPatterns = [
        { key: 'ECG', re: /\becg\b|electrocardiogram/i },
        { key: 'Echo', re: /\becho\b|echocardiogram/i },
        { key: 'Troponin', re: /troponin/i },
        { key: 'CK-MB', re: /ck.?mb/i },
        { key: 'TMT', re: /\btmt\b|treadmill/i },
        { key: 'Holter', re: /holter/i },
        { key: 'Angio', re: /angiogr/i },
      ];
      const counts = new Map<string, number>();
      for (const o of recentOrders) {
        const allNames = [
          ...o.labTests.map((t) => t.description || ''),
          ...o.radiologyTests.map((t) => t.description || ''),
        ];
        for (const name of allNames) {
          for (const p of cardiacPatterns) {
            if (p.re.test(name)) {
              counts.set(p.key, (counts.get(p.key) || 0) + 1);
            }
          }
        }
      }
      cardiacTests30d = cardiacPatterns
        .map((p) => ({ name: p.key, count: counts.get(p.key) || 0 }))
        .filter((r) => r.count > 0);
    }
    // Re-sort IPD round so ICU patients float to top for CARDIAC. The
    // existing `ipdRound` array is already built; mutate before sending.
    if (specialtyGroup === 'CARDIAC') {
      ipdRound.sort((a, b) => {
        if (a.icu && !b.icu) return -1;
        if (!a.icu && b.icu) return 1;
        return b.dayOfStay - a.dayOfStay;
      });
    }

    // PEDIATRICS — recompute age bands with pediatric buckets (0-1y, 1-5y,
    // 6-12y, 13-18y, 18+). 18+ kept so adult comorbids show up.
    let pediatricAgeBands: Array<{ band: string; count: number }> | null = null;
    if (specialtyGroup === 'PEDIATRICS') {
      const buckets: Record<string, number> = {
        '0-1y': 0,
        '1-5y': 0,
        '6-12y': 0,
        '13-18y': 0,
        '18+': 0,
      };
      for (const a of demoAppts) {
        const m = (a.age || '').match(/(\d+)/);
        if (!m) continue;
        const age = parseInt(m[1], 10);
        // Best-effort month detection: if the original string says "mo" /
        // "month", treat as <1y regardless of leading int.
        const isMonths = /mo\b|month/i.test(a.age || '');
        if (isMonths || age < 1) buckets['0-1y']++;
        else if (age <= 5) buckets['1-5y']++;
        else if (age <= 12) buckets['6-12y']++;
        else if (age <= 18) buckets['13-18y']++;
        else buckets['18+']++;
      }
      pediatricAgeBands = Object.entries(buckets).map(([band, count]) => ({
        band,
        count,
      }));
    }

    // OBGYN — pregnant in-patients with weeks-along. Pulled from
    // IpdInitialAssessment.isPregnant flag for this doctor's admissions.
    let antenatalPatients: Array<{
      admissionId: string;
      patientName: string;
      prn: string;
      bedNumber: string | null;
      wardName: string | null;
      pregnancyWeeks: number | null;
      isLactating: boolean;
      dayOfStay: number;
    }> = [];
    if (specialtyGroup === 'OBGYN' && admissionIds.length > 0) {
      const pregAssessments = await prisma.ipdInitialAssessment.findMany({
        where: {
          admissionId: { in: admissionIds },
          OR: [{ isPregnant: true }, { isLactating: true }],
        },
        select: {
          admissionId: true,
          isPregnant: true,
          pregnancyWeeks: true,
          isLactating: true,
        },
      });
      const admissionById = new Map(ipdAdmissions.map((a) => [a.id, a]));
      antenatalPatients = pregAssessments
        .map((p) => {
          const adm = admissionById.get(p.admissionId);
          if (!adm) return null;
          const prnInt = parseInt(adm.prn, 10);
          const patientName = !Number.isNaN(prnInt)
            ? prnNameMap.get(prnInt) || ''
            : '';
          const dayOfStay = daysBetween(new Date(adm.admissionDate), todayDateOnly) + 1;
          return {
            admissionId: adm.id,
            patientName,
            prn: adm.prn,
            bedNumber: adm.bed?.bedNumber || null,
            wardName: adm.ward?.wardName || null,
            pregnancyWeeks: p.isPregnant ? p.pregnancyWeeks : null,
            isLactating: p.isLactating,
            dayOfStay,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    }

    // EMERGENCY — live ER board (not doctor-scoped: ER physicians handle
    // whatever comes in). Active = status in arrived | stabilized.
    let erActiveBoard: Array<{
      id: number;
      prn: string;
      patientName: string;
      age: number | null;
      gender: string | null;
      triageCategory: string;
      presentingComplaint: string;
      status: string;
      vitalsBP: string | null;
      vitalsHR: number | null;
      vitalsSpO2: number | null;
      createdAt: string;
      ageMinutes: number;
    }> = [];
    let erTriageMix: Array<{ category: string; count: number }> = [];
    if (specialtyGroup === 'EMERGENCY') {
      const erRows = await prisma.emergency.findMany({
        where: { status: { in: ['arrived', 'stabilized'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          prn: true,
          patientName: true,
          age: true,
          gender: true,
          triageCategory: true,
          presentingComplaint: true,
          status: true,
          vitalsBP: true,
          vitalsHR: true,
          vitalsSpO2: true,
          createdAt: true,
        },
      });
      const triageRank = (t: string): number => {
        switch ((t || '').toLowerCase()) {
          case 'red':
            return 0;
          case 'yellow':
            return 1;
          case 'green':
            return 2;
          case 'black':
            return 3;
          default:
            return 4;
        }
      };
      const nowMs2 = Date.now();
      erActiveBoard = erRows
        .map((r) => ({
          id: r.id,
          prn: r.prn,
          patientName: r.patientName,
          age: r.age,
          gender: r.gender,
          triageCategory: r.triageCategory,
          presentingComplaint:
            r.presentingComplaint && r.presentingComplaint.length > 80
              ? r.presentingComplaint.slice(0, 80) + '…'
              : r.presentingComplaint || '',
          status: r.status,
          vitalsBP: r.vitalsBP,
          vitalsHR: r.vitalsHR,
          vitalsSpO2: r.vitalsSpO2,
          createdAt: r.createdAt.toISOString(),
          ageMinutes: Math.max(
            0,
            Math.floor((nowMs2 - new Date(r.createdAt).getTime()) / 60000),
          ),
        }))
        .sort((a, b) => {
          const dr = triageRank(a.triageCategory) - triageRank(b.triageCategory);
          if (dr !== 0) return dr;
          return b.ageMinutes - a.ageMinutes;
        });

      const triageCounts = new Map<string, number>();
      for (const r of erRows) {
        const k = (r.triageCategory || 'unknown').toLowerCase();
        triageCounts.set(k, (triageCounts.get(k) || 0) + 1);
      }
      erTriageMix = ['red', 'yellow', 'green', 'black'].map((c) => ({
        category: c,
        count: triageCounts.get(c) || 0,
      }));
    }

    // ─── LOS for my active IPD list ─────────────────────────────────────
    const myIpdLos = ipdAdmissions
      .map((a) => ({
        admissionId: a.id,
        prn: a.prn,
        dayOfStay: daysBetween(new Date(a.admissionDate), todayDateOnly) + 1,
      }))
      .sort((a, b) => b.dayOfStay - a.dayOfStay)
      .slice(0, 8);

    // ─── My MAR compliance today (% of meds administered vs total
    //     prescribed doses for today) ─────────────────────────────────────
    let marCompliance: { administered: number; total: number; percent: number | null } = {
      administered: 0,
      total: 0,
      percent: null,
    };
    if (admissionIds.length > 0) {
      const allRx = await prisma.ipdPrescription.findMany({
        where: { admissionId: { in: admissionIds }, status: 'active' },
        select: { id: true, frequency: true, adminStatus: true },
      });
      // Crude denominator: each active prescription contributes 1 expected
      // dose for today. Numerator: count where adminStatus = 'administered'.
      const total = allRx.length;
      const administered = allRx.filter((r) => r.adminStatus === 'administered').length;
      marCompliance = {
        administered,
        total,
        percent: total > 0 ? Math.round((administered / total) * 100) : null,
      };
    }

    // ─── Investigation TAT (avg hours from order → first result) for
    //     this doctor's orders in last 30d ───────────────────────────────
    const recentOrdersWithResults = await prisma.investigationOrder.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: thirtyDaysAgo, lte: dateParam },
      },
      select: { id: true, date: true, createdAt: true },
    });
    const orderIds = recentOrdersWithResults.map((o) => o.id);
    let investigationTatHours: number | null = null;
    let resultedCount = 0;
    if (orderIds.length > 0) {
      const results = await prisma.investigationResult.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, reportedAt: true, createdAt: true },
      });
      const firstResultByOrder = new Map<number, Date>();
      for (const r of results) {
        const ts = r.reportedAt || r.createdAt;
        if (!firstResultByOrder.has(r.orderId)) {
          firstResultByOrder.set(r.orderId, ts);
        }
      }
      const tatSamples: number[] = [];
      for (const o of recentOrdersWithResults) {
        const t = firstResultByOrder.get(o.id);
        if (!t) continue;
        const orderTs = new Date(o.createdAt).getTime();
        const resultTs = new Date(t).getTime();
        const hours = (resultTs - orderTs) / 3600000;
        if (hours >= 0 && hours < 720) tatSamples.push(hours);
      }
      resultedCount = tatSamples.length;
      if (tatSamples.length > 0) {
        investigationTatHours = Math.round(
          (tatSamples.reduce((s, n) => s + n, 0) / tatSamples.length) * 10,
        ) / 10;
      }
    }

    res.json({
      doctor: {
        id: doctor.id,
        name: doctor.name,
        departmentName: doctor.departmentName,
      },
      date: dateParam,
      kpis: {
        todayScheduled,
        todayDone,
        todayRemaining,
        ipdActive,
        ipdIcu,
        pendingDischargeSummaries,
        otCasesToday,
        avgConsultMins7d,
      },
      queue,
      last30Days,
      ipdRound,
      otToday,
      diagnosisMix,
      followUpAdherence,
      alerts,
      performance,
      demographics,
      hourHeatmap,
      topMedications,
      topInvestigations,
      specialtyGroup,
      otPerformance,
      preOpPipeline,
      cardiacTests30d,
      pediatricAgeBands,
      antenatalPatients,
      erActiveBoard,
      erTriageMix,
      myIpdLos,
      marCompliance,
      investigationTat: { hours: investigationTatHours, resultedCount },
    });
  } catch (err) {
    console.error('[dashboard.doctor.summary] error:', err);
    res.status(500).json({ error: 'Failed to load doctor dashboard summary' });
  }
};
