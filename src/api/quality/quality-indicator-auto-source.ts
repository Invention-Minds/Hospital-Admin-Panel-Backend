import prisma from '../../service/prisma-client';
import { getQiDef } from './quality-indicator-catalogue';

// Phase 9.26 / Phase 2 — auto-source library for derivable NABH indicators.
//
// Each derivable indicator has one async function that:
//   1. Reads its source data from existing models scoped to [periodStart, periodEnd].
//   2. Returns { numerator, denominator } so the caller can run the status engine
//      and upsert a QualityIndicatorRecord.
// Returns null when there's no data to record (denominator=0 for rate indicators,
// or sentinel-count style indicators choose to write 0 deliberately).
//
// All functions are PURE WRT the catalogue / status engine — they only fetch
// raw counts. Status / severity evaluation is done by the cron caller via
// evaluateForDef(). This split keeps the source functions trivially testable.

export type AutoSourceResult = { numerator: number; denominator: number } | null;
export type AutoSourceFn = (periodStart: Date, periodEnd: Date) => Promise<AutoSourceResult>;

// ─── Patient-day helper ──────────────────────────────────────────────────
// For rate-per-1000-patient-days indicators (PSQ-024, PSQ-025). We bound each
// admission to the period: clip to max(admissionDate, periodStart) →
// min(discharge.dischargeDate ?? periodEnd, periodEnd) and sum the days.

async function patientDaysInPeriod(periodStart: Date, periodEnd: Date): Promise<number> {
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      admissionDate: { lte: periodEnd },
      OR: [
        { discharge: { is: null } },
        { discharge: { is: { dischargeDate: { gte: periodStart } } } },
      ],
    },
    select: {
      admissionDate: true,
      discharge: { select: { dischargeDate: true } },
    },
    take: 20000,
  });

  let totalMs = 0;
  for (const a of admissions) {
    const start = a.admissionDate > periodStart ? a.admissionDate : periodStart;
    const end = a.discharge?.dischargeDate
      ? (a.discharge.dischargeDate < periodEnd ? a.discharge.dischargeDate : periodEnd)
      : periodEnd;
    const delta = end.getTime() - start.getTime();
    if (delta > 0) totalMs += delta;
  }
  return totalMs / (24 * 60 * 60 * 1000); // ms → days
}

// ─── PSQ-001 — IPD initial assessment TAT (avg minutes) ─────────────────
// numeratorDef: Sum of minutes from patient arrival at ward bed to initial
// assessment completed/documented
// denominatorDef: Total number of IP admissions
// multiplier: NA (average)
//
// Approximation: ward-bed arrival ≈ admissionDate (we don't have a separate
// "bed allocated" timestamp). We sum (consultantSignedAt - admissionDate)
// across CONSULTANT_SIGNED assessments only — incomplete assessments are
// excluded from BOTH numerator and denominator so a missing form doesn't
// poison the average.

export const psq001_initialAssessmentTat: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.ipdAdmission.findMany({
    where: { admissionDate: { gte: periodStart, lte: periodEnd } },
    select: {
      admissionDate: true,
      initialAssessment: { select: { status: true, consultantSignedAt: true } },
    },
    take: 20000,
  });
  let totalMinutes = 0;
  let count = 0;
  for (const a of rows) {
    const ia = a.initialAssessment;
    if (!ia || ia.status !== 'CONSULTANT_SIGNED' || !ia.consultantSignedAt) continue;
    const mins = (ia.consultantSignedAt.getTime() - a.admissionDate.getTime()) / 60_000;
    if (mins < 0) continue;
    totalMinutes += mins;
    count += 1;
  }
  if (count === 0) return null;
  return { numerator: totalMinutes, denominator: count };
};

// ─── PSQ-010 — Discharge summary completion within TAT (%) ──────────────
// numeratorDef: Discharge summaries completed within target TAT
// denominatorDef: Total discharges
// multiplier: 100
// Target TAT: 24h from dischargeDate to clinicianSignedAt.

export const psq010_dischargeSummaryWithinTat: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.ipdDischarge.findMany({
    where: { dischargeDate: { gte: periodStart, lte: periodEnd } },
    select: { dischargeDate: true, summaryStatus: true, clinicianSignedAt: true },
    take: 20000,
  });
  if (rows.length === 0) return null;
  let within = 0;
  for (const d of rows) {
    if (!(d.summaryStatus === 'SIGNED' || d.summaryStatus === 'DELIVERED')) continue;
    if (!d.clinicianSignedAt) continue;
    const hrs = (d.clinicianSignedAt.getTime() - d.dischargeDate.getTime()) / 3_600_000;
    if (hrs <= 24) within += 1;
  }
  return { numerator: within, denominator: rows.length };
};

// ─── PSQ-024 — Patient fall rate (falls / 1000 patient days) ────────────

export const psq024_fallRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const falls = await prisma.incident.count({
    where: {
      reportedAt: { gte: periodStart, lte: periodEnd },
      category: 'fall',
    },
  });
  const days = await patientDaysInPeriod(periodStart, periodEnd);
  if (days === 0) return null;
  return { numerator: falls, denominator: days };
};

// ─── PSQ-025 — Fall with injury rate (falls with injury / 1000 patient days) ─
// "Injury" inferred from severity >= moderate. near_miss / minor are excluded.

export const psq025_fallWithInjuryRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const falls = await prisma.incident.count({
    where: {
      reportedAt: { gte: periodStart, lte: periodEnd },
      category: 'fall',
      severity: { in: ['moderate', 'major', 'sentinel'] },
    },
  });
  const days = await patientDaysInPeriod(periodStart, periodEnd);
  if (days === 0) return null;
  return { numerator: falls, denominator: days };
};

