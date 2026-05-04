/**
 * Sprint 4b.2 — history-notes server-identity tests (mirrors doctor-notes).
 *
 *   1. createDoctorNote (history-notes variant): JWT stamps, body-supplied attribution stripped.
 *   2. updateDoctorNoteByPRNAndDate: impersonation attempt ignored.
 */

import type { Request, Response } from 'express';

const historyNotesMock = {
  create: jest.fn(),
  update: jest.fn(),
  findFirst: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    historyNotes: historyNotesMock,
  })),
}));

import { createDoctorNote, updateDoctorNoteByPRNAndDate } from '../history-notes.controller';

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
  historyNotesMock.create.mockResolvedValue({ id: 1 });
  historyNotesMock.update.mockResolvedValue({ id: 1 });
  historyNotesMock.findFirst.mockResolvedValue(null);
});

describe('Sprint 4b.2 — history-notes identity', () => {
  it('createDoctorNote stamps createdBy+updatedBy from JWT and strips body-supplied attribution', async () => {
    const req = buildReq({
      prn: 9900001,
      date: '2026-04-21',
      medicalHistory: 'hypertension',
      createdBy: 'attacker',
      updatedBy: 'attacker',
    });
    await createDoctorNote(req, buildRes());

    const args = historyNotesMock.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      prn: 9900001,
      medicalHistory: 'hypertension',
      createdBy: 'alice',
      updatedBy: 'alice',
    }));
    expect(args.data.createdBy).not.toBe('attacker');
  });

  it('updateDoctorNoteByPRNAndDate body-leak closed — JWT identity wins', async () => {
    historyNotesMock.findFirst.mockResolvedValue({ id: 7, prn: 9900001, date: '2026-04-21' });

    const req = buildReq(
      { medicalHistory: 'revised', updatedBy: 'attacker' },
      { date: '2026-04-21' },
      { prn: '9900001' }
    );
    await updateDoctorNoteByPRNAndDate(req, buildRes());

    const args = historyNotesMock.update.mock.calls[0][0];
    expect(args.data.updatedBy).toBe('alice');
    expect(args.data.updatedBy).not.toBe('attacker');
  });
});
