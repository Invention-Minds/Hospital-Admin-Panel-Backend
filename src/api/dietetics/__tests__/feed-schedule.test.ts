jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));
jest.mock('../masters.controller', () => ({ readSettings: jest.fn() }));

import { feedMinutes, parseFeedText, effectiveFeedOrder } from '../meal-order.cron';

describe('parseFeedText — what the ward writes on the census', () => {
  it.each([
    ['200ml Q2h', 200, 2],
    ['200 ml q 2 hrs', 200, 2],
    ['150ml every 3 hours', 150, 3],
    ['100ml hourly', 100, 1],
    ['200ml', 200, null],
    ['200', 200, null],
    ['', null, null],
  ])('"%s" → %s ml, Q%sH', (text, vol, q) => {
    expect(parseFeedText(text)).toEqual({ volumeMl: vol, intervalHours: q });
  });
});

describe('effectiveFeedOrder — an RT-feed diet always gets a schedule', () => {
  const base = { id: 'p', admissionId: 'a', npoFrom: null, npoUntil: null, endDate: null, feedWindowFrom: null, feedWindowUntil: null };
  it('FEED diet with only a volume → Q2H from 06:00, flagged as default', () => {
    const o = effectiveFeedOrder({ ...base, feedVolumeMl: 210, feedIntervalHours: null, feedStartTime: null, feedNotes: '200ml', diet: { kind: 'FEED' } });
    expect(o).toMatchObject({ feedIntervalHours: 2, feedStartTime: '06:00', feedVolumeMl: 210, defaulted: true });
  });
  it('FEED diet uses the interval written by the ward', () => {
    const o = effectiveFeedOrder({ ...base, feedVolumeMl: null, feedIntervalHours: null, feedStartTime: null, feedNotes: '150ml Q3h', diet: { kind: 'FEED' } });
    expect(o).toMatchObject({ feedIntervalHours: 3, feedVolumeMl: 150, defaulted: true });
  });
  it('full doctor order is used as is', () => {
    const o = effectiveFeedOrder({ ...base, feedVolumeMl: 200, feedIntervalHours: 1, feedStartTime: '08:00', feedNotes: null, diet: { kind: 'FEED' } });
    expect(o).toMatchObject({ feedIntervalHours: 1, feedStartTime: '08:00', defaulted: false });
  });
  it('an oral diet without a feed order gets no doses', () => {
    const o = effectiveFeedOrder({ ...base, feedVolumeMl: null, feedIntervalHours: null, feedStartTime: null, feedNotes: '200', diet: { kind: 'ORAL' } });
    expect(o.feedIntervalHours).toBeNull();
  });
});
import { qualityGrade } from '../dietary-care.controller';

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

describe('feedMinutes — RT feed schedule from the doctor\'s order', () => {
  it('every 2 h from 06:00, round the clock', () => {
    const t = feedMinutes({ feedIntervalHours: 2, feedStartTime: '06:00', feedWindowFrom: null, feedWindowUntil: null }).map(hhmm);
    expect(t).toEqual(['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']);
  });

  it('every 2 h inside a 06:00–22:00 window', () => {
    const t = feedMinutes({ feedIntervalHours: 2, feedStartTime: '06:00', feedWindowFrom: '06:00', feedWindowUntil: '22:00' }).map(hhmm);
    expect(t).toEqual(['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']);
  });

  it('hourly (doctor\'s suggestion) inside 08:00–12:00', () => {
    const t = feedMinutes({ feedIntervalHours: 1, feedStartTime: '08:00', feedWindowFrom: '08:00', feedWindowUntil: '12:00' }).map(hhmm);
    expect(t).toEqual(['08:00', '09:00', '10:00', '11:00', '12:00']);
  });

  it('a window that wraps midnight (22:00 → 06:00)', () => {
    const t = feedMinutes({ feedIntervalHours: 2, feedStartTime: '22:00', feedWindowFrom: '22:00', feedWindowUntil: '06:00' }).map(hhmm);
    expect(t).toEqual(['00:00', '02:00', '04:00', '06:00', '22:00']);
  });

  it('nothing without an interval or a first-feed time', () => {
    expect(feedMinutes({ feedIntervalHours: null, feedStartTime: '06:00', feedWindowFrom: null, feedWindowUntil: null })).toEqual([]);
    expect(feedMinutes({ feedIntervalHours: 2, feedStartTime: null, feedWindowFrom: null, feedWindowUntil: null })).toEqual([]);
  });
});

describe('qualityGrade — total out of 50', () => {
  it('maps totals to grades', () => {
    expect(qualityGrade(50)).toBe('Excellent');
    expect(qualityGrade(45)).toBe('Excellent');
    expect(qualityGrade(40)).toBe('Very good');
    expect(qualityGrade(30)).toBe('Satisfactory');
    expect(qualityGrade(20)).toBe('Poor');
    expect(qualityGrade(10)).toBe('Unacceptable');
  });
});
