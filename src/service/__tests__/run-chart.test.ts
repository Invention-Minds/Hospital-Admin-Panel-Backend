import { detectSignals, median, RunPoint } from '../run-chart';

const series = (values: Array<number | null>, n?: number): RunPoint[] =>
  values.map((value, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}`, value, ...(n !== undefined && { n }) }));

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('detectSignals', () => {
  it('needs at least 8 usable points', () => {
    const r = detectSignals(series([1, 2, 3, 4, 5, 6, 7, null, null]), 'up_bad');
    expect(r.enoughData).toBe(false);
    expect(r.signals).toEqual([]);
  });

  it('flags a 6-month shift above the median as a concern when up is bad', () => {
    const r = detectSignals(series([2, 1, 2, 1, 2, 1, 5, 6, 5, 6, 5, 6]), 'up_bad');
    const shift = r.signals.find((s) => s.kind === 'shift');
    expect(shift).toMatchObject({ polarity: 'concern', length: 6, from: '2026-07', to: '2026-12' });
  });

  it('the same shift is an improvement when down is bad', () => {
    const r = detectSignals(series([2, 1, 2, 1, 2, 1, 5, 6, 5, 6, 5, 6]), 'down_bad');
    expect(r.signals.find((s) => s.kind === 'shift')?.polarity).toBe('improvement');
  });

  it('does not report a shift that ended before the latest point', () => {
    const r = detectSignals(series([5, 6, 5, 6, 5, 6, 1, 2, 1, 2, 1, 1]), 'up_bad');
    expect(r.signals.find((s) => s.kind === 'shift' && s.polarity === 'concern')).toBeUndefined();
  });

  it('points on the median neither break nor extend a shift', () => {
    // median 3; tail: 4,4,3,4,4,4,4 → 6 above, the 3 is skipped
    const r = detectSignals(series([1, 2, 2, 1, 2, 4, 4, 3, 4, 4, 4, 4, 3, 3]), 'up_bad');
    const shift = r.signals.find((s) => s.kind === 'shift');
    expect(shift?.length).toBe(6);
  });

  it('5 rising points is a trend; repeats are skipped', () => {
    const r = detectSignals(series([3, 3, 3, 3, 3, 3, 1, 2, 2, 3, 4, 5]), 'up_bad');
    expect(r.signals.find((s) => s.kind === 'trend')).toMatchObject({ polarity: 'concern', length: 5 });
  });

  it('4 rising points is not a trend', () => {
    const r = detectSignals(series([3, 3, 3, 3, 3, 3, 3, 3, 1, 2, 3, 4]), 'up_bad');
    expect(r.signals.find((s) => s.kind === 'trend')).toBeUndefined();
  });

  it('flags the worst month only when it beats every earlier month and has enough cases', () => {
    expect(detectSignals(series([2, 3, 2, 3, 2, 3, 2, 3, 2, 9]), 'up_bad').signals.some((s) => s.kind === 'worst')).toBe(true);
    expect(detectSignals(series([2, 3, 2, 3, 2, 3, 2, 9, 2, 9]), 'up_bad').signals.some((s) => s.kind === 'worst')).toBe(false);
    expect(detectSignals(series([2, 3, 2, 3, 2, 3, 2, 3, 2, 9], 2), 'up_bad', 5).signals.some((s) => s.kind === 'worst')).toBe(false);
    expect(detectSignals(series([9, 8, 9, 8, 9, 8, 9, 8, 9, 1]), 'down_bad').signals.some((s) => s.kind === 'worst')).toBe(true);
  });

  it('neutral measures get signals without polarity and never a "worst"', () => {
    const r = detectSignals(series([2, 1, 2, 1, 2, 1, 5, 6, 5, 6, 5, 6]), 'neutral');
    expect(r.signals.every((s) => s.polarity === 'neutral')).toBe(true);
    expect(r.signals.some((s) => s.kind === 'worst')).toBe(false);
  });

  it('a flat series has no signals', () => {
    expect(detectSignals(series([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 'up_bad').signals).toEqual([]);
  });
});
