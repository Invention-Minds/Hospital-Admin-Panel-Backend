import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdBed: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ipdAdmission: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
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
import { createIpdAdmission, buildIpdHmisPushPayload } from '../ipd.controller';

const mockedPrisma = prisma as unknown as {
  ipdBed: { findUnique: jest.Mock; update: jest.Mock };
  ipdAdmission: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};
const mockedPushIpdAdmission = pushIpdAdmission as jest.MockedFunction<
  typeof pushIpdAdmission
>;
const mockedCreateHmisAuditLog = createHmisAuditLog as jest.MockedFunction<
  typeof createHmisAuditLog
>;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const admissionFixture = {
  id: 'adm-1',
  admissionNo: 'JMRH-IPD-0001',
  prn: '1001',
  admissionDate: new Date('2026-04-18T10:00:00Z'),
  admissionTime: '10:00:00',
  admissionType: 'routine',
  sourceModule: 'direct',
  referralOpdId: null,
  referralEmergencyId: null,
  referralMlcId: null,
  referringDoctor: null,
  admittingDoctor: 'Dr. Smith',
  department: 'Cardiology',
  wardId: 'ward-1',
  bedId: 'bed-1',
  roomType: 'general',
  diagnosis: 'Chest pain — rule out MI',
  status: 'admitted',
  hmisAdmissionId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'reception-1',
  updatedBy: null,
  bed: { id: 'bed-1', bedNumber: 'B1', wardId: 'ward-1', bedType: 'general', status: 'available' },
  ward: { id: 'ward-1', wardName: 'Cardiac Care', wardCode: 'CCU', department: 'Cardiology', totalBeds: 10 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.ipdBed.findUnique.mockResolvedValue({
    id: 'bed-1',
    bedNumber: 'B1',
    wardId: 'ward-1',
    bedType: 'general',
    status: 'available',
  });
  mockedPrisma.ipdAdmission.findFirst.mockResolvedValue(null);
  mockedPrisma.ipdAdmission.create.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdBed.update.mockResolvedValue({});
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 999,
    direction: 'push',
    module: 'ipd',
    action: 'admission_created',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

const buildReq = (overrides: Record<string, unknown> = {}): Request =>
  ({
    body: {
      prn: '1001',
      admittingDoctor: 'Dr. Smith',
      wardId: 'ward-1',
      bedId: 'bed-1',
      diagnosis: 'Chest pain — rule out MI',
      department: 'Cardiology',
      ...overrides,
    },
    user: { id: 1, username: 'reception-1' },
  }) as unknown as Request;

describe('createIpdAdmission — happy path (HMIS 2xx)', () => {
  it(
    'creates the admission, occupies the bed, pushes to HMIS via wrapper, ' +
      'persists hmisAdmissionId, writes a success audit log, and returns 201',
    async () => {
      mockedPushIpdAdmission.mockResolvedValue({ id: 'HMIS-ADM-7' });
      mockedPrisma.ipdAdmission.update.mockResolvedValue({
        ...admissionFixture,
        hmisAdmissionId: 'HMIS-ADM-7',
      });

      const res = buildRes();
      await createIpdAdmission(buildReq(), res);

      expect(mockedPrisma.ipdAdmission.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'occupied' },
      });

      expect(mockedPushIpdAdmission).toHaveBeenCalledTimes(1);
      expect(mockedPushIpdAdmission).toHaveBeenCalledWith(
        buildIpdHmisPushPayload(admissionFixture)
      );

      expect(mockedPrisma.ipdAdmission.update).toHaveBeenCalledWith({
        where: { id: 'adm-1' },
        data: { hmisAdmissionId: 'HMIS-ADM-7' },
        include: { bed: true, ward: true },
      });

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.direction).toBe('push');
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('admission_created');
      expect(auditCall.retryCount).toBe(0);
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('admission');
      expect(response.result).toEqual({ id: 'HMIS-ADM-7' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisAdmissionId).toBe('HMIS-ADM-7');
    }
  );
});

describe('createIpdAdmission — HMIS failure path (HMIS 503)', () => {
  it(
    'still returns 201 with the admission, bed stays occupied, ' +
      'no hmisAdmissionId update, failure audit log captures status 503 + detail',
    async () => {
      const hmisError = Object.assign(new Error('Request failed with status 503'), {
        response: { status: 503, data: { err: 'HMIS down' } },
      });
      mockedPushIpdAdmission.mockRejectedValue(hmisError);

      const res = buildRes();
      await createIpdAdmission(buildReq({ prn: '1002', bedId: 'bed-1' }), res);

      expect(mockedPrisma.ipdAdmission.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'occupied' },
      });

      expect(mockedPushIpdAdmission).toHaveBeenCalledTimes(1);

      // No second update call for hmisAdmissionId since HMIS failed.
      expect(mockedPrisma.ipdAdmission.update).not.toHaveBeenCalled();

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('failed');
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('admission_created');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('admission');
      expect(response.error.status).toBe(503);
      expect(response.error.detail).toEqual({ err: 'HMIS down' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisAdmissionId).toBeNull();
    }
  );
});

describe('createIpdAdmission — validation guards (sanity)', () => {
  it('returns 400 and does not touch HMIS when required fields are missing', async () => {
    const res = buildRes();
    await createIpdAdmission(buildReq({ prn: undefined }), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mockedPrisma.ipdAdmission.create).not.toHaveBeenCalled();
    expect(mockedPushIpdAdmission).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 and does not touch HMIS when the bed is already occupied', async () => {
    mockedPrisma.ipdBed.findUnique.mockResolvedValue({
      id: 'bed-1',
      status: 'occupied',
      wardId: 'ward-1',
      bedNumber: 'B1',
      bedType: 'general',
    });

    const res = buildRes();
    await createIpdAdmission(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(409);
    expect(mockedPrisma.ipdAdmission.create).not.toHaveBeenCalled();
    expect(mockedPushIpdAdmission).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});
