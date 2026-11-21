import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { EXPIRED_DISCHARGE_TYPES, HOSPITAL_TZ } from './quality-input.util';
import { detectSignals, median, Direction, RunSignal } from '../../service/run-chart';

// Quality insights — Phase 2 of the Quality Manager dashboard (read-only).
//
//   trends     19 monthly measures over the last 12 complete months + this
//              month so far, each with its median and run-chart signals
//   heatmap    one month, one row per hospital unit, cells coloured against
//              the hospital as a whole
//   clusters   patterns worth a look: possible outbreaks, falls / medication
//              errors / pressure injuries bunching in a ward, repeat complaint
//              types, repeat low scores for one doctor, repeat patients
//
// Patient-days come from admission → discharge dates (the bed-census snapshot
// table is too sparse to rely on); a transferred patient counts against their
// current ward. Cases raised before units existed are matched to a unit by
// ward, then department — the same order resolveUnitId uses.

const OPEN_INCIDENT = ['open', 'triaged', 'investigated', 'capa_in_progress'];
const OPEN_COMPLAINT = ['open', 'acknowledged', 'escalated'];
const SERIOUS_SEVERITY = ['major', 'sentinel'];
const SERIOUS_HARM = ['severe', 'permanent_or_death'];
const DAY = 86_400_000;
const CACHE_MS = 10 * 60_000;
const ROW_CAP = 50_000;

// ─── Small helpers ───────────────────────────────────────────────────────

const monthOf = (d: Date): string => moment(d).tz(HOSPITAL_TZ).format('YYYY-MM');
const monthStart = (key: string): Date => moment.tz(key, 'YYYY-MM', HOSPITAL_TZ).startOf('month').toDate();
const monthEnd = (key: string): Date => moment.tz(key, 'YYYY-MM', HOSPITAL_TZ).endOf('month').toDate();
const round1 = (n: number): number => Math.round(n * 10) / 10;
const lc = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/** The last `count` complete months, oldest first, plus the current month. */
export function monthKeys(now: Date, count = 12): { complete: string[]; current: string } {
  const cur = moment(now).tz(HOSPITAL_TZ).startOf('month');
  const complete: string[] = [];
  for (let i = count; i >= 1; i--) complete.push(cur.clone().subtract(i, 'months').format('YYYY-MM'));
  return { complete, current: cur.format('YYYY-MM') };
}

const isSerious = (i: { severity: string; severityFinal: string | null; harmLevel: string | null; harmLevelFinal: string | null }): boolean =>
  SERIOUS_SEVERITY.includes(i.severityFinal ?? i.severity) || SERIOUS_HARM.includes(i.harmLevelFinal ?? i.harmLevel ?? '');

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, fresh: boolean, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}
export function clearInsightsCache(): void { cache.clear(); }

// ─── Unit resolution ─────────────────────────────────────────────────────

export interface UnitResolver {
  units: Array<{ id: number; name: string; hasWards: boolean }>;
  resolve(r: { unitId?: number | null; wardId?: string | null; ward?: string | null; department?: string | null }): number | null;
}

export async function loadUnitResolver(): Promise<UnitResolver> {
  const [units, maps, wards] = await Promise.all([
    prisma.hospitalUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.hospitalUnitMapping.findMany({ where: { unit: { isActive: true } }, select: { unitId: true, kind: true, value: true } }),
    prisma.ipdWard.findMany({ select: { id: true, wardName: true, wardCode: true } }),
  ]);
  const active = new Set(units.map((u) => u.id));
  const wardUnit = new Map<string, number>();
  const deptUnit = new Map<string, number>();
  for (const m of maps) (m.kind === 'ward' ? wardUnit.set(m.value, m.unitId) : deptUnit.set(lc(m.value), m.unitId));
  const nameUnit = new Map(units.map((u) => [lc(u.name), u.id]));
  const wardIdByName = new Map<string, string>();
  for (const w of wards) { wardIdByName.set(lc(w.wardName), w.id); wardIdByName.set(lc(w.wardCode), w.id); }
  const unitsWithWards = new Set([...wardUnit.values()]);
  return {
    units: units.map((u) => ({ ...u, hasWards: unitsWithWards.has(u.id) })),
    resolve(r) {
      if (r.unitId && active.has(r.unitId)) return r.unitId;
      const wardId = r.wardId ?? (r.ward ? wardIdByName.get(lc(r.ward)) : undefined);
      if (wardId && wardUnit.has(wardId)) return wardUnit.get(wardId)!;
      const d = lc(r.department);
      if (d) return deptUnit.get(d) ?? nameUnit.get(d) ?? null;
      return null;
    },
  };
}

// ─── Patient-days ────────────────────────────────────────────────────────

interface Stay { start: number; end: number; unitId: number | null }

