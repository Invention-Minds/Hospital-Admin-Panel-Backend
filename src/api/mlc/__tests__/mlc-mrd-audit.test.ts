/**
 * Sprint 4a Phase 1b — MRD audit enforcement tests for MLC write handlers.
 *
 * Covers:
 *   - 1 create (registerMlcCase) × 2 (happy + 401)
 *   - 8 updates × 1 (401 only; existing happy-path update tests continue to exercise updatedBy)
 *
 * 10 tests total.
 */

import type { Request, Response } from 'express';

const mlcCaseMock = {
  create: jest.fn(),
  update: jest.fn(),
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
};
const emergencyMock = {
  findUnique: jest.fn(),
};

// Sprint 4b.6 — mlc.controller.ts now uses the singleton.
jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    mlcCase: mlcCaseMock,
    emergency: emergencyMock,
  },
}));

jest.mock('../../../config/googeCloudStorage', () => ({
  __esModule: true,
  default: { name: 'mock-bucket', file: jest.fn() },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushMlcCase: jest.fn(),
  pushMlcUpdate: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import {
  registerMlcCase,
  recordExamination,
  recordSampleCollection,
  submitReport,
  updateMlcCase,
  uploadMlcPhotos,
  uploadExaminerSignature,
  uploadSubmissionProof,
  closeMlcCase,
} from '../mlc.controller';
import { pushMlcCase } from '../../hmis-sync/hmis-client';

const mockedPushMlc = pushMlcCase as jest.MockedFunction<typeof pushMlcCase>;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (withUser = true): Request =>
  ({
    body: {
      emergencyId: '7',
      caseType: 'accident',
      policeStationName: 'Koramangala PS',
      examinerName: 'Dr. B',
      injuries: 'abrasion',
      samplesCollected: 'blood',
      sampleStorageInfo: 'fridge',
      finalReport: 'done',
      reportSubmittedTo: 'PS',
    },
    params: { id: '42' },
    file: null,
    files: [],
    user: withUser ? { id: 42, username: 'alice' } : undefined,
  }) as unknown as Request;

const mlcCaseFixture = {
  id: 42,
  mlcNo: 'MLC-2026-0001',
  emergencyId: 7,
  caseType: 'accident',
  status: 'documented',
  hmisMlcId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  emergencyMock.findUnique.mockResolvedValue({ id: 7 });
  // Register path checks findUnique for an existing MLC case — null = "no prior MLC".
  mlcCaseMock.findUnique.mockResolvedValue(null);
  mlcCaseMock.create.mockResolvedValue(mlcCaseFixture);
  mlcCaseMock.update.mockResolvedValue(mlcCaseFixture);
  mockedPushMlc.mockResolvedValue({ id: 'HMIS-MLC-1' });
});

describe('registerMlcCase', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await registerMlcCase(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new MLC case', async () => {
    const res = buildRes();
    await registerMlcCase(buildReq(), res);
    expect(mlcCaseMock.create).toHaveBeenCalledTimes(1);
    const args = mlcCaseMock.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('MLC update handlers — rejection only (updatedBy already stamped pre-4b)', () => {
  it('recordExamination rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await recordExamination(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('recordSampleCollection rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await recordSampleCollection(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('submitReport rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await submitReport(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('updateMlcCase rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await updateMlcCase(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('uploadMlcPhotos rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await uploadMlcPhotos(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('uploadExaminerSignature rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await uploadExaminerSignature(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('uploadSubmissionProof rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await uploadSubmissionProof(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });

  it('closeMlcCase rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await closeMlcCase(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
  });
});
