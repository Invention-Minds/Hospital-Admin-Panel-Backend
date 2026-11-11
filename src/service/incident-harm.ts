// Harm-based incident severity + CAPA effectiveness schedule.
//
// The reporter answers "did it reach the patient / what harm was caused" and
// the severity bucket is derived from that, so everything downstream that
// keys off Incident.severity / severityFinal (escalation matrix, QI auto-
// source, dashboards) keeps working unchanged.

export const HARM_LEVELS = ['not_reached', 'none', 'mild', 'moderate', 'severe', 'permanent_or_death'] as const;
export type HarmLevel = (typeof HARM_LEVELS)[number];

export const isHarmLevel = (v: unknown): v is HarmLevel =>
  typeof v === 'string' && (HARM_LEVELS as readonly string[]).includes(v);

const HARM_TO_SEVERITY: Record<HarmLevel, string> = {
  not_reached: 'near_miss',
  none: 'minor',
  mild: 'minor',
  moderate: 'moderate',
  severe: 'major',
  permanent_or_death: 'sentinel',
};

export const severityFromHarm = (harm: HarmLevel): string => HARM_TO_SEVERITY[harm];

/** Days after closure at which effectiveness is checked, by effective severity. */
export function effectivenessScheduleDays(severity: string): number[] {
  return ['moderate', 'major', 'sentinel'].includes(severity) ? [30, 60, 90] : [30];
}

/** A check can be recorded from this many days before it falls due. */
export const REVIEW_EARLY_WINDOW_DAYS = 7;

export const CAPA_ACTION_KINDS = ['corrective', 'preventive'] as const;
export const CAPA_ACTION_STATUSES = ['open', 'done', 'dropped'] as const;
export const EFFECTIVENESS_OUTCOMES = ['effective', 'partial', 'not_effective'] as const;
