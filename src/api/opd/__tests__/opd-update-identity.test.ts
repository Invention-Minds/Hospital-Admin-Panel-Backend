/**
 * Sprint 4b.2 — OPD update server-identity test.
 *
 *   1. updateOpdAssessment: body-supplied createdBy is stripped; JWT-gated.
 */

import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    oPDAssessment: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../../conversion/opd-to-ipd', () => ({
  convertOpdToIpd: jest.fn(),
}));

import prisma from '../../../service/prisma-client';
import { updateOpdAssessment } from '../opd.controller';

const prismaMock = prisma as unknown as {
  oPDAssessment: { update: jest.Mock };
};

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.oPDAssessment.update.mockResolvedValue({ id: 1 });
});

describe('Sprint 4b.2 — OPD update identity', () => {
  it('updateOpdAssessment strips body-supplied createdBy (impersonation attempt ignored)', async () => {
    const req = {
      params: { id: '7' },
      body: {
        treatmentPlan: 'revised',
        createdBy: 999, // impersonation
      },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await updateOpdAssessment(req, buildRes());

    const args = prismaMock.oPDAssessment.update.mock.calls[0][0];
    expect(args.data.createdBy).toBeUndefined();
    expect(args.data.treatmentPlan).toBe('revised');
  });
});
