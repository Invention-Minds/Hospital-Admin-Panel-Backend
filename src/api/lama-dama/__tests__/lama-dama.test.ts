import type { Request, Response } from 'express';

// Sprint 4b.6 — lama-dama.controller.ts now uses the singleton.
const lamaRecordMock = {
  create: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
};
const damaRecordMock = {
  create: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
};
const emergencyMock = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    lamaRecord: lamaRecordMock,
    damaRecord: damaRecordMock,
    emergency: emergencyMock,
  },
}));

// Block GCS import-time initialisation.
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
  pushLamaCase,
  pushLamaUpdate,
  pushDamaCase,
  pushDamaUpdate,
} from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import {
  createLamaRecord,
  createDamaRecord,
  updateLamaRecord,
  updateDamaRecord,
  getLamaRecord,
  getDamaRecord,
  getAllLamaRecords,
  getAllDamaRecords,
  buildLamaCreatePayload,
  buildLamaUpdatePayload,
  buildDamaCreatePayload,
  buildDamaUpdatePayload,
} from '../lama-dama.controller';

const mockedPushLamaCase = pushLamaCase as jest.MockedFunction<typeof pushLamaCase>;
const mockedPushLamaUpdate = pushLamaUpdate as jest.MockedFunction<typeof pushLamaUpdate>;
const mockedPushDamaCase = pushDamaCase as jest.MockedFunction<typeof pushDamaCase>;
const mockedPushDamaUpdate = pushDamaUpdate as jest.MockedFunction<typeof pushDamaUpdate>;
const mockedCreateHmisAuditLog = createHmisAuditLog as jest.MockedFunction<
  typeof createHmisAuditLog
>;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const emergencyFixture = {
  id: 42,
  prn: '1001',
  patientName: 'John Doe',
  status: 'arrived',
};

const lamaFixture = {
  id: 1,
  emergencyId: 42,
  lamaTime: new Date('2026-04-18T12:00:00Z'),
  doctorAdvice: 'Stay for 24h observation',
  riskExplained: true,
  patientSignature: 'https://gcs/sig-patient.png',
  witnessName: 'Jane Family',
  witnessSignature: 'https://gcs/sig-witness.png',
  reasonForLama: 'Family emergency',
  hmisLamaId: null as string | null,
  createdAt: new Date(),
  createdBy: 'reception-1',
};

const damaFixture = {
  id: 2,
  emergencyId: 43,
  dischargeTime: new Date('2026-04-18T13:00:00Z'),
  doctorRecommendation: 'Continue IV antibiotics for 3 more days',
  patientDeclinesAdvice: true,
  patientSignature: 'https://gcs/sig-patient-2.png',
  witnessName: 'Family Member',
  witnessSignature: 'https://gcs/sig-witness-2.png',
  followUpAdvice: 'Return if fever persists',
  hmisDamaId: null as string | null,
  createdAt: new Date(),
  createdBy: 'reception-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  emergencyMock.findUnique.mockResolvedValue(emergencyFixture);
  emergencyMock.update.mockResolvedValue({ ...emergencyFixture, status: 'LAMA' });
  lamaRecordMock.findUnique.mockResolvedValue(null);
  lamaRecordMock.create.mockResolvedValue(lamaFixture);
  lamaRecordMock.update.mockResolvedValue(lamaFixture);
  damaRecordMock.findUnique.mockResolvedValue(null);
  damaRecordMock.create.mockResolvedValue(damaFixture);
  damaRecordMock.update.mockResolvedValue(damaFixture);
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 1,
    direction: 'push',
    module: 'lama',
    action: 'lama_created',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    quarantinedAt: null,
    createdAt: new Date(),
  });
});

