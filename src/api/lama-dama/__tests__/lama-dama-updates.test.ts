/**
 * Sprint 4b Phase 4b.1 — LAMA/DAMA update-handler stamping tests.
 *
 * Coverage:
 *   - updateLamaRecord: stamps updatedBy + updatedById; client-supplied attribution ignored.
 *   - updateDamaRecord: stamps updatedBy + updatedById.
 *   - uploadLamaPatientSignature: delegates to uploadSignatureHandler — stamps both.
 *   - uploadDamaPatientSignature: delegates — stamps both.
 *   - Rapid-update stamp wins — two sequential updates from different users each stamp.
 *
 * 5 tests total.
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
const emergencyMock = { findUnique: jest.fn(), update: jest.fn() };

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
  pushLamaUpdate: jest.fn().mockResolvedValue({ id: 'HMIS-LAMA-1' }),
  pushDamaUpdate: jest.fn().mockResolvedValue({ id: 'HMIS-DAMA-1' }),
  pushLamaCase: jest.fn(),
  pushDamaCase: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import {
  updateLamaRecord,
  updateDamaRecord,
  uploadLamaPatientSignature,
  uploadDamaPatientSignature,
} from '../lama-dama.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({
    params: { id: '1' },
    body: {},
    user: { id: 42, username: 'alice' },
    ...overrides,
  }) as unknown as Request;

const makeFile = (): Express.Multer.File => ({
  buffer: Buffer.from('sig'),
  originalname: 'sig.png',
  mimetype: 'image/png',
  size: 3,
  fieldname: 'file',
  encoding: '7bit',
  destination: '',
  filename: '',
  path: '',
}) as unknown as Express.Multer.File;

const lamaFixture = { id: 1, emergencyId: 7, hmisLamaId: 'HMIS-LAMA-1' };
const damaFixture = { id: 1, emergencyId: 7, hmisDamaId: 'HMIS-DAMA-1' };

beforeEach(() => {
  jest.clearAllMocks();
  lamaRecordMock.findUnique.mockResolvedValue(lamaFixture);
  lamaRecordMock.update.mockResolvedValue(lamaFixture);
  damaRecordMock.findUnique.mockResolvedValue(damaFixture);
  damaRecordMock.update.mockResolvedValue(damaFixture);
});

describe('Sprint 4b.1 — LAMA/DAMA update attribution', () => {
  it('updateLamaRecord stamps updatedBy+updatedById AND strips client-supplied attribution', async () => {
    const req = buildReq({
      body: {
        doctorAdvice: 'revised advice',
        // Impersonation attempt — must be stripped + overwritten.
        updatedBy: 'attacker',
        updatedById: 999,
        createdBy: 'attacker',
        createdById: 999,
      },
    } as Partial<Request>);

    await updateLamaRecord(req, buildRes());

    const args = lamaRecordMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      doctorAdvice: 'revised advice',
      updatedBy: 'alice',
      updatedById: 42,
    }));
    expect(args.data.updatedBy).not.toBe('attacker');
    expect(args.data.updatedById).not.toBe(999);
    expect(args.data.createdBy).toBeUndefined();
    expect(args.data.createdById).toBeUndefined();
  });

  it('updateDamaRecord stamps updatedBy + updatedById from JWT', async () => {
    const req = buildReq({
      body: { doctorRecommendation: 'new recommendation' },
    } as Partial<Request>);

    await updateDamaRecord(req, buildRes());

    const args = damaRecordMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      doctorRecommendation: 'new recommendation',
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('uploadLamaPatientSignature stamps updatedBy + updatedById on LAMA row', async () => {
    await uploadLamaPatientSignature(
      buildReq({ file: makeFile() } as Partial<Request>),
      buildRes()
    );
    const args = lamaRecordMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
    expect(args.data.patientSignature).toBeDefined();
  });

  it('uploadDamaPatientSignature stamps updatedBy + updatedById on DAMA row', async () => {
    await uploadDamaPatientSignature(
      buildReq({ file: makeFile() } as Partial<Request>),
      buildRes()
    );
    const args = damaRecordMock.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
    expect(args.data.patientSignature).toBeDefined();
  });

  it('E3: rapid updates — each call stamps its own JWT identity', async () => {
    await updateLamaRecord(
      buildReq({ body: { doctorAdvice: 'a1' }, user: { id: 42, username: 'alice' } } as Partial<Request>),
      buildRes()
    );
    await updateLamaRecord(
      buildReq({ body: { doctorAdvice: 'a2' }, user: { id: 99, username: 'bob' } } as Partial<Request>),
      buildRes()
    );

    expect(lamaRecordMock.update).toHaveBeenCalledTimes(2);
    const first = lamaRecordMock.update.mock.calls[0][0].data;
    const second = lamaRecordMock.update.mock.calls[1][0].data;
    expect(first.updatedBy).toBe('alice');
    expect(first.updatedById).toBe(42);
    expect(second.updatedBy).toBe('bob');
    expect(second.updatedById).toBe(99);
  });
});
