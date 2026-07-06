import prisma from '../../service/prisma-client';
import { raiseAutoIncident } from './incident.controller';

// Phase 9.24 / Phase 2 — Incident auto-capture rule catalogue.
//
// One static catalogue (this file) holds the rule metadata + cron runners.
// The IncidentRule DB table mirrors the metadata so admins can disable a rule
// at runtime without code changes. Each rule has a stable string `key`.
//
// Trigger modes:
//   - 'on-write'  → existing controllers call raiseByRule() at save time.
//   - 'cron'      → incident-rules.cron.ts runs every 15 minutes.
//
// Idempotency is owned by raiseAutoIncident() (24h dedupe per ruleKey + entity).

export type Severity = 'near_miss' | 'minor' | 'moderate' | 'major' | 'sentinel';
export type Category =
  | 'clinical' | 'medication' | 'documentation' | 'fall' | 'infection'
  | 'equipment' | 'behavioural' | 'security' | 'other';

export interface IncidentContext {
  patientPrn?: string | null;
  patientName?: string | null;
  admissionId?: string | null;
  emergencyId?: number | null;
  appointmentId?: number | null;
  ward?: string | null;
  department?: string | null;
  occurredAt?: Date | null;
  // extra free-form data baked into title/description
  extras?: Record<string, string | number | null | undefined>;
}

export interface RuleDef {
  key: string;
  name: string;
  description: string;
  category: Category;
  defaultSeverity: Severity;
  nabhClause: string;
  thresholdMinutes?: number;
  mode: 'on-write' | 'cron';
  buildTitle: (ctx: IncidentContext) => string;
  buildDescription: (ctx: IncidentContext) => string;
}

const fmtExtras = (ctx: IncidentContext): string => {
  if (!ctx.extras) return '';
  return Object.entries(ctx.extras)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join(', ');
};

// ─── Rule definitions ──────────────────────────────────────────────────

