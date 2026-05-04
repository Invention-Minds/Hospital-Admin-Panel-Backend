import type { Request, Response } from 'express';

// Sprint 4b.6 — mlc.controller.ts now uses the src/service/prisma-client singleton.
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

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    mlcCase: mlcCaseMock,
    emergency: emergencyMock,
  },
}));

// Block GCS initialization (imported at module-load time in mlc.controller).
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

import { pushMlcCase, pushMlcUpdate } from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import {
  registerMlcCase,
  recordExamination,
  recordSampleCollection,
  submitReport,
  getPendingReports,
  buildMlcRegisterPayload,
  buildMlcExaminationPayload,
  buildMlcSamplesPayload,
  buildMlcReportPayload,
} from '../mlc.controller';

const mockedPushMlcCase = pushMlcCase as jest.MockedFunction<typeof pushMlcCase>;
const mockedPushMlcUpdate = pushMlcUpdate as jest.MockedFunction<typeof pushMlcUpdate>;
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
};

const mlcFixture = {
  id: 7,
  emergencyId: 42,
  mlcNo: 'MLC-2026-0001',
  caseType: 'accident',
  policeStationName: 'Central',
  fir_No: 'FIR-999',
  fir_Date: new Date('2026-04-18T00:00:00Z'),
  investigatingOfficer: 'Officer X',
  patientConsent: false,
  consentTime: null as Date | null,
  consentSignature: null as string | null,
  firstExaminationDone: false,
  firstExaminationTime: null as Date | null,
  examinerName: null as string | null,
  examinerSignature: null as string | null,
  injuries: '',
  photographsTaken: false,
  photoUrls: null as string | null,
  samplesCollected: null as string | null,
  sampleStorageInfo: null as string | null,
  followUpExams: null as string | null,
  finalReport: null as string | null,
  reportSubmittedTo: null as string | null,
  submissionDate: null as Date | null,
  submissionProof: null as string | null,
  status: 'documented',
  hmisMlcId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'reception-1',
  updatedBy: null as string | null,
};

beforeEach(() => {
  jest.clearAllMocks();
  emergencyMock.findUnique.mockResolvedValue(emergencyFixture);
  mlcCaseMock.findUnique.mockResolvedValue(null); // no existing MLC by default
  mlcCaseMock.findFirst.mockResolvedValue(null); // no prior MLC for number generation
  mlcCaseMock.create.mockResolvedValue(mlcFixture);
  mlcCaseMock.update.mockResolvedValue(mlcFixture);
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 1,
    direction: 'push',
    module: 'mlc',
    action: 'mlc_registered',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

// =====================================================================
// registerMlcCase — 3 tests
// =====================================================================
describe('registerMlcCase — happy path (inline-await, persists hmisMlcId)', () => {
  it(
    'creates MLC, pushes to HMIS via wrapper with exact payload, persists hmisMlcId, ' +
      'success audit log, returns 201',
    async () => {
      mockedPushMlcCase.mockResolvedValue({ id: 'HMIS-MLC-1' });
      mlcCaseMock.update.mockResolvedValue({
        ...mlcFixture,
        hmisMlcId: 'HMIS-MLC-1',
      });

      const req = {
        body: {
          emergencyId: '42',
          caseType: 'accident',
          policeStationName: 'Central',
          fir_No: 'FIR-999',
          fir_Date: '2026-04-18',
        },
        user: { id: 1, username: 'reception-1' },
      } as unknown as Request;
      const res = buildRes();

      await registerMlcCase(req, res);

      expect(mlcCaseMock.create).toHaveBeenCalledTimes(1);
      expect(mockedPushMlcCase).toHaveBeenCalledTimes(1);
      expect(mockedPushMlcCase).toHaveBeenCalledWith(buildMlcRegisterPayload(mlcFixture));
      expect(mlcCaseMock.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { hmisMlcId: 'HMIS-MLC-1' },
      });

      expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.module).toBe('mlc');
      expect(auditCall.action).toBe('mlc_registered');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('mlc-case');
      expect(response.result).toEqual({ id: 'HMIS-MLC-1' });

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.hmisMlcId).toBe('HMIS-MLC-1');
    }
  );
});

