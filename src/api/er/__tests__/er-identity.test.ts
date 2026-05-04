/**
 * Sprint 4b.2 — ER assessment server-identity tests.
 *
 *   1. createERAssessment: stamps createdBy from JWT (Int); body-supplied createdBy stripped.
 *   2. updateERAssessment: body-supplied createdBy stripped (ER has no updatedBy column).
 */

import type { Request, Response } from 'express';

const eRAssessmentMock = {
  create: jest.fn(),
  update: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    eRAssessment: eRAssessmentMock,
  })),
}));

import { createERAssessment, updateERAssessment } from '../er.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (body: Record<string, unknown>, params: Record<string, string> = {}): Request =>
  ({
    body,
    params,
    user: { id: 42, username: 'alice' },
  }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  eRAssessmentMock.create.mockResolvedValue({ id: 1 });
  eRAssessmentMock.update.mockResolvedValue({ id: 1 });
});

describe('Sprint 4b.2 — ER assessment identity', () => {
  it('createERAssessment stamps createdBy=42 (Int from JWT) and strips body-supplied attribution', async () => {
    const req = buildReq({
      name: 'Test patient',
      age: '50',
      createdBy: 999, // impersonation — attacker tries to claim id 999
    });
    await createERAssessment(req, buildRes());

    const args = eRAssessmentMock.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe(42);
    expect(args.data.createdBy).not.toBe(999);
  });

  it('updateERAssessment strips body-supplied createdBy', async () => {
    const req = buildReq(
      { disposition: 'discharged', createdBy: 999 },
      { id: '7' }
    );
    await updateERAssessment(req, buildRes());

    const args = eRAssessmentMock.update.mock.calls[0][0];
    expect(args.data.createdBy).toBeUndefined();
    expect(args.data.disposition).toBe('discharged');
  });
});