// =====================================================================
// createLamaRecord — 4 tests (happy + HMIS failure + 2 sanity)
// =====================================================================
describe('createLamaRecord — happy path (inline-await, persists hmisLamaId)', () => {
  it(
    'creates LAMA, pushes to HMIS with exact payload, persists hmisLamaId, flips emergency status, ' +
      'success audit, returns 201',
    async () => {
      mockedPushLamaCase.mockResolvedValue({ id: 'HMIS-LAMA-7' });
      lamaRecordMock.update.mockResolvedValue({ ...lamaFixture, hmisLamaId: 'HMIS-LAMA-7' });

      const req = {
        body: {
          emergencyId: '42',
          doctorAdvice: 'Stay for 24h observation',
          riskExplained: true,
          patientSignature: 'https://gcs/sig-patient.png',
          witnessName: 'Jane Family',
          witnessSignature: 'https://gcs/sig-witness.png',
          reasonForLama: 'Family emergency',
        },
        user: { id: 1, username: 'reception-1' },
      } as unknown as Request;
      const res = buildRes();

      await createLamaRecord(req, res);

      expect(lamaRecordMock.create).toHaveBeenCalledTimes(1);
      expect(emergencyMock.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { status: 'LAMA' },
      });
      expect(mockedPushLamaCase).toHaveBeenCalledWith(buildLamaCreatePayload(lamaFixture));
      expect(lamaRecordMock.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { hmisLamaId: 'HMIS-LAMA-7' },
      });

      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.module).toBe('lama');
      expect(auditCall.action).toBe('lama_created');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('lama-record');
      expect(response.result).toEqual({ id: 'HMIS-LAMA-7' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisLamaId).toBe('HMIS-LAMA-7');
    }
  );
});

describe('createLamaRecord — HMIS failure path', () => {
  it('still returns 201, no hmisLamaId, failure audit captures status + detail', async () => {
    mockedPushLamaCase.mockRejectedValue(
      Object.assign(new Error('bad request'), {
        response: { status: 400, data: { err: 'missing field' } },
      })
    );

    const req = {
      body: { emergencyId: '42', doctorAdvice: 'Advice', reasonForLama: 'reason' },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await createLamaRecord(req, res);

    expect(lamaRecordMock.create).toHaveBeenCalledTimes(1);
    expect(lamaRecordMock.update).not.toHaveBeenCalled(); // no hmisLamaId update on failure

    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(400);
    expect(response.error.detail).toEqual({ err: 'missing field' });

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.hmisLamaId).toBeNull();
  });
});