async function loadStays(from: Date, to: Date, resolver: UnitResolver): Promise<Stay[]> {
  const rows = await prisma.ipdAdmission.findMany({
    where: {
      admissionDate: { lte: to },
      NOT: [{ status: { in: ['PROPOSED', 'proposed', 'CANCELLED', 'cancelled', 'REJECTED', 'rejected'] } }],
      OR: [{ discharge: { is: null } }, { discharge: { is: { dischargeDate: { gte: from } } } }],
    },
    select: { admissionDate: true, wardId: true, department: true, status: true, updatedAt: true, discharge: { select: { dischargeDate: true } } },
    take: ROW_CAP,
  });
  const now = Date.now();
  return rows.map((a) => {
    const ended = a.discharge?.dischargeDate ?? (/discharg/i.test(a.status) ? a.updatedAt : null);
    return { start: a.admissionDate.getTime(), end: Math.min(ended ? ended.getTime() : now, now), unitId: resolver.resolve({ wardId: a.wardId, department: a.department }) };
  }).filter((s) => s.end > s.start);
}

function patientDays(stays: Stay[], from: Date, to: Date, unitId?: number | null): number {
  const a = from.getTime();
  const b = Math.min(to.getTime(), Date.now());
  let ms = 0;
  for (const s of stays) {
    if (unitId !== undefined && s.unitId !== unitId) continue;
    const o = Math.min(s.end, b) - Math.max(s.start, a);
    if (o > 0) ms += o;
  }
  return ms / DAY;
}

// ─── Trends ──────────────────────────────────────────────────────────────

export interface TrendPoint { period: string; value: number | null; n: number }
export interface TrendMeasure {
  key: string; label: string; group: string; unit: string; direction: Direction; help: string;
  points: TrendPoint[]; current: TrendPoint; median: number | null; signals: RunSignal[]; enoughData: boolean;
  link?: { path: string; query?: Record<string, string> };
}

interface MonthAcc {
  inc: number; serious: number; nearMiss: number; falls: number; med: number; closeDays: number[];
  vap: number; cauti: number; clabsi: number; ssi: number; nsi: number;
  devVent: number; devCath: number; devLine: number; surgeries: number;
  npsP: number; npsD: number; npsN: number;
  cmp: number; cmpResolved: number; cmpOnTime: number;
  auditSum: number; auditN: number; qiRed: number; qiTotal: number;
  disch: number; expired: number; lamaDama: number; pd: number;
}
const blankAcc = (): MonthAcc => ({
  inc: 0, serious: 0, nearMiss: 0, falls: 0, med: 0, closeDays: [], vap: 0, cauti: 0, clabsi: 0, ssi: 0, nsi: 0,
  devVent: 0, devCath: 0, devLine: 0, surgeries: 0, npsP: 0, npsD: 0, npsN: 0, cmp: 0, cmpResolved: 0, cmpOnTime: 0,
  auditSum: 0, auditN: 0, qiRed: 0, qiTotal: 0, disch: 0, expired: 0, lamaDama: 0, pd: 0,
});

interface MeasureDef {
  key: string; label: string; group: string; unit: string; direction: Direction; minN: number; help: string;
  value(a: MonthAcc): number | null; n(a: MonthAcc): number;
  link?: TrendMeasure['link'];
}
const per = (num: number, den: number, k: number): number | null => (den > 0 ? round1((num / den) * k) : null);

