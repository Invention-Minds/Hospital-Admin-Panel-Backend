import prisma from './prisma-client';

// Complaint types + resolution deadlines (eFeedor: TAT per department and
// parameter). A ComplaintSlaRule row sets the hours for any combination of
// unit × type × severity (null = any). The most specific matching rule wins;
// with no match the built-in hours by severity apply, so nothing changes until
// the Quality Manager adds rules.

export const COMPLAINT_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'doctor_care', label: 'Doctor care' },
  { key: 'nursing_care', label: 'Nursing care' },
  { key: 'staff_behaviour', label: 'Staff behaviour' },
  { key: 'billing', label: 'Billing' },
  { key: 'waiting_time', label: 'Waiting time' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'food', label: 'Food' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'communication', label: 'Communication' },
  { key: 'discharge', label: 'Discharge process' },
  { key: 'other', label: 'Other' },
];
const CATEGORY_KEYS = new Set(COMPLAINT_CATEGORIES.map((c) => c.key));
export const isComplaintCategory = (v: unknown): v is string => typeof v === 'string' && CATEGORY_KEYS.has(v);
export const categoryLabel = (k: string | null | undefined): string | null =>
  k ? COMPLAINT_CATEGORIES.find((c) => c.key === k)?.label ?? k : null;

export const SEVERITIES = ['low', 'medium', 'high'] as const;
export const DEFAULT_SLA_HOURS: Record<string, number> = { high: 24, medium: 72, low: 168 };

/** Survey question key → complaint type (the patient's lowest-rated question). */
const RATING_TO_CATEGORY: Record<string, string> = {
  doctor: 'doctor_care', nursing: 'nursing_care', staff: 'staff_behaviour', waitingTime: 'waiting_time',
  billing: 'billing', food: 'food', cleanliness: 'cleanliness', facilities: 'facilities',
};

/** Type for a survey-raised complaint: its lowest 1–2★ question, else null. */
export function categoryFromRatings(scores: Record<string, number> | null | undefined): string | null {
  if (!scores) return null;
  let worst: { key: string; score: number } | null = null;
  for (const [k, s] of Object.entries(scores)) {
    if (!RATING_TO_CATEGORY[k] || typeof s !== 'number') continue;
    if (!worst || s < worst.score) worst = { key: k, score: s };
  }
  return worst && worst.score <= 2 ? RATING_TO_CATEGORY[worst.key] : null;
}

export interface SlaResolution {
  hours: number;
  ruleId: number | null; // null = built-in default
  label: string;         // e.g. "Pharmacy · Billing · high" or "Default (high)"
}

type Rule = { id: number; unitId: number | null; category: string | null; severity: string | null; hours: number };

/** Specificity: unit beats type beats severity (weights 4 / 2 / 1). */
function score(r: Rule): number {
  return (r.unitId != null ? 4 : 0) + (r.category != null ? 2 : 0) + (r.severity != null ? 1 : 0);
}

export function pickRule(rules: Rule[], c: { unitId: number | null; category: string | null; severity: string }): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (r.unitId != null && r.unitId !== c.unitId) continue;
    if (r.category != null && r.category !== c.category) continue;
    if (r.severity != null && r.severity !== c.severity) continue;
    if (!best || score(r) > score(best)) best = r;
  }
  return best;
}

export async function resolveComplaintSla(c: { unitId: number | null; category: string | null; severity: string }): Promise<SlaResolution> {
  const rules = await prisma.complaintSlaRule.findMany({ select: { id: true, unitId: true, category: true, severity: true, hours: true } });
  const r = pickRule(rules, c);
  if (!r) return { hours: DEFAULT_SLA_HOURS[c.severity] ?? 72, ruleId: null, label: `Default (${c.severity})` };
  let unitName: string | null = null;
  if (r.unitId != null) unitName = (await prisma.hospitalUnit.findUnique({ where: { id: r.unitId }, select: { name: true } }))?.name ?? `Unit ${r.unitId}`;
  const parts = [unitName ?? 'Any unit', categoryLabel(r.category) ?? 'any type', r.severity ?? 'any severity'];
  return { hours: r.hours, ruleId: r.id, label: parts.join(' · ') };
}

/** Deadline = base + hours from the matching rule. */
export async function complaintDueAt(base: Date, c: { unitId: number | null; category: string | null; severity: string }): Promise<Date> {
  const { hours } = await resolveComplaintSla(c);
  return new Date(base.getTime() + hours * 3_600_000);
}