describe('createLamaRecord — sanity: missing doctorAdvice', () => {
  it('returns 400 and never touches HMIS', async () => {
    const req = {
      body: { emergencyId: '42', reasonForLama: 'reason' }, // no doctorAdvice
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await createLamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(lamaRecordMock.create).not.toHaveBeenCalled();
    expect(mockedPushLamaCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

describe('createLamaRecord — sanity: duplicate LAMA for emergency', () => {
  it('returns 400 and never touches HMIS when LAMA already exists', async () => {
    lamaRecordMock.findUnique.mockResolvedValue(lamaFixture);

    const req = {
      body: { emergencyId: '42', doctorAdvice: 'Advice', reasonForLama: 'reason' },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await createLamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(lamaRecordMock.create).not.toHaveBeenCalled();
    expect(mockedPushLamaCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// createDamaRecord — 4 tests
// =====================================================================
describe('createDamaRecord — happy path (inline-await, persists hmisDamaId)', () => {
  it(
    'creates DAMA, pushes to HMIS with exact payload, persists hmisDamaId, flips emergency status, ' +
      'success audit, returns 201',
    async () => {
      mockedPushDamaCase.mockResolvedValue({ id: 'HMIS-DAMA-9' });
      damaRecordMock.update.mockResolvedValue({ ...damaFixture, hmisDamaId: 'HMIS-DAMA-9' });

      const req = {
        body: {
          emergencyId: '43',
          doctorRecommendation: 'Continue IV antibiotics for 3 more days',
          patientDeclinesAdvice: true,
          patientSignature: 'https://gcs/sig-patient-2.png',
          witnessName: 'Family Member',
          witnessSignature: 'https://gcs/sig-witness-2.png',
          followUpAdvice: 'Return if fever persists',
        },
        user: { id: 1, username: 'reception-1' },
      } as unknown as Request;
      const res = buildRes();

      await createDamaRecord(req, res);

      expect(damaRecordMock.create).toHaveBeenCalledTimes(1);
      expect(emergencyMock.update).toHaveBeenCalledWith({
        where: { id: 43 },
        data: { status: 'DAMA' },
      });
      expect(mockedPushDamaCase).toHaveBeenCalledWith(buildDamaCreatePayload(damaFixture));
      expect(damaRecordMock.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { hmisDamaId: 'HMIS-DAMA-9' },
      });

      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.module).toBe('dama');
      expect(auditCall.action).toBe('dama_created');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('dama-record');
      expect(response.result).toEqual({ id: 'HMIS-DAMA-9' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisDamaId).toBe('HMIS-DAMA-9');
    }
  );
});

describe('createDamaRecord — HMIS failure path', () => {
  it('still returns 201, no hmisDamaId, failure audit captures status 503', async () => {
    mockedPushDamaCase.mockRejectedValue(
      Object.assign(new Error('down'), {
        response: { status: 503, data: 'unavailable' },
      })
    );

    const req = {
      body: { emergencyId: '43', doctorRecommendation: 'IV antibiotics' },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await createDamaRecord(req, res);

    expect(damaRecordMock.create).toHaveBeenCalledTimes(1);
    expect(damaRecordMock.update).not.toHaveBeenCalled();

    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(503);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.hmisDamaId).toBeNull();
  });
});

describe('createDamaRecord — sanity: missing doctorRecommendation', () => {
  it('returns 400 and never touches HMIS', async () => {
    const req = {
      body: { emergencyId: '43' }, // no doctorRecommendation
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await createDamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(damaRecordMock.create).not.toHaveBeenCalled();
    expect(mockedPushDamaCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

describe('createDamaRecord — sanity: duplicate DAMA for emergency', () => {
  it('returns 400 and never touches HMIS when DAMA already exists', async () => {
    damaRecordMock.findUnique.mockResolvedValue(damaFixture);

    const req = {
      body: { emergencyId: '43', doctorRecommendation: 'IV antibiotics' },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await createDamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(damaRecordMock.create).not.toHaveBeenCalled();
    expect(mockedPushDamaCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// updateLamaRecord — 3 tests (with opportunistic backfill)
// =====================================================================
describe('updateLamaRecord — happy path (with hmisLamaId backfill)', () => {
  it(
    'updates LAMA, pushes lama_updated via wrapper, backfills hmisLamaId when previously null',
    async () => {
      lamaRecordMock.update.mockResolvedValue({ ...lamaFixture, doctorAdvice: 'Revised advice' });
      mockedPushLamaUpdate.mockResolvedValue({ id: 'HMIS-LAMA-7' });

      const req = {
        params: { id: '1' },
        body: { doctorAdvice: 'Revised advice' },
        user: { id: 1, username: 'dr-x' },
      } as unknown as Request;
      const res = buildRes();

      await updateLamaRecord(req, res);

      // Two updates: (1) field update, (2) hmisLamaId backfill since fixture.hmisLamaId is null
      expect(lamaRecordMock.update).toHaveBeenCalledTimes(2);
      const backfill = lamaRecordMock.update.mock.calls[1][0];
      expect(backfill).toEqual({ where: { id: 1 }, data: { hmisLamaId: 'HMIS-LAMA-7' } });

      expect(mockedPushLamaUpdate).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.action).toBe('lama_updated');

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    }
  );
});

describe('updateLamaRecord — HMIS failure path', () => {
  it('returns 200 with local update; failure audit captures HMIS 500', async () => {
    lamaRecordMock.update.mockResolvedValue(lamaFixture);
    mockedPushLamaUpdate.mockRejectedValue(
      Object.assign(new Error('internal'), { response: { status: 500 } })
    );

    const req = {
      params: { id: '1' },
      body: { doctorAdvice: 'Revised' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await updateLamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
  });
});

describe('updateLamaRecord — sanity: record not found (update throws)', () => {
  it('returns 500 and never calls HMIS', async () => {
    lamaRecordMock.update.mockRejectedValue(new Error('Record not found'));

    const req = {
      params: { id: '999' },
      body: { doctorAdvice: 'X' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await updateLamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect(mockedPushLamaUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// updateDamaRecord — 3 tests
// =====================================================================
describe('updateDamaRecord — happy path (with hmisDamaId backfill)', () => {
  it('updates DAMA, pushes dama_updated, backfills hmisDamaId when null', async () => {
    damaRecordMock.update.mockResolvedValue({ ...damaFixture, followUpAdvice: 'New advice' });
    mockedPushDamaUpdate.mockResolvedValue({ id: 'HMIS-DAMA-9' });

    const req = {
      params: { id: '2' },
      body: { followUpAdvice: 'New advice' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await updateDamaRecord(req, res);

    expect(damaRecordMock.update).toHaveBeenCalledTimes(2);
    const backfill = damaRecordMock.update.mock.calls[1][0];
    expect(backfill).toEqual({ where: { id: 2 }, data: { hmisDamaId: 'HMIS-DAMA-9' } });
    expect(mockedPushDamaUpdate).toHaveBeenCalledTimes(1);

    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.action).toBe('dama_updated');

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
  });
});

describe('updateDamaRecord — HMIS failure path', () => {
  it('returns 200 with local update; failure audit captures HMIS 502', async () => {
    damaRecordMock.update.mockResolvedValue(damaFixture);
    mockedPushDamaUpdate.mockRejectedValue(
      Object.assign(new Error('gateway'), { response: { status: 502 } })
    );

    const req = {
      params: { id: '2' },
      body: { followUpAdvice: 'X' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await updateDamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
  });
});

describe('updateDamaRecord — sanity: record not found (update throws)', () => {
  it('returns 500 and never calls HMIS', async () => {
    damaRecordMock.update.mockRejectedValue(new Error('Record not found'));

    const req = {
      params: { id: '999' },
      body: { followUpAdvice: 'X' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await updateDamaRecord(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect(mockedPushDamaUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Read endpoints — 4 contract tests
// =====================================================================
describe('getLamaRecord — contract', () => {
  it('returns LAMA with emergency fields included', async () => {
    lamaRecordMock.findUnique.mockResolvedValue({
      ...lamaFixture,
      emergency: {
        prn: '1001',
        patientName: 'John',
        phoneNumber: '99999',
        presentingComplaint: 'chest pain',
      },
    });

    const req = { params: { id: '1' } } as unknown as Request;
    const res = buildRes();

    await getLamaRecord(req, res);

    expect(lamaRecordMock.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            phoneNumber: true,
            presentingComplaint: true,
          },
        },
      },
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    expect(mockedPushLamaCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

describe('getDamaRecord — contract', () => {
  it('returns DAMA with emergency fields included', async () => {
    damaRecordMock.findUnique.mockResolvedValue({
      ...damaFixture,
      emergency: {
        prn: '1002',
        patientName: 'Jane',
        phoneNumber: '88888',
        presentingComplaint: 'fever',
      },
    });

    const req = { params: { id: '2' } } as unknown as Request;
    const res = buildRes();

    await getDamaRecord(req, res);

    expect(damaRecordMock.findUnique).toHaveBeenCalledWith({
      where: { id: 2 },
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            phoneNumber: true,
            presentingComplaint: true,
          },
        },
      },
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    expect(mockedPushDamaCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

describe('getAllLamaRecords — contract', () => {
  it('returns all LAMA records ordered by createdAt desc', async () => {
    lamaRecordMock.findMany.mockResolvedValue([lamaFixture]);

    const req = {} as unknown as Request;
    const res = buildRes();

    await getAllLamaRecords(req, res);

    expect(lamaRecordMock.findMany).toHaveBeenCalledWith({
      include: {
        emergency: { select: { prn: true, patientName: true } },
        admission: { select: { admissionNo: true, prn: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    expect(mockedPushLamaCase).not.toHaveBeenCalled();
    expect(mockedPushLamaUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

describe('getAllDamaRecords — contract', () => {
  it('returns all DAMA records ordered by createdAt desc', async () => {
    damaRecordMock.findMany.mockResolvedValue([damaFixture]);

    const req = {} as unknown as Request;
    const res = buildRes();

    await getAllDamaRecords(req, res);

    expect(damaRecordMock.findMany).toHaveBeenCalledWith({
      include: {
        emergency: { select: { prn: true, patientName: true } },
        admission: { select: { admissionNo: true, prn: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    expect(mockedPushDamaCase).not.toHaveBeenCalled();
    expect(mockedPushDamaUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// Use unused push imports so TS doesn't complain (exists for symmetry with client).
void pushLamaUpdate;
void pushDamaUpdate;
