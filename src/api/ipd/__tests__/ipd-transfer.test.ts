import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdAdmission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ipdBed: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIpdAdmission: jest.fn(),
  pushIPDDischarge: jest.fn(),
  pushIpdTransfer: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import prisma from '../../../service/prisma-client';
import { pushIpdTransfer } from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import { transferPatient, buildIpdTransferHmisPayload } from '../ipd.controller';

const mockedPrisma = prisma as unknown as {
  ipdAdmission: { findUnique: jest.Mock; update: jest.Mock };
  ipdBed: { findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const mockedPushIpdTransfer = pushIpdTransfer as jest.MockedFunction<
  typeof pushIpdTransfer
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
  diagnosis: 'Chest pain',
  status: 'admitted',
  hmisAdmissionId: null as string | null,
  hmisTransferId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'reception-1',
  updatedBy: null,
  bed: { id: 'bed-1', bedNumber: 'B1', wardId: 'ward-1', bedType: 'general', status: 'occupied' },
};

const updatedAdmissionFixture = {
  ...admissionFixture,
  bedId: 'bed-2',
  wardId: 'ward-2',
  bed: { id: 'bed-2', bedNumber: 'B2', wardId: 'ward-2', bedType: 'ICU', status: 'occupied' },
  ward: { id: 'ward-2', wardName: 'ICU', wardCode: 'ICU', department: 'ICU', totalBeds: 5 },
};

const newBedFixture = {
  id: 'bed-2',
  bedNumber: 'B2',
  wardId: 'ward-2',
  bedType: 'ICU',
  status: 'available',
};

const buildReq = (overrides: Record<string, unknown> = {}): Request =>
  ({
    params: { admissionId: 'adm-1' },
    body: {
      newBedId: 'bed-2',
      newWardId: 'ward-2',
      reason: 'Upgrade to ICU',
      ...overrides,
    },
    user: { id: 1, username: 'dr-smith' },
  }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.ipdAdmission.findUnique.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdBed.findUnique.mockResolvedValue(newBedFixture);
  // Default: $transaction executes the callback against the same mocked client.
  mockedPrisma.$transaction.mockImplementation(async (fnOrArr: unknown) => {
    if (typeof fnOrArr === 'function') {
      return fnOrArr(mockedPrisma);
    }
    return Promise.all(fnOrArr as Promise<unknown>[]);
  });
  mockedPrisma.ipdAdmission.update.mockResolvedValue(updatedAdmissionFixture);
  mockedPrisma.ipdBed.update.mockResolvedValue({});
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 997,
    direction: 'push',
    module: 'ipd',
    action: 'bed_transfer',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

describe('transferPatient — happy path (HMIS 2xx)', () => {
  it(
    'runs transaction (3 ops), pushes to HMIS via wrapper, persists hmisTransferId, ' +
      'writes success audit log, returns 200',
    async () => {
      mockedPushIpdTransfer.mockResolvedValue({ id: 'HMIS-TX-9' });
      mockedPrisma.ipdAdmission.update
        .mockResolvedValueOnce(updatedAdmissionFixture) // inside the transaction
        .mockResolvedValueOnce({ ...updatedAdmissionFixture, hmisTransferId: 'HMIS-TX-9' }); // hmisTransferId persist

      const res = buildRes();
      await transferPatient(buildReq(), res);

      // Transaction was invoked
      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Inside tx: admission.update + 2 bed.update
      expect(mockedPrisma.ipdAdmission.update).toHaveBeenCalledTimes(2); // 1 in tx + 1 for hmisTransferId
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledTimes(2); // 2 bed flips
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'available' },
      });
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-2' },
        data: { status: 'occupied' },
      });

      // HMIS push called with exact payload
      expect(mockedPushIpdTransfer).toHaveBeenCalledTimes(1);
      expect(mockedPushIpdTransfer).toHaveBeenCalledWith(
        buildIpdTransferHmisPayload({
          admissionId: 'adm-1',
          prn: '1001',
          fromBedId: 'bed-1',
          toBedId: 'bed-2',
          fromWardId: 'ward-1',
          toWardId: 'ward-2',
          reason: 'Upgrade to ICU',
        })
      );

      // Second update persists hmisTransferId
      expect(mockedPrisma.ipdAdmission.update).toHaveBeenCalledWith({
        where: { id: 'adm-1' },
        data: { hmisTransferId: 'HMIS-TX-9' },
        include: { bed: true, ward: true },
      });

      // Audit log
      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('bed_transfer');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('transfer');
      expect(response.result).toEqual({ id: 'HMIS-TX-9' });

      // 200 response with hmisTransferId
      expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisTransferId).toBe('HMIS-TX-9');
    }
  );
});

describe('transferPatient — HMIS failure path (HMIS 503)', () => {
  it(
    'transaction still commits, bed state correct, no hmisTransferId update, ' +
      'failure audit log captures status 503 + detail, returns 200',
    async () => {
      const hmisError = Object.assign(new Error('Request failed with status 503'), {
        response: { status: 503, data: { err: 'HMIS down' } },
      });
      mockedPushIpdTransfer.mockRejectedValue(hmisError);

      const res = buildRes();
      await transferPatient(buildReq(), res);

      expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'available' },
      });
      expect(mockedPrisma.ipdBed.update).toHaveBeenCalledWith({
        where: { id: 'bed-2' },
        data: { status: 'occupied' },
      });

      expect(mockedPushIpdTransfer).toHaveBeenCalledTimes(1);
      // Admission.update called once (inside tx), NOT a second time for hmisTransferId
      expect(mockedPrisma.ipdAdmission.update).toHaveBeenCalledTimes(1);

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('failed');
      expect(auditCall.module).toBe('ipd');
      expect(auditCall.action).toBe('bed_transfer');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('transfer');
      expect(response.error.status).toBe(503);
      expect(response.error.detail).toEqual({ err: 'HMIS down' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisTransferId).toBeNull();
    }
  );
});

describe('transferPatient — validation guards (sanity)', () => {
  it('returns 400 and does not touch HMIS or DB when required fields are missing', async () => {
    const res = buildRes();
    await transferPatient(buildReq({ newBedId: undefined }), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPushIpdTransfer).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when the admission is not in transferable state (already discharged)', async () => {
    mockedPrisma.ipdAdmission.findUnique.mockResolvedValue({
      ...admissionFixture,
      status: 'discharged',
    });

    const res = buildRes();
    await transferPatient(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(409);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPushIpdTransfer).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when target bed equals current bed (no-op transfer)', async () => {
    const res = buildRes();
    // Request transfer to the SAME bed as current.
    await transferPatient(buildReq({ newBedId: 'bed-1', newWardId: 'ward-1' }), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(409);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPushIpdTransfer).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when the new bed is occupied', async () => {
    mockedPrisma.ipdBed.findUnique.mockResolvedValue({
      ...newBedFixture,
      status: 'occupied',
    });

    const res = buildRes();
    await transferPatient(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(409);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPushIpdTransfer).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});
