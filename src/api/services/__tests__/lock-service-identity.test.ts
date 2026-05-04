/**
 * Sprint 4b.2 — services.lockService server-identity tests.
 */

import type { Request, Response } from 'express';

const repositoryMock = {
  getServiceById: jest.fn(),
  lockService: jest.fn(),
};

jest.mock('../services.repository', () => ({
  ServiceRepository: jest.fn().mockImplementation(() => repositoryMock),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    service: {},
  })),
}));

import { lockService } from '../services.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  repositoryMock.getServiceById.mockResolvedValue({ id: 7, lockedBy: null });
  repositoryMock.lockService.mockResolvedValue({ id: 7, lockedBy: 42 });
});

describe('Sprint 4b.2 — services.lockService identity', () => {
  it('passes JWT id as userId to repository.lockService (happy)', async () => {
    const req = {
      params: { id: '7' },
      body: {},
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await lockService(req, buildRes());

    expect(repositoryMock.lockService).toHaveBeenCalledWith(7, 42);
  });

  it('impersonation: body.userId=999 ignored; JWT id wins', async () => {
    const req = {
      params: { id: '7' },
      body: { userId: 999 },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await lockService(req, buildRes());

    expect(repositoryMock.lockService).toHaveBeenCalledWith(7, 42);
    expect(repositoryMock.lockService).not.toHaveBeenCalledWith(7, 999);
  });
});
