/**
 * Sprint 4b.2 — doctor-notes server-identity tests.
 *
 *   1. createDoctorNote: happy path — createdBy + updatedBy from JWT; body's createdBy stripped.
 *   2. updateDoctorNoteByPRNAndDate: impersonation attempt in body ignored; JWT wins.
 */

import type { Request, Response } from 'express';

const doctorNoteMock = {
  create: jest.fn(),
  update: jest.fn(),
  findFirst: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    doctorNote: doctorNoteMock,
  })),
}));

import { createDoctorNote, updateDoctorNoteByPRNAndDate } from '../doctor-notes.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (body: Record<string, unknown>, query: Record<string, string> = {}, params: Record<string, string> = {}): Request =>
  ({
    body,
    query,
    params,
    user: { id: 42, username: 'alice' },
  }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  doctorNoteMock.create.mockResolvedValue({ id: 1 });
  doctorNoteMock.update.mockResolvedValue({ id: 1 });
  doctorNoteMock.findFirst.mockResolvedValue(null);
});

describe('Sprint 4b.2 — doctor-notes identity', () => {
  it('createDoctorNote stamps createdBy+updatedBy from JWT and strips body-supplied createdBy', async () => {
    const req = buildReq({
      prn: 9900001,
      date: '2026-04-21',
      chiefComplaints: 'headache',
      // Impersonation attempts:
      createdBy: 'attacker',
      updatedBy: 'attacker',
      createdById: 999,
    });
    await createDoctorNote(req, buildRes());

    const args = doctorNoteMock.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      prn: 9900001,
      chiefComplaints: 'headache',
      createdBy: 'alice',
      updatedBy: 'alice',
    }));
    expect(args.data.createdBy).not.toBe('attacker');
    expect(args.data.updatedBy).not.toBe('attacker');
    expect(args.data.createdById).toBeUndefined();
  });

  it('updateDoctorNoteByPRNAndDate body-leak closed — JWT identity wins', async () => {
    doctorNoteMock.findFirst.mockResolvedValue({ id: 7, prn: 9900001, date: '2026-04-21' });

    const req = buildReq(
      {
        chiefComplaints: 'fever',
        updatedBy: 'attacker',
        createdBy: 'attacker',
      },
      { date: '2026-04-21' },
      { prn: '9900001' }
    );
    await updateDoctorNoteByPRNAndDate(req, buildRes());

    const args = doctorNoteMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
    }));
    expect(args.data.updatedBy).not.toBe('attacker');
    expect(args.data.createdBy).toBeUndefined();
  });
});
