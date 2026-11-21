// Run-chart signal rules (IHI / NHS "Making data count"), used by the Quality
// Trends page to tell a real change from month-to-month noise.
//
//   shift  6+ consecutive points on the same side of the median
//          (points exactly on the median neither break nor extend a run)
//   trend  5+ consecutive points all going up, or all going down
//          (a repeat of the same value neither breaks nor extends it)
//   worst  the latest point is the worst of the whole series
//
// Only runs that reach the latest point are reported — a shift that ended
// months ago is history, not news. Each signal is labelled 'concern' or
// 'improvement' from the measure's direction; 'neutral' measures (e.g.
// incident reporting, where more can mean a healthier culture) get no polarity.

export type Direction = 'up_bad' | 'down_bad' | 'neutral';
export interface RunPoint { period: string; value: number | null; n?: number }
export interface RunSignal {
  kind: 'shift' | 'trend' | 'worst';
  polarity: 'concern' | 'improvement' | 'neutral';
  from: string;
  to: string;
  length: number;
  text: string;
}

export const MIN_POINTS = 8;
export const SHIFT_LEN = 6;
export const TREND_LEN = 5;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function polarityOf(direction: Direction, goingUp: boolean): RunSignal['polarity'] {
  if (direction === 'neutral') return 'neutral';
  return (direction === 'up_bad') === goingUp ? 'concern' : 'improvement';
}

/**
 * Signals for a monthly series. `minN` — the latest point needs at least this
 * many underlying cases before it can be called the "worst" (small numbers swing).
 */
export function detectSignals(points: RunPoint[], direction: Direction, minN = 0): { median: number | null; signals: RunSignal[]; enoughData: boolean } {
  const usable = points.filter((p): p is RunPoint & { value: number } => p.value !== null && Number.isFinite(p.value));
  const med = median(usable.map((p) => p.value));
  if (usable.length < MIN_POINTS || med === null) return { median: med, signals: [], enoughData: false };

  const signals: RunSignal[] = [];
  const last = usable[usable.length - 1];

  // Shift — walk back from the latest point while on the same side of the median.
  const side = (v: number) => (v > med ? 1 : v < med ? -1 : 0);
  let runSide = 0;
  let runLen = 0;
  let runStart = last.period;
  for (let i = usable.length - 1; i >= 0; i--) {
    const s = side(usable[i].value);
    if (s === 0) continue;
    if (runSide === 0) runSide = s;
    if (s !== runSide) break;
    runLen += 1;
    runStart = usable[i].period;
  }
  if (runSide !== 0 && runLen >= SHIFT_LEN) {
    const above = runSide > 0;
    signals.push({
      kind: 'shift', polarity: polarityOf(direction, above), from: runStart, to: last.period, length: runLen,
      text: `${runLen} months in a row ${above ? 'above' : 'below'} the usual level`,
    });
  }

  // Trend — consecutive rises (or falls) ending at the latest point; repeats skipped.
  let dir = 0;
  let steps = 0;
  let trendStart = last.period;
  for (let i = usable.length - 1; i > 0; i--) {
    const d = usable[i].value - usable[i - 1].value;
    if (d === 0) { trendStart = usable[i - 1].period; continue; }
    const s = d > 0 ? 1 : -1;
    if (dir === 0) dir = s;
    if (s !== dir) break;
    steps += 1;
    trendStart = usable[i - 1].period;
  }
  const trendPoints = steps + 1;
  if (dir !== 0 && trendPoints >= TREND_LEN) {
    const up = dir > 0;
    signals.push({
      kind: 'trend', polarity: polarityOf(direction, up), from: trendStart, to: last.period, length: trendPoints,
      text: `${trendPoints} months in a row ${up ? 'rising' : 'falling'}`,
    });
  }

  // Worst month of the series (concern only; needs a real case count).
  if (direction !== 'neutral' && (last.n === undefined || last.n >= minN)) {
    const others = usable.slice(0, -1).map((p) => p.value);
    const worse = direction === 'up_bad' ? last.value > Math.max(...others) : last.value < Math.min(...others);
    if (worse) {
      signals.push({ kind: 'worst', polarity: 'concern', from: last.period, to: last.period, length: 1, text: `Worst month in ${usable.length}` });
    }
  }
  return { median: med, signals, enoughData: true };
}