// ─── PSQ-028 — Adverse clinical events rate (%) ─────────────────────────
// numeratorDef: Number of adverse clinical events reported
// denominatorDef: Total admissions
// multiplier: 100

export const psq028_adverseClinicalEvents: AutoSourceFn = async (periodStart, periodEnd) => {
  const [events, admissions] = await Promise.all([
    prisma.incident.count({
      where: {
        reportedAt: { gte: periodStart, lte: periodEnd },
        category: 'clinical',
        severity: { in: ['moderate', 'major', 'sentinel'] },
      },
    }),
    prisma.ipdAdmission.count({
      where: { admissionDate: { gte: periodStart, lte: periodEnd } },
    }),
  ]);
  if (admissions === 0) return null;
  return { numerator: events, denominator: admissions };
};

// ─── PSQ-029 — Sentinel events count ────────────────────────────────────
// Special: denominator NA, multiplier NA. We return numerator as the count
// and denominator=1 so computeValue('NA') returns the raw count (the engine
// rounds num/den * 1 to 2dp; passing 1 as denominator yields the count).
// Zero-tolerance per spec — 0 is the only green value.

export const psq029_sentinelCount: AutoSourceFn = async (periodStart, periodEnd) => {
  const count = await prisma.incident.count({
    where: {
      reportedAt: { gte: periodStart, lte: periodEnd },
      severity: 'sentinel',
    },
  });
  return { numerator: count, denominator: 1 }; // always record — sentinel is zero-tol
};

// ─── PRE-001 — Patient satisfaction score - OPD (%) ─────────────────────
// numeratorDef: Sum of OPD satisfaction scores or satisfied responses
// denominatorDef: Total OPD survey responses
// multiplier: 100
// We use NPS ≥ 7 (passive + promoter) as "satisfied".

export const pre001_opdSatisfaction: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.feedbackSurvey.findMany({
    where: {
      template: 'opd-post-visit',
      status: 'completed',
      npsScore: { not: null },
      respondedAt: { gte: periodStart, lte: periodEnd },
    },
    select: { npsScore: true },
    take: 20000,
  });
  if (rows.length === 0) return null;
  const satisfied = rows.filter((r) => (r.npsScore ?? 0) >= 7).length;
  return { numerator: satisfied, denominator: rows.length };
};

// ─── PRE-002 — Patient satisfaction score - IPD (%) ─────────────────────

export const pre002_ipdSatisfaction: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.feedbackSurvey.findMany({
    where: {
      template: 'ipd-discharge',
      status: 'completed',
      npsScore: { not: null },
      respondedAt: { gte: periodStart, lte: periodEnd },
    },
    select: { npsScore: true },
    take: 20000,
  });
  if (rows.length === 0) return null;
  const satisfied = rows.filter((r) => (r.npsScore ?? 0) >= 7).length;
  return { numerator: satisfied, denominator: rows.length };
};

// ─── PRE-003 — Complaint rate (per 1000 encounters) ─────────────────────
// numeratorDef: Number of complaints received
// denominatorDef: Total OPD/IPD footfall or encounters
// multiplier: 1000
//
// Scope limitation: we use IPD admissions as the encounter denominator.
// OPD/ER footfall integration is deferred — Appointment.date is a string
// column which makes range scoping fragile. Document in remarks at write time.

export const pre003_complaintRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const [complaints, admissions] = await Promise.all([
    prisma.complaint.count({ where: { raisedAt: { gte: periodStart, lte: periodEnd } } }),
    prisma.ipdAdmission.count({ where: { admissionDate: { gte: periodStart, lte: periodEnd } } }),
  ]);
  if (admissions === 0) return null;
  return { numerator: complaints, denominator: admissions };
};

// ─── PRE-004 — Complaint closure within TAT (%) ─────────────────────────
// numeratorDef: complaints closed within defined TAT (resolvedAt <= slaDueAt)
// denominatorDef: complaints closed/received in period

export const pre004_complaintClosureWithinTat: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.complaint.findMany({
    where: { raisedAt: { gte: periodStart, lte: periodEnd } },
    select: { resolvedAt: true, slaDueAt: true, status: true },
    take: 20000,
  });
  if (rows.length === 0) return null;
  let within = 0;
  for (const c of rows) {
    if (c.status !== 'resolved' || !c.resolvedAt || !c.slaDueAt) continue;
    if (c.resolvedAt <= c.slaDueAt) within += 1;
  }
  return { numerator: within, denominator: rows.length };
};

// ─── LAB-002 — Critical value reporting TAT compliance (%) ──────────────
// numeratorDef: critical values communicated within target time (30 min)
// denominatorDef: total critical values identified

export const lab002_criticalValueTat: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.investigationResult.findMany({
    where: {
      criticalFlag: true,
      isDeleted: false,
      reportedAt: { gte: periodStart, lte: periodEnd },
    },
    select: { reportedAt: true, acknowledgedAt: true },
    take: 20000,
  });
  if (rows.length === 0) return null;
  let within = 0;
  for (const r of rows) {
    if (!r.acknowledgedAt || !r.reportedAt) continue;
    const mins = (r.acknowledgedAt.getTime() - r.reportedAt.getTime()) / 60_000;
    if (mins <= 30) within += 1;
  }
  return { numerator: within, denominator: rows.length };
};

// ─── OT-001 — OT cancellation rate (%) ──────────────────────────────────
// Match the existing quality.controller `otEfficiency` casing convention.

export const ot001_cancellationRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const [total, cancelled] = await Promise.all([
    prisma.otSchedule.count({ where: { plannedStart: { gte: periodStart, lte: periodEnd } } }).catch(() => 0),
    prisma.otSchedule.count({
      where: { plannedStart: { gte: periodStart, lte: periodEnd }, status: { in: ['cancelled', 'CANCELLED'] } },
    }).catch(() => 0),
  ]);
  if (total === 0) return null;
  return { numerator: cancelled, denominator: total };
};