export const RULE_CATALOGUE: Record<string, RuleDef> = {
  OPD_ASSESSMENT_MISSING_REQUIRED_FIELD: {
    key: 'OPD_ASSESSMENT_MISSING_REQUIRED_FIELD',
    name: 'OPD assessment missing required field',
    description: 'OPD assessment saved without history, examination or treatment plan.',
    category: 'documentation',
    defaultSeverity: 'minor',
    nabhClause: 'AAC.1',
    mode: 'on-write',
    buildTitle: (ctx) => `OPD assessment incomplete${ctx.patientName ? ' — ' + ctx.patientName : ''}`,
    buildDescription: (ctx) => `Required clinical fields missing on OPD assessment save. ${fmtExtras(ctx)}`,
  },
  DISCHARGE_SUMMARY_MISSING_ON_DISCHARGE: {
    key: 'DISCHARGE_SUMMARY_MISSING_ON_DISCHARGE',
    name: 'Discharge created without summary',
    description: 'IPD discharge row saved with empty discharge summary.',
    category: 'documentation',
    defaultSeverity: 'major',
    nabhClause: 'AAC.8',
    mode: 'on-write',
    buildTitle: (ctx) => `Discharge summary missing${ctx.patientName ? ' — ' + ctx.patientName : ''}`,
    buildDescription: (ctx) => `Discharge created without a written discharge summary. NABH AAC.8 / MRD.3 evidence gap. ${fmtExtras(ctx)}`,
  },
  LAMA_DAMA_WITHOUT_SIGNATURE: {
    key: 'LAMA_DAMA_WITHOUT_SIGNATURE',
    name: 'LAMA/DAMA without patient signature',
    description: 'LAMA or DAMA record raised without a patient signature.',
    category: 'documentation',
    defaultSeverity: 'major',
    nabhClause: 'ACC.6',
    mode: 'on-write',
    buildTitle: (ctx) => `LAMA/DAMA missing signature${ctx.patientName ? ' — ' + ctx.patientName : ''}`,
    buildDescription: (ctx) => `LAMA / DAMA recorded but no patient signature captured. Regulatory documentation gap. ${fmtExtras(ctx)}`,
  },
  // ── Phase 9.26 / Phase 3 — Quality indicator critical breach ──────
  QI_CRITICAL_BREACH: {
    key: 'QI_CRITICAL_BREACH',
    name: 'Quality indicator critical breach',
    description: 'A NABH/QCI quality indicator was captured at the critical (zero-tolerance) tier.',
    category: 'clinical',
    defaultSeverity: 'sentinel',
    nabhClause: 'PSQ.4',
    mode: 'on-write',
    buildTitle: (ctx) => `Critical QI breach — ${ctx.extras?.['qiCode'] ?? '?'} (${ctx.extras?.['period'] ?? '?'})`,
    buildDescription: (ctx) => `Indicator ${ctx.extras?.['qiCode']} (${ctx.extras?.['indicator']}) for ${ctx.extras?.['chapter']} captured value ${ctx.extras?.['value']} ${ctx.extras?.['unit']} in period ${ctx.extras?.['period']} — zero-tolerance tier. Trigger: ${ctx.extras?.['criticalTrigger'] ?? 'critical-flag set at capture'}. NABH clause: ${ctx.extras?.['nabhClause'] ?? 'n/a'}.`,
  },

  // ── Phase 9.26 / Phase 4 — Single-case outlier (initial assessment) ──
  QI_OUTLIER_INITIAL_ASSESSMENT: {
    key: 'QI_OUTLIER_INITIAL_ASSESSMENT',
    name: 'Initial assessment outlier (> 120 min for one admission)',
    description: 'A single admission breached the 120-min initial-assessment outlier band — performance drift even if monthly average is green.',
    category: 'clinical',
    defaultSeverity: 'minor',
    nabhClause: 'AAC.4',
    thresholdMinutes: 120,
    mode: 'cron',
    buildTitle: (ctx) => `Initial assessment outlier — admission ${ctx.extras?.['admissionNo'] ?? ''} (${ctx.extras?.['minutesSince'] ?? '?'} min)`,
    buildDescription: (ctx) => `Admission ${ctx.extras?.['admissionNo']} had a consultant-signed initial assessment ${ctx.extras?.['minutesSince']} min after ward arrival — beyond the 120-min outlier band. PSQ-001 monthly average may still be green; this is a per-case drift signal. ${fmtExtras(ctx)}`,
  },

  LOW_NPS_PATIENT_FEEDBACK: {
    key: 'LOW_NPS_PATIENT_FEEDBACK',
    name: 'Very low patient NPS feedback (≤ 3)',
    description: 'Patient submitted a feedback survey with NPS ≤ 3 — likely sentinel experience event.',
    category: 'behavioural',
    defaultSeverity: 'moderate',
    nabhClause: 'CQI.6',
    mode: 'on-write',
    buildTitle: (ctx) => `Critical patient feedback (NPS ${ctx.extras?.['npsScore'] ?? '?'})${ctx.patientName ? ' — ' + ctx.patientName : ''}`,
    buildDescription: (ctx) => `Patient gave NPS ${ctx.extras?.['npsScore']} on the post-visit survey. Auto-raised for Patient Experience review. ${fmtExtras(ctx)}`,
  },

  // ── Cron rules ─────────────────────────────────────────────────────
  IPD_INITIAL_ASSESSMENT_LATE: {
    key: 'IPD_INITIAL_ASSESSMENT_LATE',
    name: 'IPD initial assessment > 24h late',
    description: 'Admission older than 24h with no consultant-signed initial assessment.',
    category: 'clinical',
    defaultSeverity: 'moderate',
    nabhClause: 'AAC.4',
    thresholdMinutes: 24 * 60,
    mode: 'cron',
    buildTitle: (ctx) => `Initial assessment > 24h late — admission ${ctx.extras?.['admissionNo'] ?? ''}`,
    buildDescription: (ctx) => `Patient admitted ${ctx.extras?.['hoursSinceAdmission'] ?? '?'}h ago without a consultant-signed initial assessment. ${fmtExtras(ctx)}`,
  },
  IPD_CONSULTANT_SIGN_LATE: {
    key: 'IPD_CONSULTANT_SIGN_LATE',
    name: 'Initial assessment awaiting consultant sign > 24h',
    description: 'Initial assessment FILLED > 24h without consultant signature.',
    category: 'clinical',
    defaultSeverity: 'moderate',
    nabhClause: 'AAC.4',
    thresholdMinutes: 24 * 60,
    mode: 'cron',
    buildTitle: (ctx) => `Consultant co-sign overdue — admission ${ctx.extras?.['admissionNo'] ?? ''}`,
    buildDescription: (ctx) => `Initial assessment was FILLED by the resident but the consultant has not co-signed for over 24h. ${fmtExtras(ctx)}`,
  },
  DISCHARGE_SUMMARY_NOT_SIGNED: {
    key: 'DISCHARGE_SUMMARY_NOT_SIGNED',
    name: 'Discharge summary unsigned > 24h after discharge',
    description: 'Patient discharged but summary status is not SIGNED 24h later.',
    category: 'documentation',
    defaultSeverity: 'moderate',
    nabhClause: 'MRD.3',
    thresholdMinutes: 24 * 60,
    mode: 'cron',
    buildTitle: (ctx) => `Discharge summary unsigned — admission ${ctx.extras?.['admissionNo'] ?? ''}`,
    buildDescription: (ctx) => `Patient discharged ${ctx.extras?.['hoursSinceDischarge'] ?? '?'}h ago; discharge summary still not signed. ${fmtExtras(ctx)}`,
  },
  CRITICAL_LAB_NOT_ACKNOWLEDGED: {
    key: 'CRITICAL_LAB_NOT_ACKNOWLEDGED',
    name: 'Critical lab result unacknowledged > 30 min',
    description: 'InvestigationResult flagged critical with no clinician acknowledgement after 30 min.',
    category: 'clinical',
    defaultSeverity: 'major',
    nabhClause: 'COP.10',
    thresholdMinutes: 30,
    mode: 'cron',
    buildTitle: (ctx) => `Critical lab unacknowledged${ctx.extras?.['encounterType'] && ctx.extras['encounterType'] !== 'UNKNOWN' ? ' [' + ctx.extras['encounterType'] + ']' : ''} — ${ctx.extras?.['testName'] ?? 'result'}`,
    buildDescription: (ctx) => `Critical-value lab result reported ${ctx.extras?.['minutesSince'] ?? '?'} min ago has not been acknowledged. Source: ${ctx.extras?.['encounterType'] ?? 'unknown encounter'}. ${fmtExtras(ctx)}`,
  },
  BED_REQUEST_UNFULFILLED: {
    key: 'BED_REQUEST_UNFULFILLED',
    name: 'Bed request pending > 4h',
    description: 'IPD bed request status REQUESTED for more than 4 hours.',
    category: 'documentation',
    defaultSeverity: 'moderate',
    nabhClause: 'AAC.5',
    thresholdMinutes: 4 * 60,
    mode: 'cron',
    buildTitle: (ctx) => `Bed request pending > 4h — admission ${ctx.extras?.['admissionId'] ?? ''}`,
    buildDescription: (ctx) => `IPD bed request was raised ${ctx.extras?.['hoursSinceRequest'] ?? '?'}h ago and the nursing station has not yet accepted. ${fmtExtras(ctx)}`,
  },
  EMERGENCY_REFERRAL_UNACK_FINAL: {
    key: 'EMERGENCY_REFERRAL_UNACK_FINAL',
    name: 'Emergency referral past full escalation chain',
    description: 'ER referral still pending after escalating > 2 levels.',
    category: 'clinical',
    defaultSeverity: 'major',
    nabhClause: 'PSQ.5',
    mode: 'cron',
    buildTitle: (ctx) => `ER referral unacknowledged — escalation L${ctx.extras?.['escalationLevel'] ?? '?'}`,
    buildDescription: (ctx) => `Emergency referral remains pending after climbing the escalation chain. Patient may be receiving delayed specialist input. ${fmtExtras(ctx)}`,
  },
};

