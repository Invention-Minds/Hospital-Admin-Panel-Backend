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