export const MEASURES: MeasureDef[] = [
  { key: 'incidents', label: 'Incidents reported', group: 'Patient safety', unit: '', direction: 'neutral', minN: 0, value: (a) => a.inc, n: (a) => a.inc, help: 'More reporting usually means a healthier safety culture, not more harm.', link: { path: '/incidents' } },
  { key: 'reporting_rate', label: 'Incidents per 1,000 patient-days', group: 'Patient safety', unit: '/1000 pd', direction: 'neutral', minN: 0, value: (a) => per(a.inc, a.pd, 1000), n: (a) => a.inc, help: 'Patient-days from admission and discharge dates.' },
  { key: 'serious_harm', label: 'Serious-harm & sentinel incidents', group: 'Patient safety', unit: '', direction: 'up_bad', minN: 0, value: (a) => a.serious, n: (a) => a.serious, help: 'Major / sentinel severity, or severe / permanent harm.', link: { path: '/incidents', query: { severity: 'sentinel' } } },
  { key: 'near_miss_pct', label: 'Near misses (% of incidents)', group: 'Patient safety', unit: '%', direction: 'down_bad', minN: 10, value: (a) => per(a.nearMiss, a.inc, 100), n: (a) => a.inc, help: 'A falling share of near misses can mean staff stopped reporting them.' },
  { key: 'falls_rate', label: 'Falls per 1,000 patient-days', group: 'Patient safety', unit: '/1000 pd', direction: 'up_bad', minN: 3, value: (a) => per(a.falls, a.pd, 1000), n: (a) => a.falls, help: 'Fall incidents ÷ patient-days.', link: { path: '/incidents', query: { category: 'fall' } } },
  { key: 'med_errors', label: 'Medication incidents', group: 'Patient safety', unit: '', direction: 'up_bad', minN: 0, value: (a) => a.med, n: (a) => a.med, help: 'Incidents in the medication category.', link: { path: '/incidents', query: { category: 'medication' } } },
  { key: 'days_to_close', label: 'Median days to close an incident', group: 'Patient safety', unit: 'days', direction: 'up_bad', minN: 5, value: (a) => { const m = median(a.closeDays); return m === null ? null : round1(m); }, n: (a) => a.closeDays.length, help: 'Incidents closed in the month, report → close.' },
  { key: 'vap_rate', label: 'VAP per 1,000 ventilator-days', group: 'Infection control', unit: '/1000 dd', direction: 'up_bad', minN: 50, value: (a) => per(a.vap, a.devVent, 1000), n: (a) => a.devVent, help: 'Needs daily device-day counts on the Infection control screen.', link: { path: '/quality/infection-control' } },
  { key: 'cauti_rate', label: 'CAUTI per 1,000 catheter-days', group: 'Infection control', unit: '/1000 dd', direction: 'up_bad', minN: 50, value: (a) => per(a.cauti, a.devCath, 1000), n: (a) => a.devCath, help: 'Needs daily device-day counts.', link: { path: '/quality/infection-control' } },
  { key: 'clabsi_rate', label: 'CLABSI per 1,000 central-line-days', group: 'Infection control', unit: '/1000 dd', direction: 'up_bad', minN: 50, value: (a) => per(a.clabsi, a.devLine, 1000), n: (a) => a.devLine, help: 'Needs daily device-day counts.', link: { path: '/quality/infection-control' } },
  { key: 'ssi_rate', label: 'Surgical site infections per 100 surgeries', group: 'Infection control', unit: '%', direction: 'up_bad', minN: 20, value: (a) => per(a.ssi, a.surgeries, 100), n: (a) => a.surgeries, help: 'SSI surveillance cases ÷ completed OT cases.', link: { path: '/quality/infection-control' } },
  { key: 'nsi', label: 'Needle-stick injuries', group: 'Infection control', unit: '', direction: 'up_bad', minN: 0, value: (a) => a.nsi, n: (a) => a.nsi, help: 'From infection surveillance.', link: { path: '/quality/infection-control' } },
  { key: 'nps', label: 'Patient NPS', group: 'Patient experience', unit: '', direction: 'down_bad', minN: 10, value: (a) => (a.npsN ? Math.round(((a.npsP - a.npsD) / a.npsN) * 100) : null), n: (a) => a.npsN, help: '% promoters (9–10) minus % detractors (0–6).', link: { path: '/feedback/analytics' } },
  { key: 'complaints', label: 'Complaints raised', group: 'Patient experience', unit: '', direction: 'up_bad', minN: 0, value: (a) => a.cmp, n: (a) => a.cmp, help: '', link: { path: '/complaints' } },
  { key: 'complaints_on_time', label: 'Complaints resolved on time', group: 'Patient experience', unit: '%', direction: 'down_bad', minN: 5, value: (a) => per(a.cmpOnTime, a.cmpResolved, 100), n: (a) => a.cmpResolved, help: 'Of complaints resolved in the month, % resolved before their deadline.', link: { path: '/complaints' } },
  { key: 'audit_compliance', label: 'Audit compliance', group: 'Process & compliance', unit: '%', direction: 'down_bad', minN: 1, value: (a) => (a.auditN ? round1(a.auditSum / a.auditN) : null), n: (a) => a.auditN, help: 'Average score of audits completed in the month.', link: { path: '/quality/audits' } },
  { key: 'qi_red', label: 'Indicators red or critical', group: 'Process & compliance', unit: '', direction: 'up_bad', minN: 0, value: (a) => (a.qiTotal ? a.qiRed : null), n: (a) => a.qiTotal, help: 'Of the indicator values recorded for the month.', link: { path: '/quality/indicators' } },
  { key: 'mortality_pct', label: 'Mortality (% of discharges)', group: 'Clinical outcomes', unit: '%', direction: 'up_bad', minN: 20, value: (a) => per(a.expired, a.disch, 100), n: (a) => a.disch, help: 'Crude, not risk-adjusted.' },
  { key: 'lama_dama_pct', label: 'LAMA / DAMA (% of discharges)', group: 'Clinical outcomes', unit: '%', direction: 'up_bad', minN: 20, value: (a) => per(a.lamaDama, a.disch, 100), n: (a) => a.disch, help: '', link: { path: '/lama-dama' } },
];

