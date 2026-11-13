jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));
jest.mock('../../../service/app-audit', () => ({ auditLog: jest.fn() }));
jest.mock('../../../config/openai', () => ({ openai: {} }));

import { waitingMinutes } from '../doctor-queries-mobile.controller';

const at = (minAgo: number, now: number) => new Date(now - minAgo * 60000);

describe('waitingMinutes', () => {
  const now = Date.UTC(2026, 10, 12, 10, 0);

  it('counts from the first unanswered patient message', () => {
    const msgs = [
      { direction: 'IN', created_at: at(300, now) },
      { direction: 'OUT', created_at: at(240, now) },
      { direction: 'IN', created_at: at(150, now) },
      { direction: 'IN', created_at: at(20, now) },
    ];
    expect(waitingMinutes(msgs, now)).toBe(150);
  });

  it('is null when the doctor spoke last or there are no messages', () => {
    expect(waitingMinutes([{ direction: 'IN', created_at: at(90, now) }, { direction: 'OUT', created_at: at(5, now) }], now)).toBeNull();
    expect(waitingMinutes([], now)).toBeNull();
  });

  it('handles a single patient message', () => {
    expect(waitingMinutes([{ direction: 'IN', created_at: at(45, now) }], now)).toBe(45);
  });
});
