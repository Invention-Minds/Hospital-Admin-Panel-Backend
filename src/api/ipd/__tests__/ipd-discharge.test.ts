import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdAdmission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ipdDischarge: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ipdBed: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIpdAdmission: jest.fn(),
  pushIPDDischarge: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

// Mute the (unrelated) follow-up-automation side effect. It's Sprint 4 scope and pre-existing.
jest.mock('../follow-up-automation', () => ({
  createFollowUpAppointment: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../service/prisma-client';
import { pushIPDDischarge } from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import { createDischarge, buildIpdDischargeHmisPayload } from '../ipd.controller';

const mockedPrisma = prisma as unknown as {
  ipdAdmission: { findUnique: jest.Mock; update: jest.Mock };
  ipdDischarge: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  ipdBed: { update: jest.Mock };
};
const mockedPushIPDDischarge = pushIPDDischarge as jest.MockedFunction<
  typeof pushIPDDischarge
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
  admissionDate: new Date('2026-04-15T10:00:00Z'),
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
};

const dischargeFixture = {
  id: 'dis-1',
  admissionId: 'adm-1',
  dischargeDate: new Date('2026-04-18T14:00:00Z'),
  dischargeTime: '14:00:00',
  dischargeType: 'regular',
  finalDiagnosis: 'Acute MI resolved',
  proceduresDone: 'PCI with stent',
  conditionAtDischarge: 'stable',
  dischargeSummary: 'Patient discharged in stable condition.',
  followUpDate: null as Date | null,
  followUpDoctor: null,
  medications: '[]',
  advice: 'Continue prescribed meds',
  hmisDischargeId: null as string | null,
  createdAt: new Date(),
  createdBy: 'dr-smith',
};

const buildReq = (overrides: Record<string, unknown> = {}): Request =>
  ({
    params: { admissionId: 'adm-1' },
    body: {
      dischargeType: 'regular',
      finalDiagnosis: 'Acute MI resolved',
      proceduresDone: 'PCI with stent',
      conditionAtDischarge: 'stable',
      dischargeSummary: 'Patient discharged in stable condition.',
      medications: [],
      advice: 'Continue prescribed meds',
      ...overrides,
    },
    user: { id: 1, username: 'dr-smith' },
  }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.ipdAdmission.findUnique.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdDischarge.findUnique.mockResolvedValue(null);
  mockedPrisma.ipdDischarge.create.mockResolvedValue(dischargeFixture);
  mockedPrisma.ipdAdmission.update.mockResolvedValue({ ...admissionFixture, status: 'discharged' });
  mockedPrisma.ipdBed.update.mockResolvedValue({});
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 998,
    direction: 'push',
    module: 'discharge',
    action: 'discharge_created',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

describe('createDischarge — happy path (HMIS 2xx)', () => {
  it(
    'creates the discharge, flips admission status, frees the bed, pushes to HMIS via wrapper, ' +
      'persists hmisDischargeId, writes a success audit log, and returns 201',
    async () => {
      mockedPushIPDDischarge.mockResolvedValue({ id: 'HMIS-DIS-4' });
      mockedPrisma.ipdDischarge.update.mockResolvedValue({
        ...dischargeFixture,
        hmisDischargeId: 'HMIS-DIS-4',
      });

      const res = buildRes();
      await createDischarge(buildReq(), res);

      expect(mockedPrisma.ipdDischarge.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdAdmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adm-1' },
          data: expect.objectContaining({ status: 'discharged' }),
        })
      );
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'available' },
      });

      expect(mockedPushIPDDischarge).toHaveBeenCalledTimes(1);
      expect(mockedPushIPDDischarge).toHaveBeenCalledWith(
        buildIpdDischargeHmisPayload(dischargeFixture, admissionFixture.prn)
      );

      expect(mockedPrisma.ipdDischarge.update).toHaveBeenCalledWith({
        where: { id: 'dis-1' },
        data: { hmisDischargeId: 'HMIS-DIS-4' },
      });

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.direction).toBe('push');
      expect(auditCall.module).toBe('discharge');
      expect(auditCall.action).toBe('discharge_created');
      expect(auditCall.retryCount).toBe(0);
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('discharge');
      expect(response.result).toEqual({ id: 'HMIS-DIS-4' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisDischargeId).toBe('HMIS-DIS-4');
    }
  );
});

describe('createDischarge — HMIS failure path (HMIS 500)', () => {
  it(
    'still returns 201, bed stays available, admission stays discharged, ' +
      'no hmisDischargeId update, failure audit log captures status 500 + detail',
    async () => {
      const hmisError = Object.assign(new Error('Request failed with status 500'), {
        response: { status: 500, data: { err: 'HMIS internal error' } },
      });
      mockedPushIPDDischarge.mockRejectedValue(hmisError);

      const res = buildRes();
      await createDischarge(buildReq(), res);

      expect(mockedPrisma.ipdDischarge.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdAdmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'discharged' }) })
      );
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'available' },
      });

      expect(mockedPushIPDDischarge).toHaveBeenCalledTimes(1);
      // No hmisDischargeId persistence on failure.
      expect(mockedPrisma.ipdDischarge.update).not.toHaveBeenCalled();

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('failed');
      expect(auditCall.module).toBe('discharge');
      expect(auditCall.action).toBe('discharge_created');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('discharge');
      expect(response.error.status).toBe(500);
      expect(response.error.detail).toEqual({ err: 'HMIS internal error' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisDischargeId).toBeNull();
    }
  );
});

describe('createDischarge — validation guards (sanity)', () => {
  it('returns 400 and does not touch HMIS when required fields are missing', async () => {
    const res = buildRes();
    await createDischarge(buildReq({ dischargeType: undefined }), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mockedPrisma.ipdDischarge.create).not.toHaveBeenCalled();
    expect(mockedPushIPDDischarge).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 and does not touch HMIS when the admission is already discharged', async () => {
    mockedPrisma.ipdAdmission.findUnique.mockResolvedValue({
      ...admissionFixture,
      status: 'discharged',
    });

    const res = buildRes();
    await createDischarge(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(409);
    expect(mockedPrisma.ipdDischarge.create).not.toHaveBeenCalled();
    expect(mockedPushIPDDischarge).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when an IpdDischarge row already exists for this admission', async () => {
    mockedPrisma.ipdDischarge.findUnique.mockResolvedValue(dischargeFixture);

    const res = buildRes();
    await createDischarge(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(409);
    expect(mockedPrisma.ipdDischarge.create).not.toHaveBeenCalled();
    expect(mockedPushIPDDischarge).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});