async function buildTrends(now: Date): Promise<{ months: string[]; current: string; measures: TrendMeasure[]; generatedAt: string }> {
  const { complete, current } = monthKeys(now);
  const keys = [...complete, current];
  const from = monthStart(complete[0]);
  const acc = new Map(keys.map((k) => [k, blankAcc()]));
  const at = (d: Date | null | undefined): MonthAcc | undefined => (d ? acc.get(monthOf(d)) : undefined);
  const resolver = await loadUnitResolver();

  const [incidents, closed, complaints, resolved, surveys, audits, qi, surv, devDays, ot, disch, lama, dama, stays] = await Promise.all([
    prisma.incident.findMany({ where: { reportedAt: { gte: from }, status: { not: 'cancelled' } }, select: { reportedAt: true, severity: true, severityFinal: true, harmLevel: true, harmLevelFinal: true, category: true }, take: ROW_CAP }),
    prisma.incident.findMany({ where: { closedAt: { gte: from }, status: 'closed' }, select: { reportedAt: true, closedAt: true }, take: ROW_CAP }),
    prisma.complaint.findMany({ where: { raisedAt: { gte: from } }, select: { raisedAt: true }, take: ROW_CAP }),
    prisma.complaint.findMany({ where: { resolvedAt: { gte: from } }, select: { resolvedAt: true, slaDueAt: true }, take: ROW_CAP }),
    prisma.feedbackSurvey.findMany({ where: { respondedAt: { gte: from }, npsScore: { not: null } }, select: { respondedAt: true, npsScore: true }, take: ROW_CAP }),
    prisma.auditRun.findMany({ where: { status: 'completed', completedAt: { gte: from }, compliancePct: { not: null } }, select: { completedAt: true, compliancePct: true }, take: ROW_CAP }),
    prisma.qualityIndicatorRecord.findMany({ where: { periodStart: { gte: from } }, select: { periodStart: true, status: true }, take: ROW_CAP }),
    prisma.qualitySurveillanceEvent.findMany({ where: { observedAt: { gte: from } }, select: { observedAt: true, type: true }, take: ROW_CAP }),
    prisma.qualityDeviceDayCount.findMany({ where: { date: { gte: from } }, select: { date: true, deviceType: true, count: true }, take: ROW_CAP }),
    prisma.otSchedule.findMany({ where: { plannedStart: { gte: from }, status: { in: ['CLOSED', 'closed', 'COMPLETED', 'completed'] } }, select: { plannedStart: true }, take: ROW_CAP }).catch(() => [] as Array<{ plannedStart: Date }>),
    prisma.ipdDischarge.findMany({ where: { dischargeDate: { gte: from } }, select: { dischargeDate: true, dischargeType: true }, take: ROW_CAP }),
    prisma.lamaRecord.findMany({ where: { lamaTime: { gte: from }, admissionId: { not: null } }, select: { lamaTime: true }, take: ROW_CAP }),
    prisma.damaRecord.findMany({ where: { dischargeTime: { gte: from }, admissionId: { not: null } }, select: { dischargeTime: true }, take: ROW_CAP }),
    loadStays(from, now, resolver),
  ]);

  for (const i of incidents) {
    const a = at(i.reportedAt); if (!a) continue;
    a.inc += 1;
    if (isSerious(i)) a.serious += 1;
    if ((i.severityFinal ?? i.severity) === 'near_miss') a.nearMiss += 1;
    if (i.category === 'fall') a.falls += 1;
    if (i.category === 'medication') a.med += 1;
  }
  for (const c of closed) { const a = at(c.closedAt); if (a && c.closedAt) a.closeDays.push((c.closedAt.getTime() - c.reportedAt.getTime()) / DAY); }
  for (const c of complaints) { const a = at(c.raisedAt); if (a) a.cmp += 1; }
  for (const c of resolved) { const a = at(c.resolvedAt); if (!a || !c.resolvedAt) continue; a.cmpResolved += 1; if (!c.slaDueAt || c.resolvedAt <= c.slaDueAt) a.cmpOnTime += 1; }
  for (const s of surveys) {
    const a = at(s.respondedAt); if (!a || s.npsScore === null) continue;
    a.npsN += 1; if (s.npsScore >= 9) a.npsP += 1; else if (s.npsScore <= 6) a.npsD += 1;
  }
  for (const r of audits) { const a = at(r.completedAt); if (a && r.compliancePct !== null) { a.auditSum += r.compliancePct; a.auditN += 1; } }
  for (const r of qi) { const a = at(r.periodStart); if (!a) continue; a.qiTotal += 1; if (r.status === 'red' || r.status === 'critical') a.qiRed += 1; }
  for (const e of surv) {
    const a = at(e.observedAt); if (!a) continue;
    if (e.type === 'VAP') a.vap += 1; else if (e.type === 'CAUTI') a.cauti += 1; else if (e.type === 'CLABSI') a.clabsi += 1;
    else if (e.type === 'SSI') a.ssi += 1; else if (e.type === 'NSI') a.nsi += 1;
  }
  for (const d of devDays) {
    const a = at(d.date); if (!a) continue;
    if (d.deviceType === 'ventilator') a.devVent += d.count; else if (d.deviceType === 'urinary_catheter') a.devCath += d.count; else if (d.deviceType === 'central_line') a.devLine += d.count;
  }
  for (const o of ot) { const a = at(o.plannedStart); if (a) a.surgeries += 1; }
  for (const d of disch) { const a = at(d.dischargeDate); if (!a) continue; a.disch += 1; if (EXPIRED_DISCHARGE_TYPES.includes(d.dischargeType)) a.expired += 1; }
  for (const l of lama) { const a = at(l.lamaTime); if (a) a.lamaDama += 1; }
  for (const d of dama) { const a = at(d.dischargeTime); if (a) a.lamaDama += 1; }
  for (const k of keys) acc.get(k)!.pd = patientDays(stays, monthStart(k), monthEnd(k));

  const measures: TrendMeasure[] = MEASURES.map((m) => {
    const points = complete.map((k) => { const a = acc.get(k)!; return { period: k, value: m.value(a), n: m.n(a) }; });
    // Months before the measure ever had data are "not in use yet", not zero —
    // otherwise go-live itself reads as a shift.
    for (const p of points) { if (p.value === null || p.value === 0) p.value = null; else break; }
    const c = acc.get(current)!;
    const { median: med, signals, enoughData } = detectSignals(points, m.direction, m.minN);
    return {
      key: m.key, label: m.label, group: m.group, unit: m.unit, direction: m.direction, help: m.help, link: m.link,
      points, current: { period: current, value: m.value(c), n: m.n(c) }, median: med === null ? null : round1(med), signals, enoughData,
    };
  });
  return { months: complete, current, measures, generatedAt: new Date().toISOString() };
}

