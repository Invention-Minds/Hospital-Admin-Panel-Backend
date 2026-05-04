/**
 * Sprint 3f — OPD → IPD admission (convertOpdToIpd helper) integration tests.
 *
 * First end-to-end exercise of Sprint 1's wrapper-migrated helper. Covers
 * happy path + HMIS failure, asserting that:
 *   - admission row is created with sourceModule='opd' + referralOpdId
 *   - bed flips to 'occupied'
 *   - HMIS audit log is written (module='ipd', action='admission_from_opd')
 *   - pendingPrescriptions + pendingInvestigations returned in response
 */

import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    appointment: { findUnique: jest.fn() },
    prescription: { findMany: jest.fn() },
    investigationOrder: { findMany: jest.fn() },
    ipdAdmission: { findFirst: jest.fn(), create: jest.fn() },
    ipdBed: { update: jest.fn() },
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIpdAdmission: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import prisma from '../../../service/prisma-client';
import { pushIpdAdmission } from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import { admitToIpd } from '../opd.controller';

const mockedPrisma = prisma as unknown as {
  appointment: { findUnique: jest.Mock };
  prescription: { findMany: jest.Mock };
  investigationOrder: { findMany: jest.Mock };
  ipdAdmission: { findFirst: jest.Mock; create: jest.Mock };
  ipdBed: { update: jest.Mock };
};
const mockedPushIpdAdmission = pushIpdAdmission as jest.MockedFunction<typeof pushIpdAdmission>;
const mockedCreateHmisAuditLog = createHmisAuditLog as jest.MockedFunction<typeof createHmisAuditLog>;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (overrides: Record<string, unknown> = {}): Request =>
  ({
    body: {
      appointmentId: 42,
      wardId: 'W1',
      bedId: 'B1',
      admittingDoctorId: 7,
      admittingDoctorName: 'Dr. Meera Joshi',
      admissionType: 'elective',
      ...overrides,
    },
    user: { id: 1, username: 'reception-1' },
  }) as unknown as Request;

const appointmentFixture = {
  id: 42,
  patient: { prn: 1001 },
  doctor: { name: 'Dr. Ravi', departmentName: 'General Medicine' },
};

const admissionFixture = {
  id: 'adm-7',
  admissionNo: 'JMRH-IPD-0001',
  prn: '1001',
  sourceModule: 'opd',
  referralOpdId: '42',
  admittingDoctor: 'Dr. Meera Joshi',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.appointment.findUnique.mockResolvedValue(appointmentFixture);
  mockedPrisma.prescription.findMany.mockResolvedValue([
    { id: 'rx-1', prn: '1001', prescriptionId: 'OPD-RX-1' },
  ]);
  mockedPrisma.investigationOrder.findMany.mockResolvedValue([
    { id: 'io-1', prn: '1001', labTests: [], radiologyTests: [], packages: [] },
  ]);
  mockedPrisma.ipdAdmission.findFirst.mockResolvedValue(null);
  mockedPrisma.ipdAdmission.create.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdBed.update.mockResolvedValue({});
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 1000,
    direction: 'push',
    module: 'ipd',
    action: 'admission_from_opd',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

describe('admitToIpd — happy path (HMIS 2xx)', () => {
  it(
    'creates admission (sourceModule=opd, referralOpdId=42), occupies bed, writes success audit, ' +
      'returns 201 with ipdAdmission + pendingPrescriptions + pendingInvestigations',
    async () => {
      mockedPushIpdAdmission.mockResolvedValue({ id: 'HMIS-ADM-77' });

      const res = buildRes();
      await admitToIpd(buildReq(), res);

      // Prisma writes
      expect(mockedPrisma.ipdAdmission.create).toHaveBeenCalledTimes(1);
      const createArgs = mockedPrisma.ipdAdmission.create.mock.calls[0][0];
      expect(createArgs.data).toEqual(expect.objectContaining({
        sourceModule: 'opd',
        referralOpdId: '42',
        admittingDoctor: 'Dr. Meera Joshi',
        wardId: 'W1',
        bedId: 'B1',
        prn: '1001',
        status: 'admitted',
      }));
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'B1' },
        data: { status: 'occupied' },
      });

      // HMIS push + audit
      expect(mockedPushIpdAdmission).toHaveBeenCalledTimes(1);
      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('admission_from_opd');
      expect(auditCall.status).toBe('success');

      // Response shape
      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.ipdAdmission.id).toBe('adm-7');
      expect(Array.isArray(body.data.pendingPrescriptions)).toBe(true);
      expect(body.data.pendingPrescriptions[0].id).toBe('rx-1');
      expect(Array.isArray(body.data.pendingInvestigations)).toBe(true);
      expect(body.data.pendingInvestigations[0].id).toBe('io-1');
    }
  );
});

describe('admitToIpd — HMIS failure (HMIS 503)', () => {
  it(
    'still returns 201 (admission created, bed occupied); failure audit captures status 503 + detail',
    async () => {
      const hmisError = Object.assign(new Error('Request failed with status 503'), {
        response: { status: 503, data: { err: 'HMIS down' } },
      });
      mockedPushIpdAdmission.mockRejectedValue(hmisError);

      const res = buildRes();
      await admitToIpd(buildReq(), res);

      // Admission + bed still progress
      expect(mockedPrisma.ipdAdmission.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'B1' },
        data: { status: 'occupied' },
      });

      // Failure audit row captures status + detail
      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('failed');
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('admission_from_opd');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('admission');
      expect(response.error.status).toBe(503);
      expect(response.error.detail).toEqual({ err: 'HMIS down' });

      // Response is still 201 — helper returns ipdAdmission even on HMIS failure.
      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    }
  );
});

describe('admitToIpd — validation', () => {
  it('returns 400 when required fields missing (no appointmentId)', async () => {
    const res = buildRes();
    await admitToIpd(buildReq({ appointmentId: undefined }), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mockedPrisma.ipdAdmission.create).not.toHaveBeenCalled();
    expect(mockedPushIpdAdmission).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});
