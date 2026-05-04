/**
 * Sprint 4b Phase 4b.1 — MLC update-handler stamping tests.
 *
 * Coverage:
 *   - 8 happy-path tests: one per MLC update handler, asserting both
 *     `updatedBy` (username from JWT) and `updatedById` (id from JWT) are stamped.
 *   - Edge test E1: body-spread leak closed — client POST of
 *     `updatedBy:'attacker'`, `updatedById:999` is overwritten by server values.
 *   - Edge test E2: HMIS-id post-write (persistHmisMlcIdIfMissing) is EXEMPT
 *     from attribution stamping per Q1 decision — only `hmisMlcId` is written,
 *     `updatedBy`/`updatedById` stay unset.
 *
 * 10 tests total.
 */

import type { Request, Response } from 'express';

const mlcCaseMock = {
  create: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(),
};
const emergencyMock = { findUnique: jest.fn() };

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
  default: {
    name: 'mock-bucket',
    file: jest.fn().mockImplementation(() => ({
      createWriteStream: () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PassThrough } = require('stream');
        const pt = new PassThrough();
        process.nextTick(() => pt.emit('finish'));
        return pt;
      },
      makePublic: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushMlcCase: jest.fn().mockResolvedValue({ id: 'HMIS-MLC-1' }),
  pushMlcUpdate: jest.fn().mockResolvedValue({ id: 'HMIS-MLC-1' }),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import {
  recordExamination,
  recordSampleCollection,
  submitReport,
  updateMlcCase,
  uploadMlcPhotos,
  uploadExaminerSignature,
  uploadSubmissionProof,
  closeMlcCase,
} from '../mlc.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const mlcCaseFixture = {
  id: 42,
  mlcNo: 'MLC-2026-0001',
  emergencyId: 7,
  caseType: 'accident',
  status: 'documented',
  hmisMlcId: null,
  photoUrls: null as string | null,
};

const makeFile = (): Express.Multer.File => ({
  buffer: Buffer.from('content'),
  originalname: 'file.png',
  mimetype: 'image/png',
  size: 7,
  fieldname: 'file',
  encoding: '7bit',
  destination: '',
  filename: '',
  path: '',
}) as unknown as Express.Multer.File;

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({
    params: { id: '42' },
    body: {},
    user: { id: 42, username: 'alice' },
    ...overrides,
  }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  emergencyMock.findUnique.mockResolvedValue({ id: 7 });
  mlcCaseMock.findUnique.mockResolvedValue(mlcCaseFixture);
  mlcCaseMock.update.mockResolvedValue(mlcCaseFixture);
});

describe('Sprint 4b.1 — MLC update handlers stamp updatedBy + updatedById from JWT', () => {
  it('recordExamination', async () => {
    await recordExamination(
      buildReq({ body: { examinerName: 'Dr. B', injuries: 'abrasion' } } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('recordSampleCollection', async () => {
    await recordSampleCollection(
      buildReq({ body: { samplesCollected: 'blood', sampleStorageInfo: 'fridge' } } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('submitReport', async () => {
    await submitReport(
      buildReq({ body: { finalReport: 'done', reportSubmittedTo: 'PS' } } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('updateMlcCase', async () => {
    await updateMlcCase(
      buildReq({ body: { injuries: 'laceration' } } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('uploadMlcPhotos', async () => {
    await uploadMlcPhotos(
      buildReq({ files: [makeFile()] } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('uploadExaminerSignature', async () => {
    await uploadExaminerSignature(
      buildReq({ file: makeFile() } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('uploadSubmissionProof', async () => {
    await uploadSubmissionProof(
      buildReq({ file: makeFile() } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('closeMlcCase', async () => {
    await closeMlcCase(
      buildReq({ body: { closureNotes: 'case closed' } } as Partial<Request>),
      buildRes()
    );
    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });
});

describe('Sprint 4b.1 — E1: updateMlcCase body-spread identity leak closed', () => {
  it('client-supplied updatedBy/updatedById in body are ignored; JWT identity wins', async () => {
    const req = buildReq({
      body: {
        injuries: 'laceration',
        // Attempt to impersonate — must be stripped.
        updatedBy: 'attacker',
        updatedById: 999,
        createdBy: 'attacker',
        createdById: 999,
      },
    } as Partial<Request>);

    await updateMlcCase(req, buildRes());

    const args = mlcCaseMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
    // Impersonation attempts must not have leaked through.
    expect(args.data.updatedBy).not.toBe('attacker');
    expect(args.data.updatedById).not.toBe(999);
    expect(args.data.createdBy).toBeUndefined();
    expect(args.data.createdById).toBeUndefined();
  });
});

describe('Sprint 4b.1 — E2: HMIS-id backfill exempt from attribution stamping (Q1 decision)', () => {
  it('recordExamination HMIS-id backfill writes only hmisMlcId, NOT updatedBy/updatedById', async () => {
    // Resolve with a mlcCase that has no hmisMlcId — forcing the backfill helper to run.
    const caseBeforeBackfill = { ...mlcCaseFixture, hmisMlcId: null };
    mlcCaseMock.update
      .mockResolvedValueOnce(caseBeforeBackfill)        // 1st update — user-triggered (with stamping)
      .mockResolvedValueOnce({ ...caseBeforeBackfill, hmisMlcId: 'HMIS-MLC-1' }); // 2nd update — HMIS-id backfill

    await recordExamination(
      buildReq({ body: { examinerName: 'Dr. B' } } as Partial<Request>),
      buildRes()
    );

    // Two update calls fired: one user-triggered, one HMIS-id backfill.
    expect(mlcCaseMock.update).toHaveBeenCalledTimes(2);

    const userUpdateArgs = mlcCaseMock.update.mock.calls[0][0];
    expect(userUpdateArgs.data.updatedBy).toBe('alice');
    expect(userUpdateArgs.data.updatedById).toBe(42);

    const backfillArgs = mlcCaseMock.update.mock.calls[1][0];
    // Backfill: hmisMlcId present, attribution absent (exempt).
    expect(backfillArgs.data.hmisMlcId).toBe('HMIS-MLC-1');
    expect(backfillArgs.data.updatedBy).toBeUndefined();
    expect(backfillArgs.data.updatedById).toBeUndefined();
  });
});
