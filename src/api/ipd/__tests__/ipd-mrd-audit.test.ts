/**
 * Sprint 4a Phase 1b — MRD audit enforcement tests for IPD clinical-write handlers.
 *
 * Covers:
 *   - 6 create handlers × 2 (happy-path createdById stamp + 401 rejection)
 *   - 2 update handlers × 1 (401 rejection only; update attribution deferred to 4b)
 *
 * 14 tests total.
 */

import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdAdmission: { findUnique: jest.fn(), update: jest.fn() },
    ipdProgressNote: { create: jest.fn() },
    ipdDischarge: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    ipdPrescription: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    ipdMedicationLog: { create: jest.fn() },
    ipdBed: { update: jest.fn() },
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIpdAdmission: jest.fn(),
  pushIPDDischarge: jest.fn(),
  pushIpdPrescription: jest.fn(),
  pushIpdPrescriptionDiscontinue: jest.fn(),
  pushIpdMedicationAdmin: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

jest.mock('../follow-up-automation', () => ({
  createFollowUpAppointment: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../service/prisma-client';
import { addProgressNote, createDischarge } from '../ipd.controller';
import {
  continuePrescription,
  createNewPrescription,
  administerMedication,
  skipMedication,
  modifyPrescription,
  discontinuePrescription,
} from '../ipd-prescription.controller';

const mockedPrisma = prisma as unknown as {
  ipdAdmission: { findUnique: jest.Mock; update: jest.Mock };
  ipdProgressNote: { create: jest.Mock };
  ipdDischarge: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  ipdPrescription: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  ipdMedicationLog: { create: jest.Mock };
  ipdBed: { update: jest.Mock };
};

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (withUser = true, overrides: Record<string, unknown> = {}): Request =>
  ({
    body: {
      // Progress note
      doctorName: 'Dr. A',
      subjective: 's',
      objective: 'o',
      assessment: 'a',
      plan: 'p',
      // Discharge
      dischargeType: 'regular',
      finalDiagnosis: 'OK',
      conditionAtDischarge: 'stable',
      dischargeSummary: 'summary',
      medications: [],
      // Prescription
      prescribedBy: 'Dr. A',
      genericName: 'Paracetamol',
      dose: '500mg',
      frequency: 'BID',
      duration: '5 days',
      quantity: 10,
      ...overrides,
    },
    params: { admissionId: 'adm-1', prescriptionId: 'rx-1' },
    user: withUser ? { id: 42, username: 'alice' } : undefined,
  }) as unknown as Request;

const admissionFixture = { id: 'adm-1', prn: '1001', bedId: 'bed-1', status: 'admitted' };
const prescriptionFixture = {
  id: 'rx-1',
  admissionId: 'adm-1',
  prescriptionId: null,
  prescribedBy: 'Dr. A',
  genericName: 'Paracetamol',
  brandName: null,
  dose: '500mg',
  frequency: 'BID',
  duration: '5 days',
  route: 'oral',
  instructions: null,
  quantity: 10,
  isCarryOver: false,
  carryOverFrom: null,
  status: 'active',
  adminStatus: 'pending',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.ipdAdmission.findUnique.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdDischarge.findUnique.mockResolvedValue(null);
  mockedPrisma.ipdPrescription.findUnique.mockResolvedValue(prescriptionFixture);
  mockedPrisma.ipdProgressNote.create.mockResolvedValue({ id: 'pn-1' });
  mockedPrisma.ipdDischarge.create.mockResolvedValue({ id: 'dx-1', admissionId: 'adm-1', followUpDate: null });
  mockedPrisma.ipdPrescription.create.mockResolvedValue(prescriptionFixture);
  mockedPrisma.ipdPrescription.update.mockResolvedValue(prescriptionFixture);
  mockedPrisma.ipdMedicationLog.create.mockResolvedValue({
    id: 'mar-1',
    admissionId: 'adm-1',
    prescriptionId: 'rx-1',
    administeredAt: new Date(),
    administeredBy: 'alice',
    quantity: 10,
    route: 'oral',
    remarks: null,
  });
  mockedPrisma.ipdAdmission.update.mockResolvedValue(admissionFixture);
  mockedPrisma.ipdBed.update.mockResolvedValue({});
});

describe('addProgressNote', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await addProgressNote(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdProgressNote.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new progress note', async () => {
    const res = buildRes();
    await addProgressNote(buildReq(), res);
    expect(mockedPrisma.ipdProgressNote.create).toHaveBeenCalledTimes(1);
    const args = mockedPrisma.ipdProgressNote.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('createDischarge', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await createDischarge(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdDischarge.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new discharge summary', async () => {
    const res = buildRes();
    await createDischarge(buildReq(), res);
    expect(mockedPrisma.ipdDischarge.create).toHaveBeenCalledTimes(1);
    const args = mockedPrisma.ipdDischarge.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('continuePrescription', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await continuePrescription(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdPrescription.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new IPD prescription (carryover)', async () => {
    const res = buildRes();
    await continuePrescription(buildReq(), res);
    expect(mockedPrisma.ipdPrescription.create).toHaveBeenCalledTimes(1);
    const args = mockedPrisma.ipdPrescription.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('createNewPrescription', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await createNewPrescription(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdPrescription.create).not.toHaveBeenCalled();
  });

  it('stamps createdBy + createdById on the new IPD prescription', async () => {
    const res = buildRes();
    await createNewPrescription(buildReq(), res);
    expect(mockedPrisma.ipdPrescription.create).toHaveBeenCalledTimes(1);
    const args = mockedPrisma.ipdPrescription.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      createdBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('administerMedication (MAR log create)', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await administerMedication(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdMedicationLog.create).not.toHaveBeenCalled();
  });

  it('stamps createdById on the new MAR log + administeredBy as username', async () => {
    const res = buildRes();
    await administerMedication(buildReq(), res);
    expect(mockedPrisma.ipdMedicationLog.create).toHaveBeenCalledTimes(1);
    const args = mockedPrisma.ipdMedicationLog.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      administeredBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('skipMedication (MAR log create)', () => {
  it('rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await skipMedication(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdMedicationLog.create).not.toHaveBeenCalled();
  });

  it('stamps createdById on the skip MAR log', async () => {
    const res = buildRes();
    await skipMedication(buildReq(), res);
    expect(mockedPrisma.ipdMedicationLog.create).toHaveBeenCalledTimes(1);
    const args = mockedPrisma.ipdMedicationLog.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      administeredBy: 'alice',
      createdById: 42,
    }));
  });
});

describe('IPD prescription update handlers — rejection only (updatedBy attribution deferred to 4b)', () => {
  it('modifyPrescription rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await modifyPrescription(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdPrescription.update).not.toHaveBeenCalled();
  });

  it('discontinuePrescription rejects with 401 when req.user is missing', async () => {
    const res = buildRes();
    await discontinuePrescription(buildReq(false), res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockedPrisma.ipdPrescription.update).not.toHaveBeenCalled();
  });
});
