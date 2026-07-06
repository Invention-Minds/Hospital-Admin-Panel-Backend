// Phase 9.26 / Phase 1 — pure status evaluation for QualityIndicatorRecord.
//
// Spec mapping (NABH PDF page 64-66):
//   green    — within target
//   amber    — near breach (default: within 80–90% of the threshold)
//   red      — breach
//   critical — zero-tolerance / sentinel tier (overrides above when triggered)
//
// Direction semantics:
//   higher-is-bad   — breach when value > benchmark   (e.g. error rate)
//   lower-is-bad    — breach when value < benchmark   (e.g. compliance %)
//   target-range    — breach when value is outside [benchmark * 0.85, benchmark * 1.15]
//                     (used for OT utilisation — under-use & burn-out are both bad)
//
// Pure: no I/O, no Prisma. Easy to unit-test.

import type { QiDef, Direction, RcaRule } from './quality-indicator-catalogue';

export type Status = 'green' | 'amber' | 'red' | 'critical';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface EvaluateInput {
  value: number;
  benchmark: number | null;
  direction: Direction;
  /** % of breach threshold that triggers amber (default 80 per spec). */
  amberThresholdPct?: number;
  /** Caller-asserted critical trigger (e.g. sentinel event encoded in capture). */
  criticalTriggered?: boolean;
  /** Indicator is in the zero-tolerance tier (defaultBenchmark of 0). */
  isCriticalTier?: boolean;
}

export interface EvaluateOutput {
  status: Status;
  severity: Severity;
}

const TARGET_RANGE_TOLERANCE = 0.15; // ±15% band for target-range KPIs

/**
 * Evaluate a captured value against its indicator definition.
 * Returns null-safe defaults when benchmark is missing — status falls
 * back to 'amber' (needs review) rather than guessing.
 */
export function evaluateStatus(input: EvaluateInput): EvaluateOutput {
  const {
    value, benchmark, direction,
    amberThresholdPct = 80,
    criticalTriggered = false,
    isCriticalTier = false,
  } = input;

  // 1. Explicit critical trigger always wins.
  if (criticalTriggered) {
    return { status: 'critical', severity: 'critical' };
  }

  // 2. No benchmark — caller must review.
  if (benchmark === null || benchmark === undefined) {
    return { status: 'amber', severity: 'medium' };
  }

  // 3. Zero-tolerance tier — any nonzero value is critical when benchmark=0.
  if (isCriticalTier && benchmark === 0 && value > 0) {
    return { status: 'critical', severity: 'critical' };
  }

  const amberFactor = Math.max(0, Math.min(100, amberThresholdPct)) / 100;

  switch (direction) {
    case 'higher-is-bad': {
      // breach when value > benchmark; amber band sits just below.
      if (value > benchmark) return { status: 'red', severity: 'high' };
      const amberFloor = benchmark * amberFactor;
      if (value >= amberFloor) return { status: 'amber', severity: 'medium' };
      return { status: 'green', severity: 'low' };
    }
    case 'lower-is-bad': {
      // benchmark is a target floor (e.g. 95% compliance); breach when value < benchmark.
      if (value < benchmark) return { status: 'red', severity: 'high' };
      const amberCeil = benchmark + (100 - benchmark) * (1 - amberFactor);
      // amber when only just meeting target
      if (value <= amberCeil) return { status: 'amber', severity: 'medium' };
      return { status: 'green', severity: 'low' };
    }
    case 'target-range': {
      const lo = benchmark * (1 - TARGET_RANGE_TOLERANCE);
      const hi = benchmark * (1 + TARGET_RANGE_TOLERANCE);
      if (value < lo || value > hi) return { status: 'red', severity: 'high' };
      const innerLo = benchmark * (1 - TARGET_RANGE_TOLERANCE * amberFactor);
      const innerHi = benchmark * (1 + TARGET_RANGE_TOLERANCE * amberFactor);
      if (value < innerLo || value > innerHi) return { status: 'amber', severity: 'medium' };
      return { status: 'green', severity: 'low' };
    }
  }
}

