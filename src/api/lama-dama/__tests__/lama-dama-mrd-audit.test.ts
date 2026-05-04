/**
 * Sprint 4a Phase 1b — MRD audit enforcement tests for LAMA/DAMA handlers.
 *
 * Covers:
 *   - 2 creates × 2 (happy-path createdById stamp + 401 rejection)
 *   - 2 update handlers × 1 (401 rejection only — updatedBy attribution deferred to 4b)
 *   - 4 signature upload endpoints share one handler; 1 representative 401 test
 *     per model × 2 models via describe.each = 2 tests.
 *
 * 10 tests total.
 */

import type { Request, Response } from 'express';

const lamaRecordMock = {
  create: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(),
};
const damaRecordMock = {
  create: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(),
};
const emergencyMock = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

// Sprint 4b.6 — lama-dama.controller.ts now uses the singleton.
jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    lamaRecord: lamaRecordMock,
    damaRecord: damaRecordMock,
    emergency: emergencyMock,
  },
}));

jest.mock('../../../config/googeCloudStorage', () => ({
  __esModule: true,
  default: { name: 'mock-bucket', file: jest.fn() },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushLamaCase: jest.fn(),
  pushLamaUpdate: jest.fn(),
  pushDamaCase: jest.fn(),
  pushDamaUpdate: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import {
  createLamaRecord,
  createDamaRecord,
  updateLamaRecord,
  updateDamaRecord,
  uploadLamaPatientSignature,
  uploadDamaPatientSignature,
} from '../lama-dama.controller';
import { pushLamaCase, pushDamaCase } from '../../hmis-sync/hmis-client';

const mockedPushLama = pushLamaCase as jest.MockedFunction<typeof pushLamaCase>;
const mockedPushDama = pushDamaCase as jest.MockedFunction<typeof pushDamaCase>;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (withUser = true): Request =>
  ({
    body: {
      emergencyId: '9',
      doctorAdvice: 'Admit',
      riskExplained: true,
      reasonForLama: 'refused',
      doctorRecommendation: 'Continue',
      patientDeclinesAdvice: true,
      followUpAdvice: null,
    },
    params: { id: '1' },
    file: null,
    user: withUser ? { id: 42, username: 'alice' } : undefined,
  }) as unknown as Request;

const lamaFixture = { id: 1, emergencyId: 9, hmisLamaId: null };
const damaFixture = { id: 1, emergencyId: 9, hmisDamaId: null };

beforeEach(() => {
  jest.clearAllMocks();
  emergencyMock.findUnique.mockResolvedValue({ id: 9 });
  emergencyMock.update.mockResolvedValue({});
  lamaRecordMock.findUnique.mockResolvedValue(null);
  damaRecordMock.findUnique.mockResolvedValue(null);
  lamaRecordMock.create.mockResolvedValue(lamaFixture);
  damaRecordMock.create.mockResolvedValue(damaFixture);
  lamaRecordMock.update.mockResolvedValue(lamaFixture);
  damaRecordMock.update.mockResolvedValue(damaFixture);
  mockedPushLama.mockResolvedValue({ id: 'HMIS-LAMA-1' });
  mockedPushDama.mockResolvedValue({ id: 'HMIS-DAMA-1' });
});

describe('createLamaRecord', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await createLamaRecord(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(lamaRecordMock.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new LAMA record', async () => {
    const res = buildRes();
    await createLamaRecord(buildReq(), res);
    expect(lamaRecordMock.create).toHaveBeenCalledTimes(1);
    const args = lamaRecordMock.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('createDamaRecord', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await createDamaRecord(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(damaRecordMock.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new DAMA record', async () => {
    const res = buildRes();
    await createDamaRecord(buildReq(), res);
    expect(damaRecordMock.create).toHaveBeenCalledTimes(1);
    const args = damaRecordMock.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('LAMA/DAMA update handlers — rejection only (updatedBy attribution deferred to 4b)', () => {
  it('updateLamaRecord rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await updateLamaRecord(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(lamaRecordMock.update).not.toHaveBeenCalled();
  });

  it('updateDamaRecord rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await updateDamaRecord(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(damaRecordMock.update).not.toHaveBeenCalled();
  });
});

describe('LAMA/DAMA signature uploads (shared handler) — rejection only', () => {
  it('uploadLamaPatientSignature rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await uploadLamaPatientSignature(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(lamaRecordMock.update).not.toHaveBeenCalled();
  });

  it('uploadDamaPatientSignature rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await uploadDamaPatientSignature(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(damaRecordMock.update).not.toHaveBeenCalled();
  });
});