// ─── OT-009 — First case on-time compliance (%) ─────────────────────────
// "First case" = the earliest plannedStart per (otRoom, calendar day).
// On time when actualStart <= plannedStart + 15 min.

export const ot009_firstCaseOnTime: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.otSchedule.findMany({
    where: { plannedStart: { gte: periodStart, lte: periodEnd }, actualStart: { not: null } },
    select: { otRoomId: true, plannedStart: true, actualStart: true },
    take: 20000,
  }).catch(() => [] as Array<{ otRoomId: string; plannedStart: Date; actualStart: Date | null }>);

  // Group by (otRoomId, YYYY-MM-DD), keep the earliest plannedStart per group.
  type Row = { plannedStart: Date; actualStart: Date | null };
  const firstByRoomDay = new Map<string, Row>();
  for (const r of rows) {
    const day = r.plannedStart.toISOString().slice(0, 10);
    const key = `${r.otRoomId}|${day}`;
    const prev = firstByRoomDay.get(key);
    if (!prev || r.plannedStart < prev.plannedStart) firstByRoomDay.set(key, r);
  }
  if (firstByRoomDay.size === 0) return null;

  let onTime = 0;
  for (const r of firstByRoomDay.values()) {
    if (!r.actualStart) continue;
    const diff = (r.actualStart.getTime() - r.plannedStart.getTime()) / 60_000;
    if (diff <= 15) onTime += 1;
  }
  return { numerator: onTime, denominator: firstByRoomDay.size };
};

// ─── OT-008 — OT utilisation rate (%) ───────────────────────────────────
// numeratorDef:   Total utilized OT hours   (sum of actualEnd − actualStart)
// denominatorDef: Total available OT hours  (rooms × hrs/day × calendar days)
//
// "Available hours" needs an operating-hours assumption since OtRoom has no
// per-room schedule field. We use 10 hrs/day × OtRoom.count × calendar days
// in the period — a reasonable starting baseline. If a hospital wants
// exact accounting they can override via the manual-capture flow.

const OT_AVAILABLE_HOURS_PER_DAY = 10;

export const ot008_utilisation: AutoSourceFn = async (periodStart, periodEnd) => {
  const [rows, roomCount] = await Promise.all([
    prisma.otSchedule.findMany({
      where: {
        plannedStart: { gte: periodStart, lte: periodEnd },
        actualStart: { not: null },
        actualEnd: { not: null },
        NOT: { status: { in: ['cancelled', 'CANCELLED'] } },
      },
      select: { actualStart: true, actualEnd: true },
      take: 20000,
    }).catch(() => [] as Array<{ actualStart: Date | null; actualEnd: Date | null }>),
    prisma.otRoom.count().catch(() => 0),
  ]);
  if (roomCount === 0) return null;

  let utilisedMs = 0;
  for (const r of rows) {
    if (!r.actualStart || !r.actualEnd) continue;
    const delta = r.actualEnd.getTime() - r.actualStart.getTime();
    if (delta > 0) utilisedMs += delta;
  }
  const utilisedHours = utilisedMs / (60 * 60 * 1000);

  const days = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
  const availableHours = roomCount * OT_AVAILABLE_HOURS_PER_DAY * days;
  if (availableHours <= 0) return null;

  // No scheduled cases at all → no useful signal (skip rather than write 0%).
  if (rows.length === 0) return null;

  return { numerator: utilisedHours, denominator: availableHours };
};

// ─── OT-012 — Unplanned ICU transfer / readmission rate (%) ─────────────
// numeratorDef:   Number of unplanned ICU transfers / readmissions
// denominatorDef: Total ward discharges / transfers as applicable
//
// IpdIcuTransferRequest captures ward → ICU escalations only — planned ICU
// stays start with IpdAdmission.roomType='ICU' and never appear here. So
// every COMPLETED transfer request is, by construction, an unplanned ICU
// escalation. Explicit "readmission" tracking would need a separate flag
// on IpdAdmission; not surfaced in Phase 5d.
//
// Denominator is ward discharges in the period — non-expired IpdDischarge
// rows (deaths aren't readmission risks).

export const ot012_icuReadmission: AutoSourceFn = async (periodStart, periodEnd) => {
  const [transfers, wardDischarges] = await Promise.all([
    prisma.ipdIcuTransferRequest.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: periodStart, lte: periodEnd },
      },
    }).catch(() => 0),
    prisma.ipdDischarge.count({
      where: {
        dischargeDate: { gte: periodStart, lte: periodEnd },
        NOT: { dischargeType: 'expired' },
      },
    }),
  ]);
  if (wardDischarges === 0) return null;
  return { numerator: transfers, denominator: wardDischarges };
};

// ─── OT-011 — ICU mortality rate (%) ────────────────────────────────────
// numeratorDef: ICU deaths in period / total ICU admissions in period
// We approximate "ICU admission" as IpdAdmission.roomType='ICU'.

export const ot011_icuMortality: AutoSourceFn = async (periodStart, periodEnd) => {
  const [admits, deaths] = await Promise.all([
    prisma.ipdAdmission.count({
      where: { admissionDate: { gte: periodStart, lte: periodEnd }, roomType: 'ICU' },
    }),
    prisma.ipdDischarge.count({
      where: {
        dischargeDate: { gte: periodStart, lte: periodEnd },
        dischargeType: 'expired',
        admission: { roomType: 'ICU' },
      },
    }),
  ]);
  if (admits === 0) return null;
  return { numerator: deaths, denominator: admits };
};

