jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));
jest.mock('../../../service/app-audit', () => ({ auditLog: jest.fn() }));

import { rangeFlag } from '../doctor-reports-mobile.controller';

describe('rangeFlag', () => {
  it('flags against a between range', () => {
    expect(rangeFlag('15.2', '4.0-11.0')).toBe('H');
    expect(rangeFlag('3.1', '4.0 - 11.0')).toBe('L');
    expect(rangeFlag('7', '4.0–11.0')).toBeNull();
    expect(rangeFlag('11', '4 to 11')).toBeNull();
    expect(rangeFlag('1,50,000', '150000-450000')).toBeNull();
  });

  it('flags against one-sided ranges', () => {
    expect(rangeFlag('240', '<200')).toBe('H');
    expect(rangeFlag('180', '< 200')).toBeNull();
    expect(rangeFlag('35', '>40')).toBe('L');
    expect(rangeFlag('5.9', 'Up to 5.7')).toBe('H');
  });

  it('stays quiet when the values are not numeric', () => {
    expect(rangeFlag('Positive', 'Negative')).toBeNull();
    expect(rangeFlag('', '4-11')).toBeNull();
    expect(rangeFlag('12', null)).toBeNull();
    expect(rangeFlag(null, '4-11')).toBeNull();
  });
});

import { encounterOf } from '../doctor-reports-mobile.controller';

describe('encounterOf (OPD vs IPD)', () => {
  const spans = [
    { prn: '100', from: new Date('2026-11-01T10:00:00Z'), to: new Date('2026-11-05T12:00:00Z') },
    { prn: '200', from: new Date('2026-11-10T08:00:00Z'), to: null },
  ];
  it('is IPD when ordered during an admission', () => {
    expect(encounterOf(spans, '100', new Date('2026-11-03T09:00:00Z'))).toBe('IPD');
    expect(encounterOf(spans, '200', new Date('2026-11-12T09:00:00Z'))).toBe('IPD');
  });
  it('is OPD before admission, after discharge, or for another patient', () => {
    expect(encounterOf(spans, '100', new Date('2026-10-30T09:00:00Z'))).toBe('OPD');
    expect(encounterOf(spans, '100', new Date('2026-11-06T09:00:00Z'))).toBe('OPD');
    expect(encounterOf(spans, '300', new Date('2026-11-03T09:00:00Z'))).toBe('OPD');
  });
});
