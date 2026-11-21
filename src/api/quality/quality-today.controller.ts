import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { EXPIRED_DISCHARGE_TYPES, HOSPITAL_TZ } from './quality-input.util';
import { getSubmissionStatus, submissionPeriod } from './quality-qi-deadline';

// Quality Manager "Today" page — what needs attention right now.
//
//   safety          what happened in the window (default last 24 h; Monday
//                   looks back to Friday 09:00) + serious incidents still
//                   waiting for an RCA, whenever they were raised
//   radar           every open item with a deadline that is overdue or due
//                   within 3 days, sorted by time left
//   accountability  open items per unit and per owner by age, and how fast
//                   each unit triages incidents
//
// Read-only. Rows carry codes / PRNs, never patient names. Each list is capped
// so one bad day can't make the page heavy; counts are always exact.

const ROW_CAP = 10;
const RADAR_CAP = 60;
const SOON_DAYS = 3;
const OPEN_INCIDENT = ['open', 'triaged', 'investigated', 'capa_in_progress'];
const OPEN_COMPLAINT = ['open', 'acknowledged', 'escalated'];
const OPEN_AUDIT = ['scheduled', 'in_progress'];
const SERIOUS_SEVERITY = ['major', 'sentinel'];
const SERIOUS_HARM = ['severe', 'permanent_or_death'];
const RCA_WAIT_HOURS = 24;
const NO_RCA_LOOKBACK_DAYS = 30;
const UNASSIGNED_LOOKBACK_DAYS = 30;

export interface Link { path: string; query?: Record<string, string> }
export interface BriefRow { ref: string; title: string; at: string | null; detail?: string | null; flag?: string | null; link?: Link }
export interface BriefSection { key: string; label: string; count: number; rows: BriefRow[]; link?: Link; tone: 'bad' | 'warn' | 'info' }
export interface RadarRow { kind: string; ref: string; title: string; owner: string | null; dueAt: string; bucket: 'overdue' | 'today' | 'soon'; link?: Link }

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const clip = (s: string | null | undefined, n = 140): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nameOf = (username: string | null | undefined): string | null =>
  username ? username.split('_')[0] : null;

/** Default window start: 24 h back; on a Monday, Friday 09:00 IST. */
export function windowStart(now: Date, hours?: number): Date {
  if (hours) return new Date(now.getTime() - hours * 3_600_000);
  const m = moment(now).tz(HOSPITAL_TZ);
  if (m.isoWeekday() === 1) return m.clone().subtract(3, 'days').hour(9).minute(0).second(0).millisecond(0).toDate();
  return new Date(now.getTime() - 24 * 3_600_000);
}

