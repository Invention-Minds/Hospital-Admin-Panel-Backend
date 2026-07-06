// Phase 9.13 — NEWS2 (National Early Warning Score 2) scoring.
//
// Pure functions, no DB. The NEWS2 algorithm is the RCP UK 2017 standard:
// seven parameters, each scored 0–3, summed to a 0–20 aggregate, then
// banded. Used by the Treatment Dashboard to rank inpatient acuity.
//
// Reference: Royal College of Physicians, "National Early Warning Score
// (NEWS) 2", 2017. Scale-1 SpO2 only (we do not implement the Scale-2
// hypercapnic-respiratory-failure variant — that needs a per-patient flag
// the system does not capture today).

export type AcvpuLevel = 'A' | 'C' | 'V' | 'P' | 'U';
export type Ews2Band = 'low' | 'low-medium' | 'medium' | 'high';

export interface News2Inputs {
  respirationRate?: number | null; // breaths / min
  spo2?: number | null;            // %
  onOxygen?: boolean | null;       // supplemental O2 → +2
  temperatureC?: number | null;    // °C
  systolicBp?: number | null;      // mmHg
  pulse?: number | null;           // bpm
  consciousness?: AcvpuLevel | null; // ACVPU — anything but 'A' → 3
}

export interface News2ComponentScores {
  respirationRate: number | null;
  spo2: number | null;
  oxygen: number | null;
  temperature: number | null;
  systolicBp: number | null;
  pulse: number | null;
  consciousness: number | null;
}

export interface News2Result {
  score: number;            // aggregate 0..20 of the params that were present
  band: Ews2Band;
  components: News2ComponentScores;
  // How many of the 7 params had data — surfaces "incomplete vitals" in UI.
  parametersScored: number;
  // True when any single parameter scored 3 (NEWS2 "red score" rule).
  hasRedComponent: boolean;
  // Human-readable response per the RCP escalation table.
  responseLabel: string;
}

// ─── Per-parameter scoring tables ───────────────────────────────────────

const scoreRespiration = (rr: number): number => {
  if (rr <= 8) return 3;
  if (rr <= 11) return 1;
  if (rr <= 20) return 0;
  if (rr <= 24) return 2;
  return 3;
};

const scoreSpo2 = (spo2: number): number => {
  if (spo2 <= 91) return 3;
  if (spo2 <= 93) return 2;
  if (spo2 <= 95) return 1;
  return 0;
};

const scoreTemperature = (t: number): number => {
  if (t <= 35.0) return 3;
  if (t <= 36.0) return 1;
  if (t <= 38.0) return 0;
  if (t <= 39.0) return 1;
  return 2;
};

const scoreSystolic = (sbp: number): number => {
  if (sbp <= 90) return 3;
  if (sbp <= 100) return 2;
  if (sbp <= 110) return 1;
  if (sbp <= 219) return 0;
  return 3;
};

const scorePulse = (hr: number): number => {
  if (hr <= 40) return 3;
  if (hr <= 50) return 1;
  if (hr <= 90) return 0;
  if (hr <= 110) return 1;
  if (hr <= 130) return 2;
  return 3;
};

const bandFor = (score: number, hasRed: boolean): Ews2Band => {
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  if (hasRed) return 'low-medium'; // 0–4 total but a single param = 3
  return 'low';
};

const responseFor = (band: Ews2Band): string => {
  switch (band) {
    case 'high':       return 'Emergency — continuous monitoring, urgent critical-care review';
    case 'medium':     return 'Urgent review by ward doctor / registrar; 1-hourly monitoring';
    case 'low-medium': return 'Urgent review by a clinician; assess if higher monitoring needed';
    default:           return 'Routine — continue 4–12 hourly monitoring';
  }
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Compute a NEWS2 score from whatever parameters are available. Missing
 * parameters are skipped (their component score is null) — the aggregate
 * is the sum of the parameters that WERE present. `parametersScored`
 * tells the caller how complete the picture is.
 */
export function computeNews2(input: News2Inputs): News2Result {
  const components: News2ComponentScores = {
    respirationRate: isNum(input.respirationRate) ? scoreRespiration(input.respirationRate) : null,
    spo2: isNum(input.spo2) ? scoreSpo2(input.spo2) : null,
    oxygen: input.onOxygen === true ? 2 : input.onOxygen === false ? 0 : null,
    temperature: isNum(input.temperatureC) ? scoreTemperature(input.temperatureC) : null,
    systolicBp: isNum(input.systolicBp) ? scoreSystolic(input.systolicBp) : null,
    pulse: isNum(input.pulse) ? scorePulse(input.pulse) : null,
    consciousness: input.consciousness
      ? (input.consciousness === 'A' ? 0 : 3)
      : null,
  };

  const present = Object.values(components).filter((v): v is number => v !== null);
  const score = present.reduce((a, b) => a + b, 0);
  const hasRedComponent = present.some((v) => v === 3);
  const band = bandFor(score, hasRedComponent);

  return {
    score,
    band,
    components,
    parametersScored: present.length,
    hasRedComponent,
    responseLabel: responseFor(band),
  };
}

/**
 * Map an ICU Glasgow Coma Scale (3–15) to an ACVPU consciousness level so
 * ICU vitals (which capture GCS, not ACVPU) can feed the same scorer.
 * GCS 15 → Alert; 13–14 → Confusion; 9–12 → responds to Voice;
 * 4–8 → responds to Pain; 3 → Unresponsive.
 */
export function gcsToAcvpu(gcs: number | null | undefined): AcvpuLevel | null {
  if (!isNum(gcs)) return null;
  if (gcs >= 15) return 'A';
  if (gcs >= 13) return 'C';
  if (gcs >= 9) return 'V';
  if (gcs >= 4) return 'P';
  return 'U';
}

/** Trend label by comparing a new score to the previous one. */
export function trendOf(current: number, previous: number | null | undefined): 'improving' | 'stable' | 'worsening' {
  if (previous == null) return 'stable';
  if (current > previous) return 'worsening';
  if (current < previous) return 'improving';
  return 'stable';
}