// ─── Public API ──────────────────────────────────────────────────────

/** Raise an incident from a rule key + context. Idempotent (24h dedupe). */
export async function raiseByRule(key: string, ctx: IncidentContext): Promise<{ created: boolean; incidentId?: string } | null> {
  try {
    const def = RULE_CATALOGUE[key];
    if (!def) return null;
    // Honour runtime toggle when an IncidentRule row exists.
    const row = await prisma.incidentRule.findUnique({ where: { key } }).catch(() => null);
    if (row && row.isActive === false) return { created: false };
    const result = await raiseAutoIncident({
      ruleKey: key,
      category: def.category,
      severity: def.defaultSeverity,
      nabhClause: def.nabhClause,
      title: def.buildTitle(ctx),
      description: def.buildDescription(ctx),
      patientPrn: ctx.patientPrn ?? null,
      patientName: ctx.patientName ?? null,
      admissionId: ctx.admissionId ?? null,
      emergencyId: ctx.emergencyId ?? null,
      appointmentId: ctx.appointmentId ?? null,
      ward: ctx.ward ?? null,
      department: ctx.department ?? null,
      occurredAt: ctx.occurredAt ?? null,
    });
    return result;
  } catch (err) {
    console.warn(`[incident-rule:${key}] raise failed:`, (err as Error).message);
    return null;
  }
}