export const getTrends = (fresh = false) => cached('trends', fresh, () => buildTrends(new Date()));

// ─── Unit heat-map ───────────────────────────────────────────────────────

export type CellTone = 'bad' | 'warn' | 'good' | 'ok' | 'few' | 'none';
export interface HeatCell { value: number | null; n?: number; tone: CellTone; note?: string }
export interface HeatRow {
  unitId: number | null; unit: string; hasWards: boolean;
  cells: Record<string, HeatCell>;
}
export interface HeatColumn { key: string; label: string; unit: string; direction: Direction; scope: 'month' | 'now'; help: string }

export const HEAT_COLUMNS: HeatColumn[] = [
  { key: 'incidents', label: 'Incidents', unit: '', direction: 'neutral', scope: 'month', help: 'Reported in the month.' },
  { key: 'rate', label: 'per 1,000 pt-days', unit: '', direction: 'neutral', scope: 'month', help: 'Only for units mapped to wards.' },
  { key: 'serious', label: 'Serious harm', unit: '', direction: 'up_bad', scope: 'month', help: 'Major / sentinel or severe harm.' },
  { key: 'falls', label: 'Falls', unit: '', direction: 'up_bad', scope: 'month', help: '' },
  { key: 'med', label: 'Medication', unit: '', direction: 'up_bad', scope: 'month', help: '' },
  { key: 'triage', label: 'Median triage', unit: 'h', direction: 'up_bad', scope: 'month', help: 'Hours from report to triage.' },
  { key: 'complaints', label: 'Complaints', unit: '', direction: 'up_bad', scope: 'month', help: 'Raised in the month.' },
  { key: 'onTime', label: 'On time', unit: '%', direction: 'down_bad', scope: 'month', help: 'Complaints resolved in the month before their deadline.' },
  { key: 'nps', label: 'NPS', unit: '', direction: 'down_bad', scope: 'month', help: 'Surveys tagged to the unit, ward or department.' },
  { key: 'audit', label: 'Audit score', unit: '%', direction: 'down_bad', scope: 'month', help: 'Average of audits completed in the month.' },
  { key: 'open30', label: 'Open > 30 days', unit: '', direction: 'up_bad', scope: 'now', help: 'Incidents + complaints still open after 30 days (today).' },
  { key: 'overdue', label: 'Overdue now', unit: '', direction: 'up_bad', scope: 'now', help: 'Complaints past deadline + CAPA and audit actions past due (today).' },
];

interface UnitAcc {
  inc: number; serious: number; falls: number; med: number; triage: number[]; cmp: number; cmpResolved: number; cmpOnTime: number;
  npsP: number; npsD: number; npsN: number; auditSum: number; auditN: number; open30: number; overdue: number; pd: number;
}
const blankUnit = (): UnitAcc => ({ inc: 0, serious: 0, falls: 0, med: 0, triage: [], cmp: 0, cmpResolved: 0, cmpOnTime: 0, npsP: 0, npsD: 0, npsN: 0, auditSum: 0, auditN: 0, open30: 0, overdue: 0, pd: 0 });

/** Compare a unit's value with the hospital's: ≥25% worse → bad, ≥25% better → good. */
function relTone(value: number | null, ref: number | null, direction: Direction, n: number, minN: number): CellTone {
  if (value === null) return 'none';
  if (n < minN) return 'few';
  if (ref === null || direction === 'neutral') return 'ok';
  if (ref === 0) return value === 0 ? 'ok' : (direction === 'up_bad' ? 'bad' : 'good');
  const ratio = value / ref;
  if (direction === 'up_bad') return ratio >= 1.25 ? 'bad' : ratio <= 0.75 ? 'good' : 'ok';
  return ratio <= 0.75 ? 'bad' : ratio >= 1.25 ? 'good' : 'ok';
}
/** For counts across units of different sizes: well above the per-unit average (and ≥3) → warn. */
function countTone(value: number, mean: number): CellTone {
  if (value === 0) return 'ok';
  return value >= 3 && value >= mean * 1.5 ? 'warn' : 'ok';
}

