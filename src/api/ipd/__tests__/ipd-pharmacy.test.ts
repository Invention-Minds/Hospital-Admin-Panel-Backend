import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdAdmission: { findUnique: jest.fn() },
    ipdPrescription: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    ipdMedicationLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    prescription: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIpdPrescription: jest.fn(),
  pushIpdPrescriptionDiscontinue: jest.fn(),
  pushIpdMedicationAdmin: jest.fn(),
  pushIpdAdmission: jest.fn(),
  pushIPDDischarge: jest.fn(),
  pushIpdTransfer: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import prisma from '../../../service/prisma-client';
import {
  pushIpdPrescription,
  pushIpdPrescriptionDiscontinue,
  pushIpdMedicationAdmin,
} from '../../hmis-sync/hmis-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import {
  reviewCarryoverPrescriptions,
  continuePrescription,
  modifyPrescription,
  discontinuePrescription,
  administerMedication,
  skipMedication,
  getPendingMedications,
  getMedicationAdministrationRecord,
  buildIpdPrescriptionPayload,
  buildIpdPrescriptionDiscontinuePayload,
  buildIpdMedicationAdminPayload,
} from '../ipd-prescription.controller';

const mockedPrisma = prisma as unknown as {
  ipdAdmission: { findUnique: jest.Mock };
  ipdPrescription: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  ipdMedicationLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  prescription: { findMany: jest.Mock };
};
const mockedPushIpdPrescription = pushIpdPrescription as jest.MockedFunction<
  typeof pushIpdPrescription
>;
const mockedPushIpdPrescriptionDiscontinue =
  pushIpdPrescriptionDiscontinue as jest.MockedFunction<
    typeof pushIpdPrescriptionDiscontinue
  >;
const mockedPushIpdMedicationAdmin = pushIpdMedicationAdmin as jest.MockedFunction<
  typeof pushIpdMedicationAdmin
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

/** Flush microtasks so the fire-and-forget promise chain runs its .then() and .catch() handlers. */
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const admissionFixture = {
  id: 'adm-1',
  prn: '1001',
  status: 'admitted',
};

const rxFixture = {
  id: 'rx-1',
  admissionId: 'adm-1',
  prescriptionId: 'PRE-0001',
  prescribedBy: 'Dr. Smith',
  prescribedDate: new Date('2026-04-18T10:00:00Z'),
  carryOverFrom: null as string | null,
  genericName: 'Paracetamol',
  brandName: 'Crocin',
  dose: '500mg',
  frequency: 'TID',
  duration: '3 days',
  route: 'oral',
  instructions: 'After meals',
  quantity: 9,
  isCarryOver: false,
  lastAdminTime: null as Date | null,
  nextAdminTime: null as Date | null,
  adminStatus: 'pending',
  status: 'active',
  hmisRxId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'reception-1',
  updatedBy: null,
};

const marLogFixture = {
  id: 'mar-1',
  prescriptionId: 'rx-1',
  admissionId: 'adm-1',
  administeredAt: new Date('2026-04-18T14:00:00Z'),
  administeredBy: 'nurse-1',
  quantity: 1,
  route: 'oral',
  remarks: null as string | null,
  createdAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.ipdAdmission.findUnique.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdPrescription.create.mockResolvedValue(rxFixture);
  mockedPrisma.ipdPrescription.update.mockResolvedValue(rxFixture);
  mockedPrisma.ipdPrescription.findUnique.mockResolvedValue(rxFixture);
  mockedPrisma.ipdMedicationLog.create.mockResolvedValue(marLogFixture);
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 1,
    direction: 'push',
    module: 'ipd-pharmacy',
    action: 'ipd_prescription_continued',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

// =====================================================================
// continuePrescription — 3 tests (happy + HMIS failure + sanity)
// =====================================================================
describe('continuePrescription — happy path (fire-and-forget)', () => {
  it('responds 201 immediately, then fires HMIS push with exact payload; audit log success', async () => {
    mockedPushIpdPrescription.mockResolvedValue({ id: 'HMIS-RX-1' });

    const req = {
      params: { admissionId: 'adm-1' },
      body: {
        prescriptionId: 'PRE-0001',
        genericName: 'Paracetamol',
        dose: '500mg',
        frequency: 'TID',
        duration: '3 days',
        prescribedBy: 'Dr. Smith',
      },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await continuePrescription(req, res);

    // Response sent before HMIS push awaited
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data).toEqual(rxFixture);
    // Body must NOT contain hmis-side ids under fire-and-forget
    expect(body.data.hmisRxId).toBeNull();

    // Flush microtasks so fire-and-forget resolves
    await flushMicrotasks();

    expect(mockedPushIpdPrescription).toHaveBeenCalledTimes(1);
    expect(mockedPushIpdPrescription).toHaveBeenCalledWith(
      buildIpdPrescriptionPayload(rxFixture, 'continued')
    );
    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.module).toBe('ipd-pharmacy');
    expect(auditCall.action).toBe('ipd_prescription_continued');
  });
});