function bucketOf(due: Date, now: Date): RadarRow['bucket'] | null {
  if (due < now) return 'overdue';
  if (due <= moment(now).tz(HOSPITAL_TZ).endOf('day').toDate()) return 'today';
  if (due <= new Date(now.getTime() + SOON_DAYS * 86_400_000)) return 'soon';
  return null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const incidentLink = (id: string): Link => ({ path: `/incidents/${id}` });
const complaintLink = (id: string): Link => ({ path: `/complaints/${id}` });

// ─── Safety brief ────────────────────────────────────────────────────────

async function safetyBrief(since: Date, now: Date): Promise<BriefSection[]> {
  const inWindow = { gte: since, lte: now };
  const fbConfig = await prisma.feedbackConfig.findUnique({ where: { id: 1 }, select: { complaintMaxNps: true } }).catch(() => null);
  const lowNps = fbConfig?.complaintMaxNps ?? 6;
  const rcaCutoff = new Date(now.getTime() - RCA_WAIT_HOURS * 3_600_000);

  const deathWhere = { dischargeType: { in: EXPIRED_DISCHARGE_TYPES }, OR: [{ dischargeDate: inWindow }, { createdAt: inWindow }] };
  const seriousWhere = {
    reportedAt: inWindow, status: { not: 'cancelled' },
    OR: [{ severity: { in: SERIOUS_SEVERITY } }, { severityFinal: { in: SERIOUS_SEVERITY } }, { harmLevel: { in: SERIOUS_HARM } }, { harmLevelFinal: { in: SERIOUS_HARM } }],
  };
  // Last 30 days only — older backlog would bury today's sentinel; it shows in
  // the accountability "30+ days" column instead.
  const noRcaWhere = {
    status: { in: OPEN_INCIDENT }, reportedAt: { lt: rcaCutoff, gte: new Date(now.getTime() - NO_RCA_LOOKBACK_DAYS * 86_400_000) },
    AND: [
      { OR: [{ severity: { in: SERIOUS_SEVERITY } }, { severityFinal: { in: SERIOUS_SEVERITY } }, { harmLevel: { in: SERIOUS_HARM } }, { harmLevelFinal: { in: SERIOUS_HARM } }] },
      { OR: [{ capa: { is: null } }, { capa: { is: { rootCause: null } } }, { capa: { is: { rootCause: '' } } }] },
    ],
  };
  const watchWhere = {
    reportedAt: inWindow, status: { not: 'cancelled' },
    OR: [{ category: { in: ['fall', 'medication'] } }, { subCategory: { in: ['transfusion_reaction', 'needle_stick', 'body_fluid', 'pressure_injury', 'wrong_site', 'patient_id'] } }],
  };
  const autoWhere = { reportedAt: inWindow, source: 'auto-rule', status: { not: 'cancelled' }, ruleKey: { not: 'LOW_NPS_PATIENT_FEEDBACK' } };
  const complaintWhere = { raisedAt: inWindow, severity: 'high' };
  const feedbackWhere = { respondedAt: inWindow, npsScore: { lte: lowNps } };
  const incidentSelect = { id: true, code: true, title: true, severity: true, severityFinal: true, category: true, subCategory: true, ward: true, department: true, reportedAt: true, ruleKey: true, patientPrn: true, status: true };

  const [
    deathN, deaths, codeN, codes, seriousN, serious, noRcaN, noRca, watchN, watch, autoN, auto,
    lamaN, lama, damaN, dama, infN, inf, downN, down, utilN, util, cmpN, cmp, fbN, fb,
  ] = await Promise.all([
    prisma.ipdDischarge.count({ where: deathWhere }),
    prisma.ipdDischarge.findMany({
      where: deathWhere, orderBy: { dischargeDate: 'desc' }, take: ROW_CAP,
      select: { id: true, admissionId: true, dischargeDate: true, dischargeTime: true, admission: { select: { prn: true, ward: { select: { wardName: true } } } } },
    }),
    prisma.codeActivation.count({ where: { triggeredAt: inWindow } }),
    prisma.codeActivation.findMany({ where: { triggeredAt: inWindow }, orderBy: { triggeredAt: 'desc' }, take: ROW_CAP, select: { id: true, code: true, situation: true, location: true, status: true, triggeredAt: true } }),
    prisma.incident.count({ where: seriousWhere }),
    prisma.incident.findMany({ where: seriousWhere, orderBy: { reportedAt: 'desc' }, take: ROW_CAP, select: incidentSelect }),
    prisma.incident.count({ where: noRcaWhere }),
    prisma.incident.findMany({ where: noRcaWhere, orderBy: { reportedAt: 'asc' }, take: ROW_CAP, select: incidentSelect }),
    prisma.incident.count({ where: watchWhere }),
    prisma.incident.findMany({ where: watchWhere, orderBy: { reportedAt: 'desc' }, take: ROW_CAP, select: incidentSelect }),
    prisma.incident.count({ where: autoWhere }),
    prisma.incident.findMany({ where: autoWhere, orderBy: { reportedAt: 'desc' }, take: ROW_CAP, select: incidentSelect }),
    prisma.lamaRecord.count({ where: { lamaTime: inWindow } }),
    prisma.lamaRecord.findMany({ where: { lamaTime: inWindow }, orderBy: { lamaTime: 'desc' }, take: ROW_CAP, select: { id: true, lamaTime: true, admission: { select: { prn: true } }, emergencyId: true } }),
    prisma.damaRecord.count({ where: { dischargeTime: inWindow } }),
    prisma.damaRecord.findMany({ where: { dischargeTime: inWindow }, orderBy: { dischargeTime: 'desc' }, take: ROW_CAP, select: { id: true, dischargeTime: true, admission: { select: { prn: true } }, emergencyId: true } }),
    prisma.qualitySurveillanceEvent.count({ where: { observedAt: inWindow } }),
    prisma.qualitySurveillanceEvent.findMany({ where: { observedAt: inWindow }, orderBy: { observedAt: 'desc' }, take: ROW_CAP, select: { id: true, type: true, ward: true, organism: true, patientPrn: true, observedAt: true } }),
    // Critical equipment still broken down (whenever it broke) + any breakdown in the window.
    prisma.facilityEquipmentEvent.count({ where: { eventType: 'breakdown', OR: [{ occurredAt: inWindow }, { resolvedAt: null, equipment: { isCritical: true } }] } }),
    prisma.facilityEquipmentEvent.findMany({
      where: { eventType: 'breakdown', OR: [{ occurredAt: inWindow }, { resolvedAt: null, equipment: { isCritical: true } }] },
      orderBy: { occurredAt: 'desc' }, take: ROW_CAP,
      select: { id: true, occurredAt: true, resolvedAt: true, equipment: { select: { code: true, name: true, isCritical: true, location: true } } },
    }),
    prisma.facilityUtilityFailure.count({ where: { occurredAt: inWindow } }),
    prisma.facilityUtilityFailure.findMany({ where: { occurredAt: inWindow }, orderBy: { occurredAt: 'desc' }, take: ROW_CAP, select: { id: true, utilityType: true, occurredAt: true, durationMinutes: true, affectedAreas: true } }),
    prisma.complaint.count({ where: complaintWhere }),
    prisma.complaint.findMany({ where: complaintWhere, orderBy: { raisedAt: 'desc' }, take: ROW_CAP, select: { id: true, code: true, category: true, department: true, status: true, raisedAt: true, patientPrn: true } }),
    prisma.feedbackSurvey.count({ where: feedbackWhere }),
    prisma.feedbackSurvey.findMany({ where: feedbackWhere, orderBy: { respondedAt: 'desc' }, take: ROW_CAP, select: { id: true, npsScore: true, comments: true, wardName: true, department: true, respondedAt: true, patientPrn: true } }),
  ]);

  const incRow = (i: typeof serious[number], flag?: string | null): BriefRow => ({
    ref: i.code, title: i.title, at: iso(i.reportedAt),
    detail: [i.severityFinal ?? i.severity, i.subCategory ?? i.category, i.ward ?? i.department, i.patientPrn && `PRN ${i.patientPrn}`].filter(Boolean).join(' · '),
    flag: flag ?? null, link: incidentLink(i.id),
  });
  const hoursAgo = (d: Date) => Math.floor((now.getTime() - d.getTime()) / 3_600_000);

  const sections: BriefSection[] = [
    {
      key: 'deaths', label: 'Deaths', count: deathN, tone: 'bad',
      rows: deaths.map((d) => ({
        ref: d.admission?.prn ? `PRN ${d.admission.prn}` : 'Death', title: d.admission?.ward?.wardName ?? 'Ward not recorded',
        at: iso(d.dischargeDate), detail: d.dischargeTime || null, link: { path: `/ipd/admission/${d.admissionId}/discharge` },
      })),
    },
    {
      key: 'codes', label: 'Emergency codes', count: codeN, tone: 'bad', link: { path: '/emergency/codes' },
      rows: codes.map((c) => ({ ref: `Code ${c.code}`, title: c.situation, at: iso(c.triggeredAt), detail: c.location, flag: c.status === 'active' ? 'still active' : null, link: { path: '/emergency/codes' } })),
    },
    {
      key: 'serious', label: 'Serious-harm & sentinel incidents', count: seriousN, tone: 'bad',
      link: { path: '/incidents', query: { severity: 'sentinel' } },
      rows: serious.map((i) => incRow(i)),
    },
    {
      key: 'no_rca', label: `Serious incidents with no root cause after ${RCA_WAIT_HOURS} h (last ${NO_RCA_LOOKBACK_DAYS} days)`, count: noRcaN, tone: 'bad',
      rows: noRca.map((i) => incRow(i, `${hoursAgo(i.reportedAt)} h without RCA`)),
    },
    {
      key: 'watch', label: 'Falls, medication, transfusion & other watch incidents', count: watchN, tone: 'warn',
      rows: watch.map((i) => incRow(i)),
    },
    {
      key: 'auto', label: 'Raised automatically (return to OT, SSI, critical lab not acknowledged …)', count: autoN, tone: 'warn',
      link: { path: '/incidents', query: { source: 'auto-rule' } },
      rows: auto.map((i) => incRow(i, i.ruleKey)),
    },
    {
      key: 'lama_dama', label: 'LAMA / DAMA', count: lamaN + damaN, tone: 'warn', link: { path: '/lama-dama' },
      rows: [
        ...lama.map((l) => ({ ref: 'LAMA', title: l.admission?.prn ? `PRN ${l.admission.prn}` : (l.emergencyId ? `Emergency #${l.emergencyId}` : 'Patient'), at: iso(l.lamaTime), link: { path: '/lama-dama' } })),
        ...dama.map((d) => ({ ref: 'DAMA', title: d.admission?.prn ? `PRN ${d.admission.prn}` : (d.emergencyId ? `Emergency #${d.emergencyId}` : 'Patient'), at: iso(d.dischargeTime), link: { path: '/lama-dama' } })),
      ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, ROW_CAP),
    },
    {
      key: 'infection', label: 'Infections & needle-stick (surveillance)', count: infN, tone: 'warn', link: { path: '/quality/infection-control' },
      rows: inf.map((e) => ({ ref: e.type, title: e.ward ?? 'Ward not recorded', at: iso(e.observedAt), detail: [e.organism, e.patientPrn && `PRN ${e.patientPrn}`].filter(Boolean).join(' · ') || null, link: { path: '/quality/infection-control' } })),
    },
    {
      key: 'facility', label: 'Equipment breakdowns & utility failures', count: downN + utilN, tone: 'warn', link: { path: '/quality/facility' },
      rows: [
        ...down.map((e) => ({
          ref: e.equipment.code, title: e.equipment.name, at: iso(e.occurredAt), detail: e.equipment.location,
          flag: e.resolvedAt ? null : (e.equipment.isCritical ? 'critical · still down' : 'still down'), link: { path: '/quality/facility' },
        })),
        ...util.map((u) => ({ ref: u.utilityType.replace('_', ' '), title: clip(u.affectedAreas, 80) ?? 'Utility failure', at: iso(u.occurredAt), detail: u.durationMinutes ? `${u.durationMinutes} min` : null, link: { path: '/quality/facility' } })),
      ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, ROW_CAP),
    },
    {
      key: 'complaints', label: 'High-severity complaints', count: cmpN, tone: 'warn', link: { path: '/complaints', query: { severity: 'high' } },
      rows: cmp.map((c) => ({ ref: c.code, title: c.category ? c.category.replace(/_/g, ' ') : 'Type not set', at: iso(c.raisedAt), detail: [c.department, c.status, c.patientPrn && `PRN ${c.patientPrn}`].filter(Boolean).join(' · '), link: complaintLink(c.id) })),
    },
    {
      key: 'feedback', label: `Low feedback scores (NPS ${lowNps} or below)`, count: fbN, tone: 'info', link: { path: '/feedback' },
      rows: fb.map((f) => ({ ref: `NPS ${f.npsScore}`, title: f.wardName ?? f.department ?? 'Patient feedback', at: iso(f.respondedAt), detail: clip(f.comments) ?? 'No comment', link: { path: '/feedback' } })),
    },
  ];
  return sections;
}

// ─── Deadline radar ──────────────────────────────────────────────────────

async function deadlineRadar(now: Date): Promise<{ rows: RadarRow[]; counts: Record<'overdue' | 'today' | 'soon', number>; byKind: Record<string, number>; qiSubmission: unknown }> {
  const horizon = new Date(now.getTime() + SOON_DAYS * 86_400_000);
  const due = { lte: horizon };

  const [complaints, capa, reviews, rcas, audits, auditActions] = await Promise.all([
    prisma.complaint.findMany({ where: { status: { in: OPEN_COMPLAINT }, slaDueAt: due }, select: { id: true, code: true, category: true, department: true, assignedTo: true, slaDueAt: true } }),
    prisma.incidentCapaAction.findMany({
      where: { status: 'open', dueDate: due, incident: { status: { notIn: ['closed', 'cancelled'] } } },
      select: { id: true, description: true, owner: true, dueDate: true, incident: { select: { id: true, code: true } } },
    }),
    prisma.incidentEffectivenessReview.findMany({
      where: { status: 'pending', dueAt: due, incident: { status: 'closed' } },
      select: { id: true, dayOffset: true, dueAt: true, incident: { select: { id: true, code: true, assignedTo: true } } },
    }),
    prisma.qualityIndicatorRca.findMany({
      where: { status: { not: 'closed' }, dueDate: due },
      select: { id: true, owner: true, dueDate: true, record: { select: { qiCode: true, period: true } } },
    }),
    prisma.auditRun.findMany({ where: { status: { in: OPEN_AUDIT }, dueDate: due }, select: { id: true, code: true, auditor: true, dueDate: true, checklist: { select: { name: true } } } }),
    prisma.auditFindingAction.findMany({
      where: { status: 'open', dueDate: due },
      select: { id: true, description: true, owner: true, dueDate: true, run: { select: { id: true, code: true } } },
    }),
  ]);

  const rows: RadarRow[] = [];
  const push = (r: Omit<RadarRow, 'bucket' | 'dueAt'> & { due: Date | null }) => {
    if (!r.due) return;
    const bucket = bucketOf(r.due, now);
    if (!bucket) return;
    const { due: d, ...rest } = r;
    rows.push({ ...rest, dueAt: d.toISOString(), bucket });
  };
  for (const c of complaints) push({ kind: 'Complaint', ref: c.code, title: [c.category ? c.category.replace(/_/g, ' ') : 'Type not set', c.department].filter(Boolean).join(' · '), owner: nameOf(c.assignedTo), due: c.slaDueAt, link: complaintLink(c.id) });
  for (const a of capa) push({ kind: 'CAPA action', ref: a.incident.code, title: clip(a.description, 90) ?? 'Action', owner: nameOf(a.owner), due: a.dueDate, link: incidentLink(a.incident.id) });
  for (const r of reviews) push({ kind: 'Effectiveness check', ref: r.incident.code, title: `${r.dayOffset}-day check`, owner: nameOf(r.incident.assignedTo), due: r.dueAt, link: incidentLink(r.incident.id) });
  for (const r of rcas) push({ kind: 'QI RCA', ref: r.record?.qiCode ?? 'RCA', title: r.record ? `RCA for ${r.record.period}` : 'Indicator RCA', owner: r.owner, due: r.dueDate, link: { path: `/quality/rcas/${r.id}` } });
  for (const a of audits) push({ kind: 'Audit', ref: a.code, title: a.checklist.name, owner: nameOf(a.auditor), due: a.dueDate, link: { path: `/quality/audits/runs/${a.id}` } });
  for (const a of auditActions) push({ kind: 'Audit finding', ref: a.run.code, title: clip(a.description, 90) ?? 'Action', owner: nameOf(a.owner), due: a.dueDate, link: { path: `/quality/audits/runs/${a.run.id}` } });

  // Monthly QI submission — needs the QI-deadline migration; skipped (null) until then.
  let qiSubmission: unknown = null;
  try {
    const s = await getSubmissionStatus(submissionPeriod(now), now);
    qiSubmission = { period: s.period, dueDate: s.dueDate, daysLeft: s.daysLeft, state: s.state, expected: s.expected, entered: s.entered, missing: s.missing.length };
    if (s.missing.length > 0) {
      push({ kind: 'QI data', ref: s.period, title: `${s.missing.length} of ${s.expected} indicators not entered`, owner: null, due: new Date(s.dueDate), link: { path: '/quality/indicators', query: { missing: '1' } } });
    }
  } catch { /* QualityConfig table not migrated yet */ }

  rows.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const counts = { overdue: 0, today: 0, soon: 0 };
  const byKind: Record<string, number> = {};
  for (const r of rows) { counts[r.bucket] += 1; byKind[r.kind] = (byKind[r.kind] ?? 0) + 1; }
  return { rows: rows.slice(0, RADAR_CAP), counts, byKind, qiSubmission };
}

// ─── Accountability ──────────────────────────────────────────────────────

type Age = { d0_7: number; d8_30: number; d30p: number };
const ageBucket = (from: Date, now: Date): keyof Age => {
  const days = (now.getTime() - from.getTime()) / 86_400_000;
  return days <= 7 ? 'd0_7' : days <= 30 ? 'd8_30' : 'd30p';
};

async function accountability(now: Date) {
  const since90 = new Date(now.getTime() - 90 * 86_400_000);
  const [units, incidents, complaints, capa, findings, triaged] = await Promise.all([
    prisma.hospitalUnit.findMany({ where: { isActive: true }, select: { id: true, name: true, hodUserId: true }, orderBy: { name: 'asc' } }),
    prisma.incident.findMany({ where: { status: { in: OPEN_INCIDENT } }, select: { unitId: true, reportedAt: true, assignedToId: true, assignedTo: true, status: true }, take: 5000 }),
    prisma.complaint.findMany({ where: { status: { in: OPEN_COMPLAINT } }, select: { unitId: true, raisedAt: true, slaDueAt: true, assignedToId: true, assignedTo: true }, take: 5000 }),
    prisma.incidentCapaAction.findMany({
      where: { status: 'open', incident: { status: { notIn: ['closed', 'cancelled'] } } },
      select: { ownerId: true, owner: true, dueDate: true, createdAt: true, incident: { select: { unitId: true } } }, take: 5000,
    }),
    prisma.auditFindingAction.findMany({ where: { status: 'open' }, select: { ownerId: true, owner: true, dueDate: true, createdAt: true, run: { select: { unitId: true } } }, take: 5000 }),
    prisma.incident.findMany({ where: { reportedAt: { gte: since90 }, triagedAt: { not: null } }, select: { unitId: true, reportedAt: true, triagedAt: true }, take: 5000 }),
  ]);

  const hodIds = units.map((u) => u.hodUserId).filter((x): x is number => typeof x === 'number');
  const hods = hodIds.length ? await prisma.user.findMany({ where: { id: { in: hodIds } }, select: { id: true, username: true } }) : [];
  const hodName = new Map(hods.map((h) => [h.id, nameOf(h.username)]));

  type UnitAgg = { unitId: number | null; unit: string; hod: string | null; incidents: Age; complaints: Age; overdue: number; untriaged24h: number; triageHours: number[] };
  const blank = (): Age => ({ d0_7: 0, d8_30: 0, d30p: 0 });
  const byUnit = new Map<number | null, UnitAgg>();
  for (const u of units) byUnit.set(u.id, { unitId: u.id, unit: u.name, hod: u.hodUserId ? hodName.get(u.hodUserId) ?? null : null, incidents: blank(), complaints: blank(), overdue: 0, untriaged24h: 0, triageHours: [] });
  const unitOf = (id: number | null): UnitAgg => {
    const key = id !== null && byUnit.has(id) ? id : null;
    if (!byUnit.has(key)) byUnit.set(key, { unitId: null, unit: 'No unit / inactive unit', hod: null, incidents: blank(), complaints: blank(), overdue: 0, untriaged24h: 0, triageHours: [] });
    return byUnit.get(key)!;
  };

  for (const i of incidents) {
    const u = unitOf(i.unitId);
    u.incidents[ageBucket(i.reportedAt, now)] += 1;
    if (i.status === 'open' && now.getTime() - i.reportedAt.getTime() > 24 * 3_600_000) u.untriaged24h += 1;
  }
  for (const c of complaints) {
    const u = unitOf(c.unitId);
    u.complaints[ageBucket(c.raisedAt, now)] += 1;
    if (c.slaDueAt && c.slaDueAt < now) u.overdue += 1;
  }
  for (const a of capa) if (a.dueDate && a.dueDate < now) unitOf(a.incident.unitId).overdue += 1;
  for (const a of findings) if (a.dueDate && a.dueDate < now) unitOf(a.run.unitId).overdue += 1;
  for (const t of triaged) if (t.triagedAt) unitOf(t.unitId).triageHours.push((t.triagedAt.getTime() - t.reportedAt.getTime()) / 3_600_000);

  const unitRows = [...byUnit.values()]
    .map(({ triageHours, ...u }) => {
      const med = median(triageHours);
      return { ...u, open: Object.values(u.incidents).reduce((a, b) => a + b, 0) + Object.values(u.complaints).reduce((a, b) => a + b, 0), medianTriageHours: med === null ? null : Math.round(med * 10) / 10, triagedLast90: triageHours.length };
    })
    .filter((u) => u.open > 0 || u.overdue > 0 || u.unitId !== null)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.unit.localeCompare(b.unit));

  // Owners — anyone holding open incidents, complaints, CAPA or audit actions.
  type OwnerAgg = { key: string; name: string; open: number; overdue: number; oldest: Date | null };
  const owners = new Map<string, OwnerAgg>();
  const addOwner = (id: number | null, name: string | null, since: Date, dueAt: Date | null) => {
    if (id === null && !name) return;
    const key = id !== null ? `u${id}` : `n${name}`;
    const o = owners.get(key) ?? { key, name: nameOf(name) ?? `User #${id}`, open: 0, overdue: 0, oldest: null };
    o.open += 1;
    if (dueAt && dueAt < now) o.overdue += 1;
    if (!o.oldest || since < o.oldest) o.oldest = since;
    owners.set(key, o);
  };
  for (const i of incidents) addOwner(i.assignedToId, i.assignedTo, i.reportedAt, null);
  for (const c of complaints) addOwner(c.assignedToId, c.assignedTo, c.raisedAt, c.slaDueAt);
  for (const a of capa) addOwner(a.ownerId, a.owner, a.createdAt, a.dueDate);
  for (const a of findings) addOwner(a.ownerId, a.owner, a.createdAt, a.dueDate);
  const ownerRows = [...owners.values()]
    .map(({ key, oldest, ...o }) => ({ ...o, oldestDays: oldest ? Math.floor((now.getTime() - oldest.getTime()) / 86_400_000) : 0 }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || b.oldestDays - a.oldestDays)
    .slice(0, 15);

  // Last 30 days only — years of never-assigned auto-rule backlog would drown it.
  const since30 = new Date(now.getTime() - UNASSIGNED_LOOKBACK_DAYS * 86_400_000);
  const unassigned = {
    days: UNASSIGNED_LOOKBACK_DAYS,
    incidents: incidents.filter((i) => i.assignedToId === null && !i.assignedTo && i.reportedAt >= since30).length,
    complaints: complaints.filter((c) => c.assignedToId === null && !c.assignedTo && c.raisedAt >= since30).length,
  };
  return { units: unitRows, owners: ownerRows, unassigned };
}

// ─── Handler ─────────────────────────────────────────────────────────────

export const qualityToday = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawHours = req.query['hours'];
    let hours: number | undefined;
    if (rawHours !== undefined) {
      hours = Number(rawHours);
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
        res.status(400).json({ message: 'hours must be a whole number from 1 to 168' });
        return;
      }
    }
    const now = new Date();
    const since = windowStart(now, hours);
    const [safety, radar, people] = await Promise.all([safetyBrief(since, now), deadlineRadar(now), accountability(now)]);
    res.status(200).json({
      data: { generatedAt: now.toISOString(), since: since.toISOString(), safety, radar, accountability: people },
    });
  } catch (error) {
    console.error('[quality-today] failed:', error);
    res.status(500).json({ message: 'Failed to load the Today page' });
  }
};