async function buildHeatmap(month: string, now: Date): Promise<{ month: string; columns: HeatColumn[]; rows: HeatRow[]; hospital: HeatRow; generatedAt: string; patientDaysNote: string }> {
  const from = monthStart(month);
  const to = monthEnd(month) < now ? monthEnd(month) : now;
  const resolver = await loadUnitResolver();
  const since30 = new Date(now.getTime() - 30 * DAY);

  const [incidents, complaints, resolvedCmp, surveys, audits, openInc, openCmp, capaOver, auditOver, stays] = await Promise.all([
    prisma.incident.findMany({
      where: { reportedAt: { gte: from, lte: to }, status: { not: 'cancelled' } },
      select: { unitId: true, ward: true, department: true, admissionId: true, severity: true, severityFinal: true, harmLevel: true, harmLevelFinal: true, category: true, reportedAt: true, triagedAt: true }, take: ROW_CAP,
    }),
    prisma.complaint.findMany({ where: { raisedAt: { gte: from, lte: to } }, select: { unitId: true, department: true }, take: ROW_CAP }),
    prisma.complaint.findMany({ where: { resolvedAt: { gte: from, lte: to } }, select: { unitId: true, department: true, resolvedAt: true, slaDueAt: true }, take: ROW_CAP }),
    prisma.feedbackSurvey.findMany({ where: { respondedAt: { gte: from, lte: to }, npsScore: { not: null } }, select: { unitId: true, wardName: true, department: true, npsScore: true }, take: ROW_CAP }),
    prisma.auditRun.findMany({ where: { status: 'completed', completedAt: { gte: from, lte: to }, compliancePct: { not: null } }, select: { unitId: true, compliancePct: true }, take: ROW_CAP }),
    prisma.incident.findMany({ where: { status: { in: OPEN_INCIDENT }, reportedAt: { lt: since30 } }, select: { unitId: true, ward: true, department: true }, take: ROW_CAP }),
    prisma.complaint.findMany({ where: { status: { in: OPEN_COMPLAINT } }, select: { unitId: true, department: true, raisedAt: true, slaDueAt: true }, take: ROW_CAP }),
    prisma.incidentCapaAction.findMany({ where: { status: 'open', dueDate: { lt: now }, incident: { status: { notIn: ['closed', 'cancelled'] } } }, select: { incident: { select: { unitId: true, ward: true, department: true } } }, take: ROW_CAP }),
    prisma.auditFindingAction.findMany({ where: { status: 'open', dueDate: { lt: now } }, select: { run: { select: { unitId: true } } }, take: ROW_CAP }),
    loadStays(from, to, resolver),
  ]);

  const accs = new Map<number | null, UnitAcc>();
  for (const u of resolver.units) accs.set(u.id, blankUnit());
  const hosp = blankUnit();
  const get = (id: number | null): UnitAcc => { if (!accs.has(id)) accs.set(id, blankUnit()); return accs.get(id)!; };
  const both = (id: number | null, fn: (a: UnitAcc) => void) => { fn(get(id)); fn(hosp); };

  for (const i of incidents) {
    const id = resolver.resolve(i);
    both(id, (a) => {
      a.inc += 1;
      if (isSerious(i)) a.serious += 1;
      if (i.category === 'fall') a.falls += 1;
      if (i.category === 'medication') a.med += 1;
      if (i.triagedAt) a.triage.push((i.triagedAt.getTime() - i.reportedAt.getTime()) / 3_600_000);
    });
  }
  for (const c of complaints) both(resolver.resolve(c), (a) => { a.cmp += 1; });
  for (const c of resolvedCmp) both(resolver.resolve(c), (a) => { a.cmpResolved += 1; if (!c.slaDueAt || (c.resolvedAt && c.resolvedAt <= c.slaDueAt)) a.cmpOnTime += 1; });
  for (const s of surveys) {
    if (s.npsScore === null) continue;
    const score = s.npsScore;
    both(resolver.resolve({ unitId: s.unitId, ward: s.wardName, department: s.department }), (a) => { a.npsN += 1; if (score >= 9) a.npsP += 1; else if (score <= 6) a.npsD += 1; });
  }
  for (const r of audits) if (r.compliancePct !== null) { const pct = r.compliancePct; both(r.unitId ?? null, (a) => { a.auditSum += pct; a.auditN += 1; }); }
  for (const i of openInc) both(resolver.resolve(i), (a) => { a.open30 += 1; });
  for (const c of openCmp) {
    const id = resolver.resolve(c);
    if (c.raisedAt < since30) both(id, (a) => { a.open30 += 1; });
    if (c.slaDueAt && c.slaDueAt < now) both(id, (a) => { a.overdue += 1; });
  }
  for (const x of capaOver) both(resolver.resolve(x.incident), (a) => { a.overdue += 1; });
  for (const x of auditOver) both(x.run.unitId ?? null, (a) => { a.overdue += 1; });
  for (const [id, a] of accs) a.pd = patientDays(stays, from, to, id);
  hosp.pd = patientDays(stays, from, to);

  const nps = (a: UnitAcc) => (a.npsN ? Math.round(((a.npsP - a.npsD) / a.npsN) * 100) : null);
  const onTime = (a: UnitAcc) => per(a.cmpOnTime, a.cmpResolved, 100);
  const audit = (a: UnitAcc) => (a.auditN ? round1(a.auditSum / a.auditN) : null);
  const triage = (a: UnitAcc) => { const m = median(a.triage); return m === null ? null : round1(m); };
  const rate = (a: UnitAcc) => per(a.inc, a.pd, 1000);

  const unitAccs = [...accs.entries()].filter(([id]) => id !== null).map(([, a]) => a);
  const mean = (f: (a: UnitAcc) => number) => (unitAccs.length ? unitAccs.reduce((s, a) => s + f(a), 0) / unitAccs.length : 0);
  const means = { falls: mean((a) => a.falls), med: mean((a) => a.med), cmp: mean((a) => a.cmp), open30: mean((a) => a.open30) };

  const cellsFor = (a: UnitAcc, hasWards: boolean, isHospital: boolean): Record<string, HeatCell> => {
    const r = rate(a);
    const h = isHospital ? null : hosp;
    return {
      incidents: { value: a.inc, tone: 'ok' },
      rate: hasWards || isHospital
        ? { value: r, n: Math.round(a.pd), tone: a.pd < 30 ? (r === null ? 'none' : 'few') : 'ok', note: `${Math.round(a.pd)} patient-days` }
        : { value: null, tone: 'none', note: 'Unit not mapped to wards' },
      serious: { value: a.serious, tone: a.serious > 0 ? 'bad' : 'ok' },
      falls: { value: a.falls, tone: isHospital ? 'ok' : countTone(a.falls, means.falls) },
      med: { value: a.med, tone: isHospital ? 'ok' : countTone(a.med, means.med) },
      triage: { value: triage(a), n: a.triage.length, tone: isHospital ? 'ok' : relTone(triage(a), h && triage(h), 'up_bad', a.triage.length, 3) },
      complaints: { value: a.cmp, tone: isHospital ? 'ok' : countTone(a.cmp, means.cmp) },
      onTime: { value: onTime(a), n: a.cmpResolved, tone: isHospital ? 'ok' : relTone(onTime(a), h && onTime(h), 'down_bad', a.cmpResolved, 3) },
      nps: { value: nps(a), n: a.npsN, tone: isHospital ? 'ok' : relTone(nps(a), h && nps(h), 'down_bad', a.npsN, 10) },
      audit: { value: audit(a), n: a.auditN, tone: isHospital ? 'ok' : relTone(audit(a), h && audit(h), 'down_bad', a.auditN, 1) },
      open30: { value: a.open30, tone: isHospital ? 'ok' : (a.open30 > 0 ? countTone(a.open30, means.open30) === 'warn' ? 'bad' : 'warn' : 'ok') },
      overdue: { value: a.overdue, tone: a.overdue > 0 ? 'bad' : 'ok' },
    };
  };

  const rows: HeatRow[] = resolver.units.map((u) => ({ unitId: u.id, unit: u.name, hasWards: u.hasWards, cells: cellsFor(accs.get(u.id)!, u.hasWards, false) }));
  const none = accs.get(null);
  if (none && (none.inc || none.cmp || none.open30 || none.overdue || none.npsN || none.auditN)) {
    rows.push({ unitId: null, unit: 'Not matched to a unit', hasWards: false, cells: cellsFor(none, false, false) });
  }
  return {
    month, columns: HEAT_COLUMNS, rows,
    hospital: { unitId: null, unit: 'Whole hospital', hasWards: true, cells: cellsFor(hosp, true, true) },
    generatedAt: new Date().toISOString(),
    patientDaysNote: 'Patient-days from admission and discharge dates; a transferred patient counts against their current ward.',
  };
}

