/**
 * Sprint 4b.2 — estimation.lockService server-identity tests.
 *
 *   1. Happy: lockedBy stamped from JWT id.
 *   2. Impersonation: body.userId=999 ignored; JWT id used.
 */

import type { Request, Response } from 'express';

const estimationDetailsMock = {
  findUnique: jest.fn(),
  update: jest.fn(),
};
const userMock = { findUnique: jest.fn() };

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    estimationDetails: estimationDetailsMock,
    user: userMock,
  })),
}));

// ServiceRepository is newed up at module load in estimation.controller; stub it.
jest.mock('../../services/services.repository', () => ({
  ServiceRepository: jest.fn().mockImplementation(() => ({})),
}));

import { lockService } from '../estimation.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  estimationDetailsMock.findUnique.mockResolvedValue({ id: 7, lockedBy: null });
  estimationDetailsMock.update.mockResolvedValue({ id: 7, lockedBy: 42 });
  userMock.findUnique.mockResolvedValue({ username: 'someone' });
});

describe('Sprint 4b.2 — estimation.lockService identity', () => {
  it('stamps lockedBy from JWT id (happy)', async () => {
    const req = {
      params: { id: '7' },
      body: {},
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    const res = buildRes();
    await lockService(req, res);

    const args = estimationDetailsMock.update.mock.calls[0][0];
    expect(args.data.lockedBy).toBe(42);
  });

  it('impersonation: body.userId=999 ignored; JWT id wins', async () => {
    const req = {
      params: { id: '7' },
      body: { userId: 999 },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await lockService(req, buildRes());

    const args = estimationDetailsMock.update.mock.calls[0][0];
    expect(args.data.lockedBy).toBe(42);
    expect(args.data.lockedBy).not.toBe(999);
  });
});