/**
 * Apply (numerator / denominator) * multiplier per spec formula.
 * Returns NaN if denominator is 0 — caller decides how to handle.
 */
export function computeValue(numerator: number, denominator: number, multiplier: 'NA' | '100' | '1000'): number {
  if (denominator === 0) return NaN;
  const base = numerator / denominator;
  if (multiplier === 'NA') return Math.round(base * 100) / 100; // raw average (e.g. minutes)
  const m = multiplier === '100' ? 100 : 1000;
  return Math.round(base * m * 100) / 100;
}

// ─── Phase 4 — trend evaluator ───────────────────────────────────────────
//
// Compares the current record's status with the immediately preceding period
// for the same indicator. Two consecutive Red (or Critical) → trend breach.
// The caller decides whether to actually create an RCA based on the
// indicator's rcaRequiredRule (see shouldCreateRcaFromTrend below).

/** Compact carrier so the engine doesn't depend on the Prisma type. */
export interface PrevRecord { status: Status }

export function evaluateTrend(currentStatus: Status, previous: PrevRecord | null): 'red-2-consecutive' | null {
  if (!previous) return null;
  const isRedish = (s: Status) => s === 'red' || s === 'critical';
  if (isRedish(currentStatus) && isRedish(previous.status)) return 'red-2-consecutive';
  return null;
}

/** Phase 4 — only fire for the trend-class rules. */
export function shouldCreateRcaFromTrend(
  rule: RcaRule,
  trend: 'red-2-consecutive' | null,
): boolean {
  if (trend !== 'red-2-consecutive') return false;
  return rule === 'red-2-consecutive' || rule === 'outbreak-or-red-trend';
}

/**
 * Resolve the previous period string given a current 'YYYY-MM' or 'YYYY-MM-DD'.
 * Returns null if the period format isn't recognised.
 */
export function previousPeriod(period: string): string | null {
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const [, y, m] = month;
    const d = new Date(Number(y), Number(m) - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (day) {
    const [, y, m, dd] = day;
    const d = new Date(Number(y), Number(m) - 1, Number(dd) - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

// ─── Phase 3 — RCA-required decision ─────────────────────────────────────
//
// Maps an indicator's `rcaRequiredRule` + the captured `status` to a boolean
// "should we auto-create a QualityIndicatorRca row right now?". Trend-based
// rules ('red-2-consecutive', 'outbreak-or-red-trend') return false in Phase 3
// — Phase 4 adds a trend layer that calls this with a synthetic 'always' or
// directly creates the RCA after sliding-window evaluation.

export function shouldCreateRca(rule: RcaRule, status: Status): boolean {
  if (status === 'green' || status === 'amber') return false;
  switch (rule) {
    case 'always':                return true;
    case 'critical-only':         return status === 'critical';
    case 'serious-only':          return status === 'red' || status === 'critical';
    case 'red-2-consecutive':     return false; // Phase 4
    case 'outbreak-or-red-trend': return false; // Phase 4
    case 'conditional':           return false; // narrative — manual create
    case 'never':                 return false;
  }
}

/** Convenience: evaluate using a catalogue def (pulls benchmark + direction + tier from it). */
export function evaluateForDef(
  def: QiDef,
  numerator: number,
  denominator: number,
  benchmarkOverride: number | null,
  criticalTriggered = false,
): EvaluateOutput & { value: number } {
  const value = def.multiplier === 'NA' && denominator === 0
    ? numerator                 // sentinel-style "count" indicators (e.g. PSQ-029)
    : computeValue(numerator, denominator, def.multiplier);

  const benchmark = benchmarkOverride ?? def.defaultBenchmark;
  const out = evaluateStatus({
    value,
    benchmark,
    direction: def.direction,
    isCriticalTier: def.isCritical,
    criticalTriggered,
  });
  return { ...out, value };
}