export function isMonthKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
export const getHeatmap = (month: string, fresh = false) => cached(`heat:${month}`, fresh, () => buildHeatmap(month, new Date()));

// ─── Clusters ────────────────────────────────────────────────────────────

export interface Cluster {
  kind: 'outbreak' | 'falls' | 'medication' | 'pressure' | 'complaints' | 'doctor_feedback' | 'repeat_patient';
  severity: 'bad' | 'warn';
  title: string; where: string; count: number; windowDays: number;
  firstAt: string; lastAt: string;
  refs: Array<{ ref: string; link?: { path: string; query?: Record<string, string> } }>;
  link?: { path: string; query?: Record<string, string> };
}

export const CLUSTER_RULES = {
  outbreak: { days: 14, min: 2 },
  falls: { days: 30, min: 3 },
  medication: { days: 30, min: 3 },
  pressure: { days: 30, min: 2 },
  complaints: { days: 30, min: 3 },
  doctorFeedback: { days: 30, min: 3 },
  repeatPatient: { days: 30, min: 2 },
};

function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); if (!k) continue; const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
  return m;
}

async function buildClusters(now: Date): Promise<{ clusters: Cluster[]; rules: typeof CLUSTER_RULES; generatedAt: string }> {
  const d = (days: number) => new Date(now.getTime() - days * DAY);
  const resolver = await loadUnitResolver();
  const unitName = new Map(resolver.units.map((u) => [u.id, u.name]));
  const fb = await prisma.feedbackConfig.findUnique({ where: { id: 1 }, select: { complaintMaxNps: true } }).catch(() => null);
  const lowNps = fb?.complaintMaxNps ?? 6;

  const [surv, incidents, complaints, surveys] = await Promise.all([
    prisma.qualitySurveillanceEvent.findMany({ where: { observedAt: { gte: d(CLUSTER_RULES.outbreak.days) }, organism: { not: null } }, select: { id: true, type: true, ward: true, organism: true, observedAt: true }, take: ROW_CAP }),
    prisma.incident.findMany({
      where: { reportedAt: { gte: d(30) }, status: { not: 'cancelled' } },
      select: { id: true, code: true, category: true, subCategory: true, ward: true, department: true, unitId: true, patientPrn: true, source: true, reportedAt: true }, take: ROW_CAP,
    }),
    prisma.complaint.findMany({ where: { raisedAt: { gte: d(CLUSTER_RULES.complaints.days) }, category: { not: null } }, select: { id: true, code: true, category: true, unitId: true, department: true, raisedAt: true }, take: ROW_CAP }),
    prisma.feedbackSurvey.findMany({ where: { respondedAt: { gte: d(CLUSTER_RULES.doctorFeedback.days) }, npsScore: { lte: lowNps }, doctorName: { not: null } }, select: { doctorName: true, respondedAt: true, npsScore: true }, take: ROW_CAP }),
  ]);

  const out: Cluster[] = [];
  const span = (dates: Date[]) => { const t = dates.map((x) => x.getTime()); return { firstAt: new Date(Math.min(...t)).toISOString(), lastAt: new Date(Math.max(...t)).toISOString() }; };
  const incRefs = (rows: Array<{ id: string; code: string }>) => rows.slice(0, 5).map((r) => ({ ref: r.code, link: { path: `/incidents/${r.id}` } }));
  const where = (i: { ward: string | null; department: string | null; unitId: number | null }) =>
    i.ward?.trim() || (i.unitId && unitName.get(i.unitId)) || i.department?.trim() || null;

  for (const [, rows] of groupBy(surv, (e) => (e.organism && e.ward ? `${lc(e.ward)}|${lc(e.organism)}` : null))) {
    if (rows.length < CLUSTER_RULES.outbreak.min) continue;
    out.push({
      kind: 'outbreak', severity: 'bad', title: `Possible outbreak: ${rows[0].organism}`, where: rows[0].ward!, count: rows.length,
      windowDays: CLUSTER_RULES.outbreak.days, ...span(rows.map((r) => r.observedAt)),
      refs: rows.slice(0, 5).map((r) => ({ ref: r.type })), link: { path: '/quality/infection-control' },
    });
  }

  const bunch = (kind: Cluster['kind'], rule: { days: number; min: number }, pick: (i: typeof incidents[number]) => boolean, title: string, severity: Cluster['severity'], link?: Cluster['link']) => {
    const since = d(rule.days);
    for (const [, rows] of groupBy(incidents.filter((i) => i.reportedAt >= since && pick(i)), (i) => lc(where(i)) || null)) {
      if (rows.length < rule.min) continue;
      out.push({ kind, severity, title, where: where(rows[0])!, count: rows.length, windowDays: rule.days, ...span(rows.map((r) => r.reportedAt)), refs: incRefs(rows), link });
    }
  };
  bunch('falls', CLUSTER_RULES.falls, (i) => i.category === 'fall', 'Falls bunching in one place', 'warn', { path: '/incidents', query: { category: 'fall' } });
  bunch('medication', CLUSTER_RULES.medication, (i) => i.category === 'medication', 'Medication incidents bunching in one place', 'warn', { path: '/incidents', query: { category: 'medication' } });
  bunch('pressure', CLUSTER_RULES.pressure, (i) => i.subCategory === 'pressure_injury', 'Pressure injuries in one place', 'bad');

  for (const [, rows] of groupBy(complaints, (c) => {
    const id = resolver.resolve(c);
    const place = id ? `u${id}` : lc(c.department) ? `d${lc(c.department)}` : null;
    return place && c.category ? `${place}|${c.category}` : null;
  })) {
    if (rows.length < CLUSTER_RULES.complaints.min) continue;
    const id = resolver.resolve(rows[0]);
    out.push({
      kind: 'complaints', severity: 'warn', title: `Repeat complaints: ${rows[0].category!.replace(/_/g, ' ')}`,
      where: (id && unitName.get(id)) || rows[0].department || 'Unknown', count: rows.length, windowDays: CLUSTER_RULES.complaints.days,
      ...span(rows.map((r) => r.raisedAt)), refs: rows.slice(0, 5).map((r) => ({ ref: r.code, link: { path: `/complaints/${r.id}` } })),
      link: { path: '/complaints' },
    });
  }

  for (const [, rows] of groupBy(surveys, (s) => lc(s.doctorName) || null)) {
    if (rows.length < CLUSTER_RULES.doctorFeedback.min) continue;
    out.push({
      kind: 'doctor_feedback', severity: 'warn', title: `Repeated low scores (NPS ${lowNps} or below)`, where: rows[0].doctorName!, count: rows.length,
      windowDays: CLUSTER_RULES.doctorFeedback.days, ...span(rows.map((r) => r.respondedAt as Date)), refs: [], link: { path: '/feedback/analytics' },
    });
  }

  // Same patient in several reported incidents (auto-rule incidents excluded — one late document can raise several).
  for (const [prn, rows] of groupBy(incidents.filter((i) => i.source !== 'auto-rule'), (i) => i.patientPrn?.trim() || null)) {
    if (rows.length < CLUSTER_RULES.repeatPatient.min) continue;
    out.push({
      kind: 'repeat_patient', severity: 'warn', title: 'Same patient in several incidents', where: `PRN ${prn}`, count: rows.length,
      windowDays: CLUSTER_RULES.repeatPatient.days, ...span(rows.map((r) => r.reportedAt)), refs: incRefs(rows),
    });
  }

  const rank = { bad: 0, warn: 1 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count || b.lastAt.localeCompare(a.lastAt));
  return { clusters: out, rules: CLUSTER_RULES, generatedAt: new Date().toISOString() };
}

export const getClusters = (fresh = false) => cached('clusters', fresh, () => buildClusters(new Date()));