// ─── Phase 5b — Infection surveillance + device-days ───────────────────
// ICO-001 HAI · ICO-002 SSI · ICO-003 VAP · ICO-004 CAUTI · ICO-005 CLABSI
// · ICO-008 sterilization failure · HR-006 needle stick injury.

async function sumDeviceDays(deviceType: 'ventilator' | 'urinary_catheter' | 'central_line', periodStart: Date, periodEnd: Date): Promise<number> {
  const rows = await prisma.qualityDeviceDayCount.findMany({
    where: { deviceType, date: { gte: periodStart, lte: periodEnd } },
    select: { count: true },
  });
  return rows.reduce((acc, r) => acc + r.count, 0);
}

export const ico001_haiRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const cases = await prisma.qualitySurveillanceEvent.count({
    where: { type: 'HAI', observedAt: { gte: periodStart, lte: periodEnd } },
  });
  const days = await patientDaysInPeriod(periodStart, periodEnd);
  if (days === 0) return null;
  return { numerator: cases, denominator: days };
};

export const ico002_ssiRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const [cases, surgeries] = await Promise.all([
    prisma.qualitySurveillanceEvent.count({
      where: { type: 'SSI', observedAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.otSchedule.count({
      where: {
        plannedStart: { gte: periodStart, lte: periodEnd },
        NOT: { status: { in: ['cancelled', 'CANCELLED'] } },
      },
    }).catch(() => 0),
  ]);
  if (surgeries === 0) return null;
  return { numerator: cases, denominator: surgeries };
};

export const ico003_vapRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const [cases, deviceDays] = await Promise.all([
    prisma.qualitySurveillanceEvent.count({
      where: { type: 'VAP', observedAt: { gte: periodStart, lte: periodEnd } },
    }),
    sumDeviceDays('ventilator', periodStart, periodEnd),
  ]);
  if (deviceDays === 0) return null;
  return { numerator: cases, denominator: deviceDays };
};

export const ico004_cautiRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const [cases, deviceDays] = await Promise.all([
    prisma.qualitySurveillanceEvent.count({
      where: { type: 'CAUTI', observedAt: { gte: periodStart, lte: periodEnd } },
    }),
    sumDeviceDays('urinary_catheter', periodStart, periodEnd),
  ]);
  if (deviceDays === 0) return null;
  return { numerator: cases, denominator: deviceDays };
};

export const ico005_clabsiRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const [cases, deviceDays] = await Promise.all([
    prisma.qualitySurveillanceEvent.count({
      where: { type: 'CLABSI', observedAt: { gte: periodStart, lte: periodEnd } },
    }),
    sumDeviceDays('central_line', periodStart, periodEnd),
  ]);
  if (deviceDays === 0) return null;
  return { numerator: cases, denominator: deviceDays };
};

export const ico008_sterilizationFailure: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.qualitySterilizationCycle.groupBy({
    by: ['passed'],
    where: { runAt: { gte: periodStart, lte: periodEnd } },
    _count: { _all: true },
  });
  let total = 0, failed = 0;
  for (const g of rows) {
    total += g._count._all;
    if (g.passed === false) failed += g._count._all;
  }
  if (total === 0) return null;
  return { numerator: failed, denominator: total };
};

