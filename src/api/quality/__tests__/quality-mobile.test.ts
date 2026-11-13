jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));
jest.mock('../../feedback/complaint.controller', () => ({ createComplaint: jest.fn() }));

import { minutesLeft } from '../quality-mobile.controller';

describe('minutesLeft', () => {
  const now = Date.UTC(2026, 10, 12, 10, 0);
  it('is positive before the deadline and negative after it', () => {
    expect(minutesLeft(new Date(now + 90 * 60000), now)).toBe(90);
    expect(minutesLeft(new Date(now - 25 * 60 * 60000), now)).toBe(-1500);
  });
  it('is null without a deadline', () => {
    expect(minutesLeft(null, now)).toBeNull();
  });
});
