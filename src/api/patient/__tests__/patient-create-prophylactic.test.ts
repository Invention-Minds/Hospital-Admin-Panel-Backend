/**
 * Sprint 4b.2 — patient-create prophylactic stripAuditFields test.
 *
 * PatientDetails has no audit columns today. The stripAuditFields wrap in
 * createPatient is purely defensive so body-supplied `createdBy`/`updatedBy`
 * etc. don't leak once columns are added. This test asserts the body-strip
 * happens — no behaviour change today; the guarantee is for tomorrow.
 */

import type { Request, Response } from 'express';

const patientDetailsMock = {
  findUnique: jest.fn(),
  create: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    patientDetails: patientDetailsMock,
  })),
}));

jest.mock('../patient-helper', () => ({
  generatePRN: jest.fn(),
  syncPatientToHmis: jest.fn(),
}));

jest.mock('../patient.repository', () => ({
  PatientRepository: jest.fn().mockImplementation(() => ({})),
}));

import { createPatient } from '../patient.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  patientDetailsMock.findUnique.mockResolvedValue(null);
  patientDetailsMock.create.mockResolvedValue({ id: 1 });
});

describe('Sprint 4b.2 — patient create prophylactic', () => {
  it('body-supplied audit-attribution fields are stripped before spread into Prisma create', async () => {
    const req = {
      body: {
        prn: 9999999,
        name: 'Test Patient',
        mobileNo: '+91',
        // These should NOT land in the create payload even though the body-spread pattern exists.
        createdBy: 'attacker',
        updatedBy: 'attacker',
        createdById: 999,
        updatedById: 999,
        createdAt: new Date('2000-01-01'),
      },
    } as unknown as Request;

    await createPatient(req, buildRes());

    const args = patientDetailsMock.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      prn: 9999999,
      name: 'Test Patient',
    }));
    expect(args.data.createdBy).toBeUndefined();
    expect(args.data.updatedBy).toBeUndefined();
    expect(args.data.createdById).toBeUndefined();
    expect(args.data.updatedById).toBeUndefined();
  });
});