// ─── Cron runners ────────────────────────────────────────────────────
// Each runner returns { checked, raised } for log telemetry.

type RunnerOut = { checked: number; raised: number };

/** Admission > 24h, no consultant-signed initial assessment (or no row). */
async function runInitialAssessmentLate(): Promise<RunnerOut> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const admissions = await prisma.ipdAdmission.findMany({
    where: { admissionDate: { lt: cutoff }, status: 'admitted' },
    select: {
      id: true, admissionNo: true, prn: true, department: true, ward: { select: { wardName: true } },
      admissionDate: true,
      initialAssessment: { select: { status: true } },
    },
    take: 1000,
  });
  let raised = 0;
  for (const a of admissions) {
    const status = a.initialAssessment?.status;
    if (status === 'CONSULTANT_SIGNED') continue;
    const hrs = Math.floor((Date.now() - new Date(a.admissionDate).getTime()) / 3_600_000);
    const r = await raiseByRule('IPD_INITIAL_ASSESSMENT_LATE', {
      admissionId: a.id, patientPrn: a.prn, department: a.department, ward: a.ward?.wardName ?? null,
      extras: { admissionNo: a.admissionNo, hoursSinceAdmission: hrs },
    });
    if (r?.created) raised += 1;

    if (status === 'FILLED') {
      const r2 = await raiseByRule('IPD_CONSULTANT_SIGN_LATE', {
        admissionId: a.id, patientPrn: a.prn, department: a.department, ward: a.ward?.wardName ?? null,
        extras: { admissionNo: a.admissionNo, hoursSinceAdmission: hrs },
      });
      if (r2?.created) raised += 1;
    }
  }
  return { checked: admissions.length, raised };
}

/** Discharged > 24h, summary still not SIGNED/DELIVERED. */
async function runDischargeSummaryUnsigned(): Promise<RunnerOut> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.ipdDischarge.findMany({
    where: { dischargeDate: { lt: cutoff }, NOT: { summaryStatus: { in: ['SIGNED', 'DELIVERED'] } } },
    select: { id: true, admissionId: true, dischargeDate: true, admission: { select: { admissionNo: true, prn: true, department: true } } },
    take: 1000,
  });
  let raised = 0;
  for (const d of rows) {
    const hrs = Math.floor((Date.now() - new Date(d.dischargeDate).getTime()) / 3_600_000);
    const r = await raiseByRule('DISCHARGE_SUMMARY_NOT_SIGNED', {
      admissionId: d.admissionId, patientPrn: d.admission?.prn, department: d.admission?.department,
      extras: { admissionNo: d.admission?.admissionNo, hoursSinceDischarge: hrs },
    });
    if (r?.created) raised += 1;
  }
  return { checked: rows.length, raised };
}

/** Critical lab result > 30 min old, no acknowledgement.
 *
 * Phase 6 / Concern #2 — encounter attribution: for each unack'd critical
 * result, look up the patient's active IPD admission (or most recent OPD
 * appointment) at the time the result was reported, so the incident detail
 * shows OPD vs IPD origin instead of just a PRN. Uses existing Incident
 * columns; no schema change.
 */
async function runCriticalLabUnacked(): Promise<RunnerOut> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await prisma.investigationResult.findMany({
    where: {
      criticalFlag: true, isDeleted: false, acknowledgedAt: null,
      reportedAt: { lt: cutoff },
    },
    select: { id: true, prn: true, testName: true, reportedAt: true, department: true },
    take: 500,
  });
  let raised = 0;
  for (const r of rows) {
    const mins = r.reportedAt ? Math.floor((Date.now() - new Date(r.reportedAt).getTime()) / 60_000) : null;
    const reportedAt = r.reportedAt ?? new Date();

    // Try to resolve encounter — IPD first (active admission on/before reportedAt), then OPD.
    let admissionId: string | null = null;
    let appointmentId: number | null = null;
    let encounterType: 'IPD' | 'OPD' | 'UNKNOWN' = 'UNKNOWN';
    let ward: string | null = null;
    let department: string | null = r.department;

    try {
      const ipd = await prisma.ipdAdmission.findFirst({
        where: {
          prn: r.prn,
          admissionDate: { lte: reportedAt },
          status: { in: ['admitted', 'BED_ACCEPTED'] },
        },
        select: { id: true, ward: { select: { wardName: true } }, department: true },
        orderBy: { admissionDate: 'desc' },
      });
      if (ipd) {
        admissionId = ipd.id;
        ward = ipd.ward?.wardName ?? null;
        department = ipd.department ?? department;
        encounterType = 'IPD';
      } else {
        // OPD fallback — most recent appointment for this PRN at or before reportedAt
        // (Appointment.date is a string YYYY-MM-DD; compare lexically.)
        const dayStr = reportedAt.toISOString().slice(0, 10);
        const opd = await prisma.appointment.findFirst({
          where: { prnNumber: r.prn ? Number(r.prn) : undefined, date: { lte: dayStr } },
          select: { id: true, department: true },
          orderBy: [{ date: 'desc' }, { time: 'desc' }],
        }).catch(() => null);
        if (opd) {
          appointmentId = opd.id;
          department = opd.department ?? department;
          encounterType = 'OPD';
        }
      }
    } catch (err) {
      console.warn('[critical-lab:encounter-lookup] failed for prn', r.prn, '—', (err as Error).message);
    }

    const out = await raiseByRule('CRITICAL_LAB_NOT_ACKNOWLEDGED', {
      patientPrn: r.prn,
      department,
      ward,
      admissionId,
      appointmentId,
      occurredAt: reportedAt,
      extras: {
        testName: r.testName,
        minutesSince: mins,
        encounterType,
      },
    });
    if (out?.created) raised += 1;
  }
  return { checked: rows.length, raised };
}