describe('registerMlcCase — HMIS failure path', () => {
  it('still returns 201, no hmisMlcId, failure audit captures status + detail', async () => {
    const hmisError = Object.assign(new Error('Request failed with status 503'), {
      response: { status: 503, data: { err: 'HMIS down' } },
    });
    mockedPushMlcCase.mockRejectedValue(hmisError);

    const req = {
      body: { emergencyId: '42', caseType: 'accident' },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await registerMlcCase(req, res);

    expect(mlcCaseMock.create).toHaveBeenCalledTimes(1);
    // No hmisMlcId update call on failure.
    expect(mlcCaseMock.update).not.toHaveBeenCalled();

    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(503);
    expect(response.error.detail).toEqual({ err: 'HMIS down' });

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.hmisMlcId).toBeNull();
  });
});

describe('registerMlcCase — sanity: duplicate MLC for emergency', () => {
  it('returns 400 and never calls HMIS when MLC already exists for the emergency', async () => {
    mlcCaseMock.findUnique.mockResolvedValue(mlcFixture); // existing MLC

    const req = {
      body: { emergencyId: '42', caseType: 'accident' },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await registerMlcCase(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mlcCaseMock.create).not.toHaveBeenCalled();
    expect(mockedPushMlcCase).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// recordExamination — 3 tests
// =====================================================================
describe('recordExamination — happy path', () => {
  it('updates examination fields, pushes examination event, success audit, returns 200', async () => {
    const updatedMlc = {
      ...mlcFixture,
      firstExaminationDone: true,
      firstExaminationTime: new Date('2026-04-18T10:00:00Z'),
      examinerName: 'Dr. Examiner',
      injuries: 'Head trauma',
      status: 'examination-done',
    };
    mlcCaseMock.update.mockResolvedValue(updatedMlc);
    mockedPushMlcUpdate.mockResolvedValue({ id: 'HMIS-MLC-1' });

    const req = {
      params: { id: '7' },
      body: {
        examinerName: 'Dr. Examiner',
        injuries: 'Head trauma',
        photographsTaken: false,
      },
      user: { id: 1, username: 'dr-examiner' },
    } as unknown as Request;
    const res = buildRes();

    await recordExamination(req, res);

    // Two update calls: (1) the examination fields, (2) the hmisMlcId backfill because the
    // fixture's hmisMlcId was null (register-push didn't persist it earlier).
    expect(mlcCaseMock.update).toHaveBeenCalledTimes(2);
    const firstUpdateArgs = mlcCaseMock.update.mock.calls[0][0];
    expect(firstUpdateArgs.data.status).toBe('examination-done');
    const secondUpdateArgs = mlcCaseMock.update.mock.calls[1][0];
    expect(secondUpdateArgs).toEqual({
      where: { id: 7 },
      data: { hmisMlcId: 'HMIS-MLC-1' },
    });

    expect(mockedPushMlcUpdate).toHaveBeenCalledWith(
      buildMlcExaminationPayload(updatedMlc, 'dr-examiner')
    );
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.action).toBe('mlc_examination');

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
  });
});

describe('recordExamination — HMIS failure path', () => {
  it('returns 200 with local update; failure audit captures HMIS 500', async () => {
    mlcCaseMock.update.mockResolvedValue({
      ...mlcFixture,
      firstExaminationDone: true,
      status: 'examination-done',
    });
    const hmisError = Object.assign(new Error('boom'), {
      response: { status: 500, data: 'internal' },
    });
    mockedPushMlcUpdate.mockRejectedValue(hmisError);

    const req = {
      params: { id: '7' },
      body: { examinerName: 'Dr. X', injuries: 'minor' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await recordExamination(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(500);
  });
});

describe('recordExamination — sanity: MLC not found (prisma update throws)', () => {
  it('returns 500 and never calls HMIS', async () => {
    mlcCaseMock.update.mockRejectedValue(new Error('Record not found'));

    const req = {
      params: { id: '999' },
      body: { examinerName: 'Dr. X', injuries: 'x' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await recordExamination(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect(mockedPushMlcUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// recordSampleCollection — 3 tests
// =====================================================================
describe('recordSampleCollection — happy path', () => {
  it('updates sample fields, pushes samples_collected event, success audit, returns 200', async () => {
    const updatedMlc = {
      ...mlcFixture,
      samplesCollected: 'Blood',
      sampleStorageInfo: 'Freezer A',
      status: 'samples-collected',
    };
    mlcCaseMock.update.mockResolvedValue(updatedMlc);
    mockedPushMlcUpdate.mockResolvedValue({ id: 'HMIS-MLC-1' });

    const req = {
      params: { id: '7' },
      body: { samplesCollected: 'Blood', sampleStorageInfo: 'Freezer A' },
      user: { id: 1, username: 'nurse-1' },
    } as unknown as Request;
    const res = buildRes();

    await recordSampleCollection(req, res);

    expect(mockedPushMlcUpdate).toHaveBeenCalledWith(
      buildMlcSamplesPayload(updatedMlc, 'nurse-1')
    );
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.action).toBe('mlc_samples_collected');
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
  });
});

describe('recordSampleCollection — HMIS failure path', () => {
  it('returns 200; failure audit captures HMIS 502', async () => {
    mlcCaseMock.update.mockResolvedValue({
      ...mlcFixture,
      samplesCollected: 'Blood',
      status: 'samples-collected',
    });
    const hmisError = Object.assign(new Error('bad gateway'), {
      response: { status: 502 },
    });
    mockedPushMlcUpdate.mockRejectedValue(hmisError);

    const req = {
      params: { id: '7' },
      body: { samplesCollected: 'Blood' },
      user: { id: 1, username: 'nurse-1' },
    } as unknown as Request;
    const res = buildRes();

    await recordSampleCollection(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(502);
  });
});

describe('recordSampleCollection — sanity: MLC not found (prisma update throws)', () => {
  it('returns 500 and never calls HMIS', async () => {
    mlcCaseMock.update.mockRejectedValue(new Error('Record not found'));

    const req = {
      params: { id: '999' },
      body: { samplesCollected: 'X' },
      user: { id: 1, username: 'nurse-1' },
    } as unknown as Request;
    const res = buildRes();

    await recordSampleCollection(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect(mockedPushMlcUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// submitReport — 3 tests
// =====================================================================
describe('submitReport — happy path', () => {
  it('updates report fields, pushes report_submitted event, success audit, returns 200', async () => {
    const updatedMlc = {
      ...mlcFixture,
      finalReport: 'Final findings...',
      reportSubmittedTo: 'Police',
      submissionDate: new Date('2026-04-18T15:00:00Z'),
      status: 'report-submitted',
    };
    mlcCaseMock.update.mockResolvedValue(updatedMlc);
    mockedPushMlcUpdate.mockResolvedValue({ id: 'HMIS-MLC-1' });

    const req = {
      params: { id: '7' },
      body: { finalReport: 'Final findings...', reportSubmittedTo: 'Police' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await submitReport(req, res);

    expect(mockedPushMlcUpdate).toHaveBeenCalledWith(
      buildMlcReportPayload(updatedMlc, 'dr-x')
    );
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.action).toBe('mlc_report_submitted');
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
  });
});

describe('submitReport — HMIS failure path', () => {
  it('returns 200 with local update; failure audit captures HMIS 504', async () => {
    mlcCaseMock.update.mockResolvedValue({
      ...mlcFixture,
      finalReport: 'Final',
      status: 'report-submitted',
    });
    const hmisError = Object.assign(new Error('timeout'), {
      response: { status: 504, data: 'gateway timeout' },
    });
    mockedPushMlcUpdate.mockRejectedValue(hmisError);

    const req = {
      params: { id: '7' },
      body: { finalReport: 'Final' },
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await submitReport(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(504);
  });
});

describe('submitReport — sanity: missing finalReport', () => {
  it('returns 400 and never calls HMIS when finalReport is missing', async () => {
    const req = {
      params: { id: '7' },
      body: { reportSubmittedTo: 'Police' }, // no finalReport
      user: { id: 1, username: 'dr-x' },
    } as unknown as Request;
    const res = buildRes();

    await submitReport(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mlcCaseMock.update).not.toHaveBeenCalled();
    expect(mockedPushMlcUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// getPendingReports — 1 contract test
// =====================================================================
describe('getPendingReports — contract', () => {
  it('filters by status in [documented, examination-done, samples-collected] ordered asc', async () => {
    mlcCaseMock.findMany.mockResolvedValue([mlcFixture]);

    const req = {} as unknown as Request;
    const res = buildRes();

    await getPendingReports(req, res);

    expect(mlcCaseMock.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ['documented', 'examination-done', 'samples-collected'],
        },
      },
      include: {
        emergency: {
          select: { prn: true, patientName: true, age: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
    // Read endpoint must never call HMIS
    expect(mockedPushMlcCase).not.toHaveBeenCalled();
    expect(mockedPushMlcUpdate).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});
