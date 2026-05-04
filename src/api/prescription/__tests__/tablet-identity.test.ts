/**
 * Sprint 4b.2 — TabletMaster createdBy server-identity test.
 *
 *   1. createTablet: createdBy is req.user.username from JWT; body-supplied doctorId ignored.
 */

import type { Request, Response } from 'express';

const tabletMasterMock = {
  create: jest.fn(),
  findFirst: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    tabletMaster: tabletMasterMock,
  })),
}));

import { createTablet } from '../prescription.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  tabletMasterMock.findFirst.mockResolvedValue(null);
  tabletMasterMock.create.mockResolvedValue({ id: 1 });
});

describe('Sprint 4b.2 — TabletMaster createdBy identity', () => {
  it('createTablet derives createdBy from JWT username (ignores body-supplied doctorId)', async () => {
    const req = {
      body: {
        genericName: 'Ceftriaxone',
        brandName: 'Rocephin',
        type: 'injection',
        description: 'IV antibiotic',
        doctorId: 999, // attacker — must be ignored
      },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await createTablet(req, buildRes());

    const args = tabletMasterMock.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe('alice');
    expect(args.data.createdBy).not.toBe(999);
    expect(args.data.createdBy).not.toBe('999');
  });
});