describe('continuePrescription — HMIS failure (fire-and-forget)', () => {
  it('responds 201 immediately; later, failure audit log captures status + detail', async () => {
    const hmisError = Object.assign(new Error('Request failed with status 502'), {
      response: { status: 502, data: { err: 'bad gateway' } },
    });
    mockedPushIpdPrescription.mockRejectedValue(hmisError);

    const req = {
      params: { admissionId: 'adm-1' },
      body: {
        genericName: 'Paracetamol',
        dose: '500mg',
        frequency: 'TID',
        duration: '3 days',
        prescribedBy: 'Dr. Smith',
      },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await continuePrescription(req, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);

    await flushMicrotasks();

    expect(mockedPushIpdPrescription).toHaveBeenCalledTimes(1);
    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(502);
    expect(response.error.detail).toEqual({ err: 'bad gateway' });
  });
});

describe('continuePrescription — sanity guard', () => {
  it('returns 400 and never calls HMIS when required fields are missing', async () => {
    const req = {
      params: { admissionId: 'adm-1' },
      body: { genericName: 'Paracetamol' /* missing dose, frequency, duration, prescribedBy */ },
      user: { id: 1, username: 'reception-1' },
    } as unknown as Request;
    const res = buildRes();

    await continuePrescription(req, res);
    await flushMicrotasks();

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(mockedPrisma.ipdPrescription.create).not.toHaveBeenCalled();
    expect(mockedPushIpdPrescription).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// modifyPrescription — 3 tests
// =====================================================================
describe('modifyPrescription — happy path (fire-and-forget)', () => {
  it('responds 200 immediately; later, HMIS push called with modified payload', async () => {
    const updatedRx = { ...rxFixture, dose: '1000mg' };
    mockedPrisma.ipdPrescription.update.mockResolvedValue(updatedRx);
    mockedPushIpdPrescription.mockResolvedValue({ id: 'HMIS-RX-1' });

    const req = {
      params: { prescriptionId: 'rx-1' },
      body: { dose: '1000mg' },
      user: { id: 1, username: 'dr-smith' },
    } as unknown as Request;
    const res = buildRes();

    await modifyPrescription(req, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);

    await flushMicrotasks();

    expect(mockedPushIpdPrescription).toHaveBeenCalledWith(
      buildIpdPrescriptionPayload(updatedRx, 'modified')
    );
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.action).toBe('ipd_prescription_modified');
  });
});

describe('modifyPrescription — HMIS failure (fire-and-forget)', () => {
  it('still responds 200; failure audit captures HMIS 504', async () => {
    const hmisError = Object.assign(new Error('timeout'), {
      response: { status: 504, data: 'gateway timeout' },
    });
    mockedPushIpdPrescription.mockRejectedValue(hmisError);

    const req = {
      params: { prescriptionId: 'rx-1' },
      body: { dose: '1000mg' },
      user: { id: 1, username: 'dr-smith' },
    } as unknown as Request;
    const res = buildRes();

    await modifyPrescription(req, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);

    await flushMicrotasks();
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(504);
  });
});

describe('modifyPrescription — sanity: error surfaces when prescription missing', () => {
  it('returns 500 and never calls HMIS when the prescription update throws', async () => {
    mockedPrisma.ipdPrescription.update.mockRejectedValue(
      new Error('Record not found')
    );

    const req = {
      params: { prescriptionId: 'rx-missing' },
      body: { dose: '1000mg' },
      user: { id: 1, username: 'dr-smith' },
    } as unknown as Request;
    const res = buildRes();

    await modifyPrescription(req, res);
    await flushMicrotasks();

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect(mockedPushIpdPrescription).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// discontinuePrescription — 3 tests
// =====================================================================
describe('discontinuePrescription — happy path (fire-and-forget)', () => {
  it('responds 200 immediately; later, discontinue-push called with reason', async () => {
    const discontinuedRx = { ...rxFixture, status: 'discontinued' };
    mockedPrisma.ipdPrescription.update.mockResolvedValue(discontinuedRx);
    mockedPushIpdPrescriptionDiscontinue.mockResolvedValue({ id: 'HMIS-DC-1' });

    const req = {
      params: { prescriptionId: 'rx-1' },
      body: { reason: 'Adverse reaction' },
      user: { id: 1, username: 'dr-smith' },
    } as unknown as Request;
    const res = buildRes();

    await discontinuePrescription(req, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);

    await flushMicrotasks();

    expect(mockedPushIpdPrescriptionDiscontinue).toHaveBeenCalledWith(
      buildIpdPrescriptionDiscontinuePayload({
        admissionId: 'adm-1',
        prescriptionId: 'rx-1',
        reason: 'Adverse reaction',
        discontinuedBy: 'dr-smith',
      })
    );
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('success');
    expect(auditCall.action).toBe('ipd_prescription_discontinued');
  });
});

describe('discontinuePrescription — HMIS failure (fire-and-forget)', () => {
  it('still responds 200; failure audit captures HMIS 500', async () => {
    mockedPrisma.ipdPrescription.update.mockResolvedValue({
      ...rxFixture,
      status: 'discontinued',
    });
    const hmisError = Object.assign(new Error('server'), {
      response: { status: 500 },
    });
    mockedPushIpdPrescriptionDiscontinue.mockRejectedValue(hmisError);

    const req = {
      params: { prescriptionId: 'rx-1' },
      body: { reason: 'duplicate order' },
      user: { id: 1, username: 'dr-smith' },
    } as unknown as Request;
    const res = buildRes();

    await discontinuePrescription(req, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);

    await flushMicrotasks();
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
  });
});

describe('discontinuePrescription — sanity: error surfaces when prescription missing', () => {
  it('returns 500 and never calls HMIS when update throws', async () => {
    mockedPrisma.ipdPrescription.update.mockRejectedValue(
      new Error('Record not found')
    );

    const req = {
      params: { prescriptionId: 'rx-missing' },
      body: { reason: 'X' },
      user: { id: 1, username: 'dr-smith' },
    } as unknown as Request;
    const res = buildRes();

    await discontinuePrescription(req, res);
    await flushMicrotasks();

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect(mockedPushIpdPrescriptionDiscontinue).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// administerMedication — 3 tests (MAR / MOM.4)
// =====================================================================
describe('administerMedication — happy path (fire-and-forget, MAR)', () => {
  it(
    'creates MAR log, responds 200 immediately, fires MAR HMIS push with marLogId, ' +
      'audit log success',
    async () => {
      mockedPushIpdMedicationAdmin.mockResolvedValue({ id: 'HMIS-MAR-1' });

      const req = {
        params: { prescriptionId: 'rx-1' },
        body: { quantity: 1, route: 'oral', remarks: null },
        user: { id: 1, username: 'nurse-1' },
      } as unknown as Request;
      const res = buildRes();

      await administerMedication(req, res);

      expect(mockedPrisma.ipdMedicationLog.create).toHaveBeenCalledTimes(1);
      expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.data.marLog).toEqual(marLogFixture);

      await flushMicrotasks();

      expect(mockedPushIpdMedicationAdmin).toHaveBeenCalledTimes(1);
      expect(mockedPushIpdMedicationAdmin).toHaveBeenCalledWith(
        buildIpdMedicationAdminPayload({
          admissionId: 'adm-1',
          prescriptionId: 'rx-1',
          marLogId: 'mar-1',
          administeredBy: 'nurse-1',
          administeredAt: marLogFixture.administeredAt,
          quantity: 1,
          route: 'oral',
          remarks: null,
        })
      );
      const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
      expect(auditCall.status).toBe('success');
      expect(auditCall.module).toBe('ipd-mar');
      expect(auditCall.action).toBe('medication_administered');
      const response = JSON.parse(auditCall.response ?? '{}');
      expect(response.entityType).toBe('medication-admin');
      expect(response.result).toEqual({ id: 'HMIS-MAR-1' });
    }
  );
});

describe('administerMedication — HMIS failure (fire-and-forget, MAR)', () => {
  it('still responds 200 with MAR log; failure audit captures HMIS 500', async () => {
    const hmisError = Object.assign(new Error('mar-push-failed'), {
      response: { status: 500, data: { err: 'pharmacy module down' } },
    });
    mockedPushIpdMedicationAdmin.mockRejectedValue(hmisError);

    const req = {
      params: { prescriptionId: 'rx-1' },
      body: { quantity: 1 },
      user: { id: 1, username: 'nurse-1' },
    } as unknown as Request;
    const res = buildRes();

    await administerMedication(req, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);

    await flushMicrotasks();
    const auditCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(auditCall.status).toBe('failed');
    expect(auditCall.module).toBe('ipd-mar');
    const response = JSON.parse(auditCall.response ?? '{}');
    expect(response.error.status).toBe(500);
    expect(response.error.detail).toEqual({ err: 'pharmacy module down' });
  });
});

describe('administerMedication — sanity: prescription not found', () => {
  it('returns 404 and never calls HMIS when prescription does not exist', async () => {
    mockedPrisma.ipdPrescription.findUnique.mockResolvedValue(null);

    const req = {
      params: { prescriptionId: 'rx-missing' },
      body: { quantity: 1 },
      user: { id: 1, username: 'nurse-1' },
    } as unknown as Request;
    const res = buildRes();

    await administerMedication(req, res);
    await flushMicrotasks();

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(404);
    expect(mockedPrisma.ipdMedicationLog.create).not.toHaveBeenCalled();
    expect(mockedPushIpdMedicationAdmin).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Read-endpoint contracts (3 tests)
// =====================================================================
describe('reviewCarryoverPrescriptions — contract', () => {
  it('returns prescriptions filtered by admission.prn and last-7-days window', async () => {
    mockedPrisma.prescription.findMany.mockResolvedValue([
      { prescriptionId: 'PRE-OLD', prescribedBy: 'Dr. X', prescribedDate: '2026-04-12', patientName: 'Alice', tablets: [] },
    ]);

    const req = {
      params: { admissionId: 'adm-1' },
    } as unknown as Request;
    const res = buildRes();

    await reviewCarryoverPrescriptions(req, res);

    expect(mockedPrisma.ipdAdmission.findUnique).toHaveBeenCalledWith({
      where: { id: 'adm-1' },
    });
    expect(mockedPrisma.prescription.findMany).toHaveBeenCalledTimes(1);
    const call = mockedPrisma.prescription.findMany.mock.calls[0][0];
    expect(call.where.prn).toBe('1001');
    expect(call.where.prescribedDate.gte).toMatch(/T/); // ISO string
    // Sprint 3c expansion: child tablets are included.
    expect(call.include).toEqual({ tablets: true });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    // Read endpoints must NEVER call HMIS
    expect(mockedPushIpdPrescription).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  // Sprint 3c regression — response shape must carry full tablet detail so the
  // pharmacy-review UI can render per-tablet rows (drug name / frequency /
  // route / quantity / instructions). Pre-3c the endpoint truncated to three
  // fields; this lock keeps that from coming back.
  it('includes each prescription\'s tablets[] with drug-detail fields', async () => {
    mockedPrisma.prescription.findMany.mockResolvedValue([
      {
        prescriptionId: 'PRE-100',
        prescribedBy: 'Dr. Jacob Ryan',
        prescribedDate: '2026-04-15',
        patientName: 'Ravi Kumar',
        tablets: [
          {
            id: 1,
            genericName: 'Amoxicillin',
            brandName: 'Mox',
            frequency: 'q8h',
            duration: '5 days',
            route: 'oral',
            quantity: 15,
            instructions: 'After food',
          },
          {
            id: 2,
            genericName: 'Paracetamol',
            brandName: 'Calpol',
            frequency: 'q6h PRN',
            duration: '3 days',
            route: 'oral',
            quantity: 12,
            instructions: 'Fever > 38°C',
          },
        ],
      },
    ]);

    const req = { params: { admissionId: 'adm-1' } } as unknown as Request;
    const res = buildRes();
    await reviewCarryoverPrescriptions(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row.prescriptionId).toBe('PRE-100');
    expect(row.prescribedBy).toBe('Dr. Jacob Ryan');
    expect(row.patientName).toBe('Ravi Kumar');
    expect(row.tablets).toHaveLength(2);
    expect(row.tablets[0]).toEqual(
      expect.objectContaining({
        genericName: 'Amoxicillin',
        brandName: 'Mox',
        frequency: 'q8h',
        route: 'oral',
        quantity: 15,
        instructions: 'After food',
      })
    );
    expect(row.tablets[1]).toEqual(
      expect.objectContaining({
        genericName: 'Paracetamol',
        frequency: 'q6h PRN',
      })
    );
  });
});

describe('getPendingMedications — contract', () => {
  it('returns only active + pending prescriptions ordered by nextAdminTime', async () => {
    mockedPrisma.ipdPrescription.findMany.mockResolvedValue([rxFixture]);

    const req = {
      params: { admissionId: 'adm-1' },
    } as unknown as Request;
    const res = buildRes();

    await getPendingMedications(req, res);

    expect(mockedPrisma.ipdPrescription.findMany).toHaveBeenCalledWith({
      where: {
        admissionId: 'adm-1',
        status: 'active',
        adminStatus: 'pending',
      },
      orderBy: { nextAdminTime: 'asc' },
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    expect(mockedPushIpdPrescription).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });
});

describe('getMedicationAdministrationRecord — contract', () => {
  it('returns MAR logs with pagination metadata ordered by administeredAt desc', async () => {
    mockedPrisma.ipdMedicationLog.findMany.mockResolvedValue([marLogFixture]);
    mockedPrisma.ipdMedicationLog.count.mockResolvedValue(1);
    // Sprint 3c: controller now batch-fetches prescriptions for drug-detail
    // enrichment. Mock returns the parent Rx for the single log.
    mockedPrisma.ipdPrescription.findMany.mockResolvedValue([
      {
        id: marLogFixture.prescriptionId,
        genericName: 'Amoxicillin',
        brandName: 'Mox',
        frequency: 'q8h',
        route: 'oral',
      },
    ]);

    const req = {
      params: { admissionId: 'adm-1' },
      query: { page: '1', limit: '10' },
    } as unknown as Request;
    const res = buildRes();

    await getMedicationAdministrationRecord(req, res);

    expect(mockedPrisma.ipdMedicationLog.findMany).toHaveBeenCalledWith({
      where: { admissionId: 'adm-1' },
      orderBy: { administeredAt: 'desc' },
      skip: 0,
      take: 10,
    });
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({
      total: 1,
      page: 1,
      limit: 10,
      pages: 1,
    });
    expect(mockedPushIpdMedicationAdmin).not.toHaveBeenCalled();
    expect(mockedCreateHmisAuditLog).not.toHaveBeenCalled();
  });

  // Sprint 3c regression — each returned MAR row must carry its parent
  // prescription's drug identity so the nurse's MAR view can render
  // "genericName · quantity · route · administered time · administered by".
  // Covers the batch-fetch + stitch path (branch c).
  it('enriches each log with drug identity via batch-fetched prescriptions', async () => {
    const logs = [
      { ...marLogFixture, id: 'log-1', prescriptionId: 'rx-A' },
      { ...marLogFixture, id: 'log-2', prescriptionId: 'rx-A' },
      { ...marLogFixture, id: 'log-3', prescriptionId: 'rx-B' },
    ];
    mockedPrisma.ipdMedicationLog.findMany.mockResolvedValue(logs);
    mockedPrisma.ipdMedicationLog.count.mockResolvedValue(3);
    mockedPrisma.ipdPrescription.findMany.mockResolvedValue([
      { id: 'rx-A', genericName: 'Ceftriaxone', brandName: 'Rocephin', frequency: 'q12h', route: 'iv' },
      { id: 'rx-B', genericName: 'Paracetamol', brandName: 'Calpol', frequency: 'q6h PRN', route: 'oral' },
    ]);

    const req = {
      params: { admissionId: 'adm-1' },
      query: { page: '1', limit: '10' },
    } as unknown as Request;
    const res = buildRes();

    await getMedicationAdministrationRecord(req, res);

    // findMany called once for logs + once for distinct prescription ids
    const rxFindManyCalls = mockedPrisma.ipdPrescription.findMany.mock.calls;
    expect(rxFindManyCalls).toHaveLength(1);
    const where = rxFindManyCalls[0][0].where;
    // Must batch-fetch distinct ids only (not all prescriptions)
    expect(where.id.in.sort()).toEqual(['rx-A', 'rx-B']);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data).toHaveLength(3);
    expect(body.data[0].prescription).toEqual(
      expect.objectContaining({ id: 'rx-A', genericName: 'Ceftriaxone', route: 'iv' })
    );
    expect(body.data[1].prescription).toEqual(
      expect.objectContaining({ id: 'rx-A', genericName: 'Ceftriaxone' })
    );
    expect(body.data[2].prescription).toEqual(
      expect.objectContaining({ id: 'rx-B', genericName: 'Paracetamol', route: 'oral' })
    );
  });
});

// =====================================================================
// Sprint 4b Phase 4b.1 — Update attribution (updatedBy + updatedById)
// =====================================================================
describe('Sprint 4b.1 — IpdPrescription update attribution', () => {
  const req = (overrides: Partial<Request> = {}) =>
    ({
      params: { prescriptionId: 'rx-1' },
      body: {},
      user: { id: 42, username: 'alice' },
      ...overrides,
    }) as unknown as Request;

  it('modifyPrescription stamps updatedBy + updatedById from JWT', async () => {
    const r = req({ body: { dose: '1000mg' } } as Partial<Request>);
    await modifyPrescription(r, buildRes());
    const args = mockedPrisma.ipdPrescription.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('discontinuePrescription stamps updatedBy + updatedById from JWT', async () => {
    const r = req({ body: { reason: 'complete' } } as Partial<Request>);
    await discontinuePrescription(r, buildRes());
    const args = mockedPrisma.ipdPrescription.update.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      status: 'discontinued',
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });

  it('administerMedication stamps updatedBy + updatedById on prescription update + createdById on MAR log', async () => {
    const r = req({ body: { quantity: 1, route: 'oral', remarks: 'OK' } } as Partial<Request>);
    await administerMedication(r, buildRes());
    const rxArgs = mockedPrisma.ipdPrescription.update.mock.calls[0][0];
    expect(rxArgs.data).toEqual(expect.objectContaining({
      adminStatus: 'administered',
      updatedBy: 'alice',
      updatedById: 42,
    }));
    const marArgs = mockedPrisma.ipdMedicationLog.create.mock.calls[0][0];
    expect(marArgs.data).toEqual(expect.objectContaining({
      administeredBy: 'alice',
      createdById: 42,
    }));
  });

  it('skipMedication stamps updatedBy + updatedById on prescription update', async () => {
    const r = req({ body: { reason: 'patient declined' } } as Partial<Request>);
    await skipMedication(r, buildRes());
    const rxArgs = mockedPrisma.ipdPrescription.update.mock.calls[0][0];
    expect(rxArgs.data).toEqual(expect.objectContaining({
      adminStatus: 'skipped',
      updatedBy: 'alice',
      updatedById: 42,
    }));
  });
});
