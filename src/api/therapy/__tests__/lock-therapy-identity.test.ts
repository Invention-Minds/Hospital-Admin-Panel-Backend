/**
 * Sprint 4b.2 — therapy.lockTherapyAppointment server-identity tests.
 */

import type { Request, Response } from 'express';

const therapyAppointmentMock = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    therapyAppointment: therapyAppointmentMock,
  })),
}));

import { lockTherapyAppointment } from '../therapy.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  therapyAppointmentMock.findUnique.mockResolvedValue({ id: 7, lockedBy: null });
  therapyAppointmentMock.update.mockResolvedValue({ id: 7, lockedBy: 42 });
});

describe('Sprint 4b.2 — therapy.lockTherapyAppointment identity', () => {
  it('stamps lockedBy from JWT id (happy)', async () => {
    const req = {
      params: { id: '7' },
      body: {},
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await lockTherapyAppointment(req, buildRes());

    const args = therapyAppointmentMock.update.mock.calls[0][0];
    expect(args.data.lockedBy).toBe(42);
  });

  it('impersonation: body.userId=999 ignored; JWT id wins', async () => {
    const req = {
      params: { id: '7' },
      body: { userId: 999 },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await lockTherapyAppointment(req, buildRes());

    const args = therapyAppointmentMock.update.mock.calls[0][0];
    expect(args.data.lockedBy).toBe(42);
    expect(args.data.lockedBy).not.toBe(999);
  });
});