// HR-006 NSI uses the Phase 5c manual-denominator pattern. Numerator is
// surveillance events of type='NSI'; denominator is QualityMonthlyDenominator
// (total clinical staff) entered monthly by HR.
export const hr006_needleStickRate: AutoSourceFn = async (periodStart, periodEnd) => {
  const period = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
  const [cases, den] = await Promise.all([
    prisma.qualitySurveillanceEvent.count({
      where: { type: 'NSI', observedAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.qualityMonthlyDenominator.findUnique({
      where: { qiCode_period: { qiCode: 'HR-006', period } },
      select: { value: true },
    }),
  ]);
  if (!den || den.value <= 0) return null;
  return { numerator: cases, denominator: den.value };
};

// ─── Phase 5i — Lab/Rad event log + Code Blue arrival ─────────────────

const CODE_BLUE_TARGET_MINUTES = 5;

function labRadDepartmentRate(eventType: string, department: 'lab' | 'radiology', multiplier: '100' | '1000'): AutoSourceFn {
  return async (periodStart, periodEnd) => {
    const [events, total] = await Promise.all([
      prisma.qualityLabRadEvent.count({
        where: { eventType, observedAt: { gte: periodStart, lte: periodEnd } },
      }),
      prisma.investigationResult.count({
        where: { department, isDeleted: false,
          reportedAt: { gte: periodStart, lte: periodEnd } },
      }),
    ]);
    if (total === 0) return null;
    // The auto-source layer doesn't need to apply the multiplier — the status
    // engine pulls it from the catalogue. Just return raw num/den.
    void multiplier;
    return { numerator: events, denominator: total };
  };
}

export const psq002_labReportingErrors = labRadDepartmentRate('lab_amended', 'lab', '1000');
export const psq003_radReportingErrors = labRadDepartmentRate('rad_amended', 'radiology', '1000');
export const lab001_sampleRejection = labRadDepartmentRate('lab_sample_rejected', 'lab', '100');
export const rad003_repeatImaging = labRadDepartmentRate('rad_repeat', 'radiology', '100');

// PSQ-014 — Code Blue response time compliance.
// Numerator: code='blue' calls where attendedAt - triggeredAt ≤ 5 min.
// Denominator: total code='blue' calls in period (attendedAt set).
export const psq014_codeBlueResponse: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.codeActivation.findMany({
    where: {
      code: 'blue',
      triggeredAt: { gte: periodStart, lte: periodEnd },
      attendedAt: { not: null },
    },
    select: { triggeredAt: true, attendedAt: true },
    take: 5000,
  });
  if (rows.length === 0) return null;
  let withinTarget = 0;
  for (const r of rows) {
    if (!r.attendedAt) continue;
    const mins = (r.attendedAt.getTime() - r.triggeredAt.getTime()) / 60_000;
    if (mins <= CODE_BLUE_TARGET_MINUTES) withinTarget += 1;
  }
  return { numerator: withinTarget, denominator: rows.length };
};

// ─── Phase 5h — Zero-schema-change derivations ─────────────────────────
//
// Indicators whose data already exists in InvestigationResult /
// InvestigationOrder / Incident / OtSchedule, so we can derive without
// adding columns. Targets in minutes for the TAT compliance pair.

const LAB_REPORT_TAT_MINUTES = 240;      // LAB-003: 4-hour standard
const RAD_REPORT_TAT_MINUTES = 240;      // RAD-001: 4-hour standard

async function reportTatCompliance(department: 'lab' | 'radiology', targetMinutes: number, periodStart: Date, periodEnd: Date): Promise<AutoSourceResult> {
  // We need order createdAt + result reportedAt. Pull final results in window
  // and look up their order's createdAt via the relation.
  const rows = await prisma.investigationResult.findMany({
    where: {
      department, isDeleted: false,
      reportedAt: { gte: periodStart, lte: periodEnd, not: null },
    },
    select: { reportedAt: true, order: { select: { createdAt: true } } },
    take: 20000,
  });
  if (rows.length === 0) return null;
  let onTime = 0;
  for (const r of rows) {
    if (!r.reportedAt || !r.order?.createdAt) continue;
    const mins = (r.reportedAt.getTime() - r.order.createdAt.getTime()) / 60_000;
    if (mins <= targetMinutes) onTime += 1;
  }
  return { numerator: onTime, denominator: rows.length };
}

export const lab003_reportTatCompliance: AutoSourceFn = async (s, e) =>
  reportTatCompliance('lab', LAB_REPORT_TAT_MINUTES, s, e);

export const rad001_reportTatCompliance: AutoSourceFn = async (s, e) =>
  reportTatCompliance('radiology', RAD_REPORT_TAT_MINUTES, s, e);

async function criticalValueDocumentation(department: 'lab' | 'radiology', periodStart: Date, periodEnd: Date): Promise<AutoSourceResult> {
  const total = await prisma.investigationResult.count({
    where: { department, isDeleted: false, criticalFlag: true,
      reportedAt: { gte: periodStart, lte: periodEnd } },
  });
  if (total === 0) return null;
  const documented = await prisma.investigationResult.count({
    where: { department, isDeleted: false, criticalFlag: true,
      reportedAt: { gte: periodStart, lte: periodEnd },
      acknowledgedAt: { not: null } },
  });
  return { numerator: documented, denominator: total };
}

export const lab004_panicValueDocumentation: AutoSourceFn = async (s, e) =>
  criticalValueDocumentation('lab', s, e);

export const rad002_criticalCommunication: AutoSourceFn = async (s, e) =>
  criticalValueDocumentation('radiology', s, e);

// PSQ-030 — Wrong site/procedure/person surgery. Reporter tags an incident
// with qiCode='PSQ-030'; denominator is total surgeries (OtSchedule count
// in period, excluding cancelled). No QualityMonthlyDenominator needed.
export const psq030_wrongSiteSurgery: AutoSourceFn = async (periodStart, periodEnd) => {
  const [cases, surgeries] = await Promise.all([
    prisma.incident.count({
      where: {
        qiCode: 'PSQ-030',
        reportedAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.otSchedule.count({
      where: {
        plannedStart: { gte: periodStart, lte: periodEnd },
        NOT: { status: { in: ['cancelled', 'CANCELLED'] } },
      },
    }).catch(() => 0),
  ]);
  if (surgeries === 0) return null;
  return { numerator: cases, denominator: surgeries };
};

// ─── Phase 5g — Pharmacy stock + expired drugs ────────────────────────

export const ops003_stockOut: AutoSourceFn = async (periodStart, periodEnd) => {
  const [events, criticalCount] = await Promise.all([
    prisma.pharmacyStockEvent.count({
      where: { eventType: 'stock_out', occurredAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.pharmacyCriticalDrug.count({ where: { isCritical: true } }),
  ]);
  if (criticalCount === 0) return null;
  return { numerator: events, denominator: criticalCount };
};

export const ops004_expiredDrugs: AutoSourceFn = async (periodStart, periodEnd) => {
  const period = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
  const [events, den] = await Promise.all([
    prisma.pharmacyStockEvent.count({
      where: { eventType: 'expired', occurredAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.qualityMonthlyDenominator.findUnique({
      where: { qiCode_period: { qiCode: 'OPS-004', period } },
      select: { value: true },
    }),
  ]);
  if (!den || den.value <= 0) return null;
  return { numerator: events, denominator: den.value };
};

// ─── Phase 5e — Generic TAT event source ───────────────────────────────
//
// All 15 TAT indicators share QualityTatEvent. Avg-minutes (PSQ-005..015,
// OPS-006) sum durationMinutes / count(events). Compliance-% (OPS-002/005/
// 007/008/010) count(withinTarget=true) / count(events). The controller
// already computed withinTarget at write time against the static target
// below, so auto-source here is just two counts.

// Hospital-tunable TAT targets in minutes. Defaults are opinionated NABH
// guidance + typical Indian-hospital expectations. Edit per policy; the
// withinTarget flag is computed at write time so historical records stay
// stable when these are tuned.
export const TAT_TARGET_MINUTES: Record<string, number> = {
  'PSQ-005': 30,   // ER initial assessment
  'PSQ-006': 30,   // OPD consultation wait
  'PSQ-007': 15,   // Registration wait
  'PSQ-008': 15,   // Billing wait
  'PSQ-009': 60,   // Admission TAT
  'PSQ-011': 120,  // Discharge TAT
  'PSQ-012': 5,    // Door-to-triage
  'PSQ-013': 30,   // Door-to-doctor
  'PSQ-015': 60,   // ICU admission TAT after decision
  'OPS-002': 240,  // Pre-auth TAT (4h)
  'OPS-005': 240,  // Indent fulfilment (4h)
  'OPS-006': 60,   // Bed turnaround
  'OPS-007': 30,   // Diet delivery
  'OPS-008': 30,   // Patient transport
  'OPS-010': 240,  // Critical IT incident closure SLA (4h)
};

function tatAvgMinutesSource(qiCode: string): AutoSourceFn {
  return async (periodStart, periodEnd) => {
    const events = await prisma.qualityTatEvent.findMany({
      where: { qiCode, startedAt: { gte: periodStart, lte: periodEnd } },
      select: { durationMinutes: true },
      take: 20000,
    });
    if (events.length === 0) return null;
    const sum = events.reduce((acc, e) => acc + e.durationMinutes, 0);
    return { numerator: sum, denominator: events.length };
  };
}

function tatComplianceSource(qiCode: string): AutoSourceFn {
  return async (periodStart, periodEnd) => {
    const groups = await prisma.qualityTatEvent.groupBy({
      by: ['withinTarget'],
      where: { qiCode, startedAt: { gte: periodStart, lte: periodEnd } },
      _count: { _all: true },
    });
    let total = 0, within = 0;
    for (const g of groups) {
      total += g._count._all;
      if (g.withinTarget === true) within += g._count._all;
    }
    if (total === 0) return null;
    return { numerator: within, denominator: total };
  };
}

// ─── Phase 5f — Facility / equipment / ambulance / maintenance ────────

function pmOrCalibrationOnTime(eventType: 'pm' | 'calibration'): AutoSourceFn {
  return async (periodStart, periodEnd) => {
    // Fetch all events of this type with dueAt in the period, then bucket
    // them in JS — Prisma can't compare two columns server-side, but the
    // result set is small (PM/calibration cycles are monthly, not millions).
    const rows = await prisma.facilityEquipmentEvent.findMany({
      where: { eventType, dueAt: { gte: periodStart, lte: periodEnd } },
      select: { dueAt: true, occurredAt: true },
      take: 5000,
    });
    if (rows.length === 0) return null;
    let onTime = 0;
    for (const r of rows) {
      if (!r.dueAt) continue;
      if (r.occurredAt && r.occurredAt <= r.dueAt) onTime += 1;
    }
    return { numerator: onTime, denominator: rows.length };
  };
}

export const fms001_pmCompliance = pmOrCalibrationOnTime('pm');
export const fms002_calibrationCompliance = pmOrCalibrationOnTime('calibration');

export const fms003_criticalBreakdown: AutoSourceFn = async (periodStart, periodEnd) => {
  const criticalCount = await prisma.facilityEquipment.count({ where: { isCritical: true } });
  if (criticalCount === 0) return null;
  // Distinct critical equipment items that had at least one breakdown in period.
  const grouped = await prisma.facilityEquipmentEvent.groupBy({
    by: ['equipmentId'],
    where: {
      eventType: 'breakdown',
      occurredAt: { gte: periodStart, lte: periodEnd },
      equipment: { is: { isCritical: true } },
    },
    _count: { _all: true },
  });
  return { numerator: grouped.length, denominator: criticalCount };
};

export const fms004_utilityFailures: AutoSourceFn = async (periodStart, periodEnd) => {
  const count = await prisma.facilityUtilityFailure.count({
    where: { occurredAt: { gte: periodStart, lte: periodEnd } },
  });
  // Catalogue says multiplier NA, benchmark 0 (zero-tolerance) — same record-anyway
  // shape as PSQ-029 sentinel count.
  return { numerator: count, denominator: 1 };
};

export const fms007_securityIncident: AutoSourceFn = async (periodStart, periodEnd) => {
  const period = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
  const [cases, den] = await Promise.all([
    prisma.incident.count({
      where: { category: 'security', reportedAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.qualityMonthlyDenominator.findUnique({
      where: { qiCode_period: { qiCode: 'FMS-007', period } },
      select: { value: true },
    }),
  ]);
  if (!den || den.value <= 0) return null;
  return { numerator: cases, denominator: den.value };
};

export const fms008_ambulanceResponse: AutoSourceFn = async (periodStart, periodEnd) => {
  const [total, withinTarget] = await Promise.all([
    prisma.facilityAmbulanceCall.count({
      where: { calledAt: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.facilityAmbulanceCall.count({
      where: { calledAt: { gte: periodStart, lte: periodEnd }, withinTarget: true },
    }),
  ]);
  if (total === 0) return null;
  return { numerator: withinTarget, denominator: total };
};

export const fms009_maintenanceClosure: AutoSourceFn = async (periodStart, periodEnd) => {
  const rows = await prisma.facilityMaintenanceComplaint.findMany({
    where: { raisedAt: { gte: periodStart, lte: periodEnd } },
    select: { status: true, closedAt: true, slaDueAt: true },
    take: 5000,
  });
  if (rows.length === 0) return null;
  let withinTat = 0;
  for (const c of rows) {
    if (c.status !== 'closed' || !c.closedAt || !c.slaDueAt) continue;
    if (c.closedAt <= c.slaDueAt) withinTat += 1;
  }
  return { numerator: withinTat, denominator: rows.length };
};

// ─── Phase 5c — Incident-bridge with manual denominator ────────────────
// Counts Incident rows over the period matching `incidentWhere`, divides by
// the QualityMonthlyDenominator value for (qiCode, period). When the
// denominator row is missing → null (skip). When denominator=0 → null.
// When the incident count is 0 with a real denominator we still write the
// record (a legitimate green "no events this month").

type IncidentWhere = Record<string, unknown>;

function incidentRateWithManualDenominator(qiCode: string, incidentWhere: IncidentWhere): AutoSourceFn {
  return async (periodStart, periodEnd) => {
    // Derive YYYY-MM from periodStart — auto-source cron always passes a month window.
    const period = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;

    const den = await prisma.qualityMonthlyDenominator.findUnique({
      where: { qiCode_period: { qiCode, period } },
      select: { value: true },
    });
    if (!den || den.value <= 0) return null;

    const where = {
      ...incidentWhere,
      reportedAt: { gte: periodStart, lte: periodEnd },
    } as IncidentWhere;
    const numerator = await prisma.incident.count({ where });

    return { numerator, denominator: den.value };
  };
}

// ─── Phase 5a — Generic audit-observation factory ───────────────────────
// Counts compliant / total observations for one qiCode across a period.
// Used by all observation-driven indicators backed by QualityAuditObservation.
//
// The auditor always answers semantically "was this OK?" (compliant=true).
// What goes into the numerator depends on the indicator's direction:
//   • lower-is-bad  (e.g. "Hand hygiene compliance" ≥ 85%)  → numerator = compliant
//   • higher-is-bad (e.g. "Consent form deficiency rate")   → numerator = non-compliant
// Denominator is always the total observations.

function countCompliantForAudit(qiCode: string): AutoSourceFn {
  return async (periodStart, periodEnd) => {
    const groups = await prisma.qualityAuditObservation.groupBy({
      by: ['compliant'],
      where: { qiCode, observedAt: { gte: periodStart, lte: periodEnd } },
      _count: { _all: true },
    });
    let total = 0, compliant = 0;
    for (const g of groups) {
      total += g._count._all;
      if (g.compliant) compliant += g._count._all;
    }
    if (total === 0) return null;

    const def = getQiDef(qiCode);
    const direction = def?.direction ?? 'lower-is-bad';
    const numerator = direction === 'higher-is-bad' ? total - compliant : compliant;
    return { numerator, denominator: total };
  };
}

// ─── Registry ────────────────────────────────────────────────────────────
// qiCode → source function. The cron iterates this map; any indicator not
// listed here remains manual-capture only.

// Phase 5a — every "compliance %" indicator backed by QualityAuditObservation.
// Each entry counts compliant/total for its qiCode across the period.
const AUDIT_BACKED_INDICATORS: string[] = [
  // Patient Safety & Quality
  'PSQ-004', // Diagnostic safety adherence
  // Infection Control
  'ICO-006', // Hand hygiene compliance
  'ICO-007', // BMW segregation compliance
  'ICO-009', // CSSD TAT compliance
  'ICO-010', // Housekeeping audit compliance
  'ICO-011', // Linen infection-control compliance
  'ICO-012', // Food safety audit compliance
  // OT
  'OT-003',  // Surgical safety checklist compliance
  'OT-004',  // PAC completion
  'OT-010',  // Specimen labelling error rate (compliant = correctly labelled)
  // Laboratory
  'LAB-005', // IQC failure rate (compliant = pass)
  'LAB-006', // EQAS participation compliance
  // Radiology
  'RAD-004', // Radiation safety audit compliance
  // Patient Rights & Education
  'PRE-005', // Informed consent compliance
  'PRE-006', // Patient ID band compliance
  'PRE-007', // Patient education documentation
  'PRE-008', // Discharge counselling documentation
  'PRE-009', // Consent form deficiency (compliant = no deficiency)
  // Medical Records
  'MRD-001', // Incomplete record rate (compliant = complete)
  'MRD-002', // Record availability TAT
  'MRD-003', // Coding error rate (compliant = no error)
  'MRD-004', // Death summary TAT
  'MRD-005', // Death audit completion
  'MRD-006', // Documentation error (compliant = no error)
  'MRD-007', // Abbreviation misuse (compliant = approved abbreviations only)
  'MRD-008', // High-risk consent compliance
  // Human Resources
  'HR-001',  // Mandatory training compliance
  'HR-002',  // BLS training compliance
  'HR-003',  // Fire safety training
  'HR-004',  // Credentialing & privileging compliance
  'HR-005',  // Staff health check compliance
  // Facility Management
  'FMS-005', // Fire drill compliance
  'FMS-006', // Mock drill compliance
  'FMS-010', // Lift / electrical safety checklist compliance
];

export const AUTO_SOURCE_REGISTRY: Record<string, AutoSourceFn> = {
  // Phase 2 — derivable from existing operational data
  'PSQ-001': psq001_initialAssessmentTat,
  'PSQ-010': psq010_dischargeSummaryWithinTat,
  'PSQ-024': psq024_fallRate,
  'PSQ-025': psq025_fallWithInjuryRate,
  'PSQ-028': psq028_adverseClinicalEvents,
  'PSQ-029': psq029_sentinelCount,
  'PRE-001': pre001_opdSatisfaction,
  'PRE-002': pre002_ipdSatisfaction,
  'PRE-003': pre003_complaintRate,
  'PRE-004': pre004_complaintClosureWithinTat,
  'LAB-002': lab002_criticalValueTat,
  'OT-001':  ot001_cancellationRate,
  'OT-008':  ot008_utilisation,
  'OT-009':  ot009_firstCaseOnTime,
  'OT-011':  ot011_icuMortality,
  'OT-012':  ot012_icuReadmission,
  // Phase 5a — audit-observation backed (built from AUDIT_BACKED_INDICATORS).
  ...Object.fromEntries(AUDIT_BACKED_INDICATORS.map((code) => [code, countCompliantForAudit(code)])),
  // Phase 5c — Incident-bridge indicators with manual monthly denominators.
  // PSQ-016 sums every medication-category incident (no tagging needed).
  // The rest filter on the explicit qiCode tag.
  'PSQ-016': incidentRateWithManualDenominator('PSQ-016', { category: 'medication' }),
  'PSQ-017': incidentRateWithManualDenominator('PSQ-017', { qiCode: 'PSQ-017' }),
  'PSQ-018': incidentRateWithManualDenominator('PSQ-018', { qiCode: 'PSQ-018' }),
  'PSQ-019': incidentRateWithManualDenominator('PSQ-019', { qiCode: 'PSQ-019' }),
  'PSQ-020': incidentRateWithManualDenominator('PSQ-020', { qiCode: 'PSQ-020' }),
  'PSQ-021': incidentRateWithManualDenominator('PSQ-021', { qiCode: 'PSQ-021' }),
  'PSQ-022': incidentRateWithManualDenominator('PSQ-022', { qiCode: 'PSQ-022' }),
  'PSQ-023': incidentRateWithManualDenominator('PSQ-023', { qiCode: 'PSQ-023' }),
  'PSQ-026': incidentRateWithManualDenominator('PSQ-026', { qiCode: 'PSQ-026' }),
  'PSQ-027': incidentRateWithManualDenominator('PSQ-027', { qiCode: 'PSQ-027' }),
  'PRE-010': incidentRateWithManualDenominator('PRE-010', { qiCode: 'PRE-010' }),
  'OT-002':  incidentRateWithManualDenominator('OT-002',  { qiCode: 'OT-002'  }),
  'OT-005':  incidentRateWithManualDenominator('OT-005',  { qiCode: 'OT-005'  }),
  'OT-006':  incidentRateWithManualDenominator('OT-006',  { qiCode: 'OT-006'  }),
  'OT-007':  incidentRateWithManualDenominator('OT-007',  { qiCode: 'OT-007'  }),
  // Phase 5b — infection surveillance + sterilization + needle-stick.
  'ICO-001': ico001_haiRate,
  'ICO-002': ico002_ssiRate,
  'ICO-003': ico003_vapRate,
  'ICO-004': ico004_cautiRate,
  'ICO-005': ico005_clabsiRate,
  'ICO-008': ico008_sterilizationFailure,
  'HR-006':  hr006_needleStickRate,
  // Phase 5e — TAT events. Avg-minutes indicators sum/avg the duration;
  // compliance indicators count withinTarget=true.
  'PSQ-005': tatAvgMinutesSource('PSQ-005'),
  'PSQ-006': tatAvgMinutesSource('PSQ-006'),
  'PSQ-007': tatAvgMinutesSource('PSQ-007'),
  'PSQ-008': tatAvgMinutesSource('PSQ-008'),
  'PSQ-009': tatAvgMinutesSource('PSQ-009'),
  'PSQ-011': tatAvgMinutesSource('PSQ-011'),
  'PSQ-012': tatAvgMinutesSource('PSQ-012'),
  'PSQ-013': tatAvgMinutesSource('PSQ-013'),
  'PSQ-015': tatAvgMinutesSource('PSQ-015'),
  'OPS-006': tatAvgMinutesSource('OPS-006'),
  'OPS-002': tatComplianceSource('OPS-002'),
  'OPS-005': tatComplianceSource('OPS-005'),
  'OPS-007': tatComplianceSource('OPS-007'),
  'OPS-008': tatComplianceSource('OPS-008'),
  'OPS-010': tatComplianceSource('OPS-010'),
  // Phase 5e — OPS-001 and OPS-009 reuse the Phase 5c incident-bridge
  // pattern. Reporter tags an incident with the qiCode; manager records
  // the monthly denominator (total bills generated / total scheduled
  // operating minutes).
  'OPS-001': incidentRateWithManualDenominator('OPS-001', { qiCode: 'OPS-001' }),
  'OPS-009': incidentRateWithManualDenominator('OPS-009', { qiCode: 'OPS-009' }),
  // Phase 5g — pharmacy stock-out + expired drugs.
  'OPS-003': ops003_stockOut,
  'OPS-004': ops004_expiredDrugs,
  // Phase 5h — zero-schema derivations from InvestigationResult / Incident.
  'LAB-003': lab003_reportTatCompliance,
  'LAB-004': lab004_panicValueDocumentation,
  'RAD-001': rad001_reportTatCompliance,
  'RAD-002': rad002_criticalCommunication,
  'PSQ-030': psq030_wrongSiteSurgery,
  // Phase 5i — lab/rad event log + Code Blue arrival timestamp.
  'PSQ-002': psq002_labReportingErrors,
  'PSQ-003': psq003_radReportingErrors,
  'PSQ-014': psq014_codeBlueResponse,
  'LAB-001': lab001_sampleRejection,
  'RAD-003': rad003_repeatImaging,
  // Phase 5f — facility / equipment / ambulance / maintenance.
  'FMS-001': fms001_pmCompliance,
  'FMS-002': fms002_calibrationCompliance,
  'FMS-003': fms003_criticalBreakdown,
  'FMS-004': fms004_utilityFailures,
  'FMS-007': fms007_securityIncident,
  'FMS-008': fms008_ambulanceResponse,
  'FMS-009': fms009_maintenanceClosure,
};

export const AUTO_SOURCE_CODES: string[] = Object.keys(AUTO_SOURCE_REGISTRY);
