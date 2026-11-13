jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));
jest.mock('../masters.controller', () => ({ readSettings: jest.fn() }));

import { feedMinutes } from '../meal-order.cron';
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
