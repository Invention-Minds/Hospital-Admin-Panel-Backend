/**
 * Sprint 3f — Emergency → IPD conversion (convertEmergencyToIpd helper)
 * integration tests. First end-to-end exercise of Sprint 1's wrapper-migrated
 * helper.
 */

import type { Request, Response } from 'express';

/**
 * Sprint 4b.6 — emergency.controller.ts now uses the src/service/prisma-client
 * singleton (same as the conversion helper), so a single singleton mock covers
 * both code paths. The previous dual-mock (@prisma/client + singleton) is gone.
 */
const prismaMock = {
  emergency: { findUnique: jest.fn(), update: jest.fn() },
  mlcCase: { findFirst: jest.fn() },
  prescription: { findMany: jest.fn() },
  investigationOrder: { findMany: jest.fn() },
  ipdAdmission: { findFirst: jest.fn(), create: jest.fn() },
  ipdBed: { update: jest.fn() },
};

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIpdAdmission: jest.fn(),
  pushEmergencyToHmis: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import { pushIpdAdmission } from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import { convertToIPD } from '../emergency.controller';

const mockedPrisma = prismaMock;
const mockedPushIpdAdmission = pushIpdAdmission as jest.MockedFunction<typeof pushIpdAdmission>;
const mockedCreateHmisAuditLog = createHmisAuditLog as jest.MockedFunction<typeof createHmisAuditLog>;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (overrides: Record<string, unknown> = {}, idParam = '9'): Request =>
  ({
    params: { id: idParam },
    body: {
      wardId: 'W1',
      bedId: 'B1',
      admittingDoctorId: 7,
      admittingDoctorName: 'Dr. Surgeon',
      admissionType: 'emergency',
      ...overrides,
    },
    user: { id: 1, username: 'reception-1' },
  }) as unknown as Request;

const emergencyFixture = {
  id: 9,
  prn: 'JMRH-ER-9',
  triageCategory: 'red',
  presentingComplaint: 'Chest pain — suspected MI',
  hmisEmergencyId: 'HMIS-ER-77',
  traumaScore: null,
  mlcCase: null,
};

const admissionFixture = {
  id: 'adm-emerg-1',
  admissionNo: 'JMRH-IPD-0002',
  prn: 'JMRH-ER-9',
  sourceModule: 'emergency',
  referralEmergencyId: '9',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.emergency.findUnique.mockResolvedValue(emergencyFixture);
  mockedPrisma.emergency.update.mockResolvedValue({});
  mockedPrisma.mlcCase.findFirst.mockResolvedValue(null);
  mockedPrisma.prescription.findMany.mockResolvedValue([{ id: 'rx-er-1', prn: 'JMRH-ER-9' }]);
  mockedPrisma.investigationOrder.findMany.mockResolvedValue([
    { id: 'io-er-1', prn: 'JMRH-ER-9', labTests: [], radiologyTests: [], packages: [] },
  ]);
  mockedPrisma.ipdAdmission.findFirst.mockResolvedValue(null);
  mockedPrisma.ipdAdmission.create.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdBed.update.mockResolvedValue({});
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 2000,
    direction: 'push',
    module: 'ipd',
    action: 'admission_from_emergency',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

describe('convertToIPD — happy path (HMIS 2xx)', () => {
  it(
    'creates admission (sourceModule=emergency, referralEmergencyId=9, roomType=ICU for red triage), ' +
      'flips emergency.status to admitted-ipd, occupies bed, writes success audit, returns 201',
    async () => {
      mockedPushIpdAdmission.mockResolvedValue({ id: 'HMIS-ADM-88' });

      const res = buildRes();
      await convertToIPD(buildReq(), res);

      // Admission create with correct source + room type mapping
      expect(mockedPrisma.ipdAdmission.create).toHaveBeenCalledTimes(1);
      const createArgs = mockedPrisma.ipdAdmission.create.mock.calls[0][0];
      expect(createArgs.data).toEqual(expect.objectContaining({
        sourceModule: 'emergency',
        referralEmergencyId: '9',
        admittingDoctor: 'Dr. Surgeon',
        wardId: 'W1',
        bedId: 'B1',
        roomType: 'ICU',
        diagnosis: 'Chest pain — suspected MI',
        status: 'admitted',
      }));

      // Emergency status flip
      expect(mockedPrisma.emergency.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { status: 'admitted-ipd' },
      });

      // Bed + audit
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'B1' },
        data: { status: 'occupied' },
      });
      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('admission_from_emergency');
      expect(auditCall.status).toBe('success');

      // Response includes ipdAdmission + pendingPrescriptions + pendingInvestigations + mlcCase
      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.ipdAdmission.id).toBe('adm-emerg-1');
      expect(body.data.pendingPrescriptions[0].id).toBe('rx-er-1');
      expect(body.data.pendingInvestigations[0].id).toBe('io-er-1');
      expect(body.data.mlcCase).toBeNull();
    }
  );
});

describe('convertToIPD — MLC linkage', () => {
  it('populates referralMlcId when the emergency has an associated MlcCase', async () => {
    mockedPrisma.mlcCase.findFirst.mockResolvedValue({ id: 'mlc-42', emergencyId: 9 });
    mockedPushIpdAdmission.mockResolvedValue({ id: 'HMIS-ADM-88' });

    const res = buildRes();
    await convertToIPD(buildReq(), res);

    const createArgs = mockedPrisma.ipdAdmission.create.mock.calls[0][0];
    expect(createArgs.data.referralMlcId).toBe('mlc-42');

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.mlcCase?.id).toBe('mlc-42');
  });
});

describe('convertToIPD — HMIS failure (HMIS 503)', () => {
  it(
    'still returns 201; emergency status + bed occupancy still update; failure audit captures',
    async () => {
      const hmisError = Object.assign(new Error('Request failed with status 503'), {
        response: { status: 503, data: { err: 'HMIS down' } },
      });
      mockedPushIpdAdmission.mockRejectedValue(hmisError);

      const res = buildRes();
      await convertToIPD(buildReq(), res);

      expect(mockedPrisma.ipdAdmission.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'B1' },
        data: { status: 'occupied' },
      });
      expect(mockedPrisma.emergency.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { status: 'admitted-ipd' },
      });

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('failed');
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('admission_from_emergency');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.error.status).toBe(503);
      expect(response.error.detail).toEqual({ err: 'HMIS down' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    }
  );
});

describe('convertToIPD — validation', () => {
  it('returns 400 when required fields missing', async () => {
    const res = buildRes();
    await convertToIPD(buildReq({ wardId: undefined }), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mockedPrisma.ipdAdmission.create).not.toHaveBeenCalled();
    expect(mockedPushIpdAdmission).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 404 when the emergency case does not exist', async () => {
    mockedPrisma.emergency.findUnique.mockResolvedValue(null);

    const res = buildRes();
    await convertToIPD(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(404);
    expect(mockedPrisma.ipdAdmission.create).not.toHaveBeenCalled();
    expect(mockedPushIpdAdmission).not.toHaveBeenCalled();
  });
});
