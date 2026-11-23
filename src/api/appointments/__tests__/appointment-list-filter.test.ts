/**
 * GET /api/appointments filters. Unfiltered, the endpoint returned every
 * appointment (~330 MB); screens now send fromDate/toDate, isCloseOPD,
 * doctorId or fields=lean. No parameters must keep the old behaviour.
 */

import type { Request, Response } from 'express';

const getAppointments = jest.fn();
const getAppointmentsFiltered = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({})),
  AppointmentStatus: { pending: 'pending', completed: 'completed', confirmed: 'confirmed', cancelled: 'cancelled' },
}));
jest.mock('../appointment.resolver', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ getAppointments, getAppointmentsFiltered })),
}));
jest.mock('../appointment.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../doctor/doctor.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../whatsapp/whatsapp.controller', () => ({ sendConfirmedWhatsApp: jest.fn() }));
jest.mock('../../sms/sms.controller', () => ({ sendConfirmedSMS: jest.fn() }));
jest.mock('../../../index', () => ({ notifyPendingAppointments: jest.fn() }), { virtual: true });
jest.mock('../../../service/appointment-event', () => ({
  recordAppointmentEvent: jest.fn(), classifyAppointmentChange: jest.fn(),
  slotSnapshot: jest.fn().mockReturnValue({}), subjectSnapshot: jest.fn().mockReturnValue({}),
}));

import { getAppointments as handler } from '../appointment.controller';

const run = async (query: Record<string, string>) => {
  const res: any = {};
  res.status = jest.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn().mockImplementation((b: unknown) => { res.body = b; return res; });
  await handler({ query } as unknown as Request, res as Response);
  return res as { statusCode: number; body: any };
};

beforeEach(() => {
  jest.clearAllMocks();
  getAppointments.mockResolvedValue(['all']);
  getAppointmentsFiltered.mockResolvedValue(['filtered']);
});

describe('GET /api/appointments filters', () => {
  it('no parameters → unchanged full list', async () => {
    const res = await run({});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(['all']);
    expect(getAppointmentsFiltered).not.toHaveBeenCalled();
  });

  it('date range matches appointment date OR created_at within the IST days', async () => {
    const res = await run({ fromDate: '2026-11-01', toDate: '2026-11-07' });
    expect(res.statusCode).toBe(200);
    expect(getAppointments).not.toHaveBeenCalled();
    expect(getAppointmentsFiltered).toHaveBeenCalledWith({
      AND: [{
        OR: [
          { date: { gte: '2026-11-01', lte: '2026-11-07' } },
          { date: { gte: '2026-10-31T18:30:00.000Z', lte: '2026-11-07T18:29:59.999Z' } },
          { created_at: {
            gte: new Date('2026-10-31T18:30:00.000Z'), // 1 Nov 00:00 IST
            lte: new Date('2026-11-07T18:29:59.999Z'), // 7 Nov 23:59:59.999 IST
          } },
        ],
      }],
    }, false);
  });

  it('a single date (fromDate only) covers that one day', async () => {
    await run({ fromDate: '2026-11-23' });
    const where = getAppointmentsFiltered.mock.calls[0][0];
    expect(where.AND[0].OR[0]).toEqual({ date: { gte: '2026-11-23', lte: '2026-11-23' } });
  });

  it('matches legacy ISO-timestamp dates by their IST day, exactly like the old browser filter', async () => {
    // The text comparisons MySQL would run, applied to the real legacy values.
    const inRange = (date: string, fromDate: string, toDate: string) => {
      getAppointmentsFiltered.mockClear();
      return run({ fromDate, toDate }).then(() => {
        const ors = getAppointmentsFiltered.mock.calls[0][0].AND[0].OR;
        return ors.slice(0, 2).some((c: any) => date >= c.date.gte && date <= c.date.lte);
      });
    };
    // 18:30Z = midnight IST of the NEXT day.
    expect(await inRange('2026-09-11T18:30:00.000Z', '2026-09-12', '2026-09-12')).toBe(true);
    expect(await inRange('2026-09-11T18:30:00.000Z', '2026-09-11', '2026-09-11')).toBe(false);
    // 00:00Z = 05:30 IST the same day; also the last day of a range.
    expect(await inRange('2026-09-10T00:00:00.000Z', '2026-09-10', '2026-09-10')).toBe(true);
    expect(await inRange('2026-09-10T00:00:00.000Z', '2026-09-01', '2026-09-10')).toBe(true);
    expect(await inRange('2026-09-10T00:00:00.000Z', '2026-09-11', '2026-09-15')).toBe(false);
    // Plain dates are unaffected by the extra clause.
    expect(await inRange('2026-09-10', '2026-09-10', '2026-09-10')).toBe(true);
    expect(await inRange('2026-09-09', '2026-09-10', '2026-09-12')).toBe(false);
    expect(await inRange('2026-09-13', '2026-09-10', '2026-09-12')).toBe(false);
  });

  it('isCloseOPD and doctorId combine; fields=lean is passed through', async () => {
    await run({ isCloseOPD: 'true', doctorId: '7', fields: 'lean' });
    expect(getAppointmentsFiltered).toHaveBeenCalledWith({ AND: [{ isCloseOPD: true }, { doctorId: 7 }] }, true);
  });

  it('fields=lean alone (all-time waiting-time report) filters nothing but trims columns', async () => {
    await run({ fields: 'lean' });
    expect(getAppointmentsFiltered).toHaveBeenCalledWith({}, true);
  });

  it.each([
    [{ fromDate: '23-11-2026' }, 'fromDate/toDate must be YYYY-MM-DD'],
    [{ fromDate: '2026-11-08', toDate: '2026-11-01' }, 'fromDate must not be after toDate'],
    [{ isCloseOPD: 'yes' }, 'isCloseOPD must be true or false'],
    [{ doctorId: 'abc' }, 'doctorId must be a number'],
  ])('rejects bad input %j with 400', async (query, error) => {
    const res = await run(query as Record<string, string>);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error });
    expect(getAppointments).not.toHaveBeenCalled();
    expect(getAppointmentsFiltered).not.toHaveBeenCalled();
  });
});
