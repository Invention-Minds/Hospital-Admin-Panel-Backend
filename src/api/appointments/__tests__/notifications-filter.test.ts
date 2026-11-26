/**
 * GET /api/appointments/notifications — the bell list every open browser
 * re-downloads. Expired rows are skipped and the four routine reception types
 * are limited to the last ROUTINE_NOTIFICATION_DAYS (default 7); every other
 * type keeps its full history.
 */

import type { Request, Response } from 'express';

const findMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({ notification: { findMany } })),
  AppointmentStatus: { pending: 'pending', completed: 'completed', confirmed: 'confirmed', cancelled: 'cancelled' },
}));
jest.mock('../appointment.resolver', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../appointment.repository', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../doctor/doctor.repository', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../whatsapp/whatsapp.controller', () => ({ sendConfirmedWhatsApp: jest.fn() }));
jest.mock('../../sms/sms.controller', () => ({ sendConfirmedSMS: jest.fn() }));
jest.mock('../../../index', () => ({ notifyPendingAppointments: jest.fn() }), { virtual: true });
jest.mock('../../../service/appointment-event', () => ({
  recordAppointmentEvent: jest.fn(), classifyAppointmentChange: jest.fn(),
  slotSnapshot: jest.fn().mockReturnValue({}), subjectSnapshot: jest.fn().mockReturnValue({}),
}));

import { getAllNotifications } from '../appointment.controller';

const NOW = new Date('2026-11-24T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const run = async () => {
  const res: any = {};
  res.status = jest.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn().mockImplementation((b: unknown) => { res.body = b; return res; });
  await getAllNotifications({} as Request, res as Response);
  return res as { statusCode: number; body: any };
};

beforeAll(() => jest.useFakeTimers({ now: NOW }));
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([{ id: 1 }]);
  delete process.env.ROUTINE_NOTIFICATION_DAYS;
});

describe('GET /api/appointments/notifications', () => {
  it('skips expired rows and limits only the routine types to the last 7 days by default', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 1 }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gte: NOW } }] },
          {
            OR: [
              { type: { notIn: ['service_request', 'appointment_remainder', 'appointment_request', 'service_reminder'] } },
              { createdAt: { gte: new Date(NOW.getTime() - 7 * DAY) } },
            ],
          },
        ],
      },
    });
  });

  it('uses ROUTINE_NOTIFICATION_DAYS when set', async () => {
    process.env.ROUTINE_NOTIFICATION_DAYS = '30';
    await run();
    const routine = findMany.mock.calls[0][0].where.AND[1].OR[1];
    expect(routine).toEqual({ createdAt: { gte: new Date(NOW.getTime() - 30 * DAY) } });
  });

  it('falls back to 7 days for an invalid setting', async () => {
    process.env.ROUTINE_NOTIFICATION_DAYS = 'abc';
    await run();
    const routine = findMany.mock.calls[0][0].where.AND[1].OR[1];
    expect(routine).toEqual({ createdAt: { gte: new Date(NOW.getTime() - 7 * DAY) } });
  });

  it('returns 500 when the query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    const res = await run();
    expect(res.statusCode).toBe(500);
  });
});