/** IpdBedRequest still REQUESTED > 4h. */
async function runBedRequestUnfulfilled(): Promise<RunnerOut> {
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const rows = await prisma.ipdBedRequest.findMany({
    where: { status: 'REQUESTED', requestedAt: { lt: cutoff } },
    select: {
      id: true, admissionId: true, requestedAt: true,
      admission: { select: { prn: true, department: true } },
    },
    take: 500,
  });
  let raised = 0;
  for (const r of rows) {
    const hrs = Math.floor((Date.now() - new Date(r.requestedAt).getTime()) / 3_600_000);
    const out = await raiseByRule('BED_REQUEST_UNFULFILLED', {
      admissionId: r.admissionId, patientPrn: r.admission?.prn ?? null, department: r.admission?.department ?? null,
      extras: { admissionId: r.admissionId, hoursSinceRequest: hrs },
    });
    if (out?.created) raised += 1;
  }
  return { checked: rows.length, raised };
}

/** Emergency referrals stuck past their full escalation chain (level >= 2). */
async function runReferralChainExhausted(): Promise<RunnerOut> {
  const rows = await prisma.emergencyReferral.findMany({
    where: { status: 'pending', escalationLevel: { gte: 2 } },
    select: {
      id: true, emergencyId: true, escalationLevel: true, triageCategory: true,
      emergency: { select: { patientName: true, patientPrn: true } },
    },
    take: 500,
  });
  let raised = 0;
  for (const r of rows) {
    const out = await raiseByRule('EMERGENCY_REFERRAL_UNACK_FINAL', {
      emergencyId: r.emergencyId, patientPrn: r.emergency?.patientPrn ?? null, patientName: r.emergency?.patientName ?? null,
      extras: { escalationLevel: r.escalationLevel, triage: r.triageCategory },
    });
    if (out?.created) raised += 1;
  }
  return { checked: rows.length, raised };
}

export const CRON_RUNNERS: Array<{ key: string; run: () => Promise<RunnerOut> }> = [
  { key: 'IPD_INITIAL_ASSESSMENT_LATE', run: runInitialAssessmentLate },
  { key: 'DISCHARGE_SUMMARY_NOT_SIGNED', run: runDischargeSummaryUnsigned },
  { key: 'CRITICAL_LAB_NOT_ACKNOWLEDGED', run: runCriticalLabUnacked },
  { key: 'BED_REQUEST_UNFULFILLED', run: runBedRequestUnfulfilled },
  { key: 'EMERGENCY_REFERRAL_UNACK_FINAL', run: runReferralChainExhausted },
];

/** Run every cron rule once. Called from incident-rules.cron.ts. */
export async function runAllCronRules(): Promise<{ raised: number; checked: number }> {
  let raised = 0;
  let checked = 0;
  for (const r of CRON_RUNNERS) {
    try {
      const out = await r.run();
      raised += out.raised; checked += out.checked;
      if (out.raised > 0) {
        console.log(`[incident-rule:${r.key}] raised ${out.raised} new (checked ${out.checked})`);
      }
    } catch (err) {
      console.warn(`[incident-rule:${r.key}] runner failed:`, (err as Error).message);
    }
  }
  return { raised, checked };
}
