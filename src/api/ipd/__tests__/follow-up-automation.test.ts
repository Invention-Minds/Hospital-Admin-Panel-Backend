/**
 * Sprint 4a Phase 1c — Follow-up automation tests (6).
 *
 * Covers:
 *  1. Happy path — valid date, patient found, responsible creator → created
 *  2. Past date → skipped ('past-date')
 *  3. Duplicate appointment on same day → skipped ('duplicate')
 *  4. No follow-up date → skipped ('no-follow-up-date')
 *  5. Patient not found → failed
 *  6. Discharge controller swallows a crashing auto-creation and still 201s
 */

import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdDischarge: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    ipdAdmission: { findUnique: jest.fn(), update: jest.fn() },
    ipdBed: { update: jest.fn() },
    patientDetails: { findFirst: jest.fn() },
    appointment: { findFirst: jest.fn(), create: jest.fn() },
    doctor: { findUnique: jest.fn() },
  },
}));

jest.mock('../../hmis-sync/hmis-client', () => ({
  pushIPDDischarge: jest.fn().mockResolvedValue({ id: 'HMIS-DIS-1' }),
  pushIpdAdmission: jest.fn(),
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import prisma from '../../../service/prisma-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import { createFollowUpAppointment } from '../follow-up-automation';
import { createDischarge } from '../ipd.controller';

const mockedPrisma = prisma as unknown as {
  ipdDischarge: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  ipdAdmission: { findUnique: jest.Mock; update: jest.Mock };
  ipdBed: { update: jest.Mock };
  patientDetails: { findFirst: jest.Mock };
  appointment: { findFirst: jest.Mock; create: jest.Mock };
  doctor: { findUnique: jest.Mock };
};
const mockedCreateAudit = createHmisAuditLog as jest.MockedFunction<typeof createHmisAuditLog>;

const admissionFixture = {
  id: 'adm-1',
  admissionNo: 'JMRH-IPD-0001',
  prn: '1001',
  bedId: 'bed-1',
  department: 'General Medicine',
  admittingDoctor: 'Dr. Ravi',
  status: 'admitted',
};
const dischargeFixture = {
  id: 'dis-1',
  admissionId: 'adm-1',
  finalDiagnosis: 'Hypertension, controlled',
  followUpDoctor: 'Dr. Ravi',
  createdById: 42,
  followUpDate: null as Date | null,
};
const patientFixture = {
  id: 500,
  prn: 1001,
  name: 'Asha Kumari',
  mobileNo: '9991112222',
  contactNo: null,
  email: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.ipdDischarge.findUnique.mockResolvedValue(dischargeFixture);
  mockedPrisma.ipdAdmission.findUnique.mockResolvedValue(admissionFixture);
  mockedPrisma.patientDetails.findFirst.mockResolvedValue(patientFixture);
  mockedPrisma.appointment.findFirst.mockResolvedValue(null);
  mockedPrisma.appointment.create.mockResolvedValue({ id: 9001 });
  mockedCreateAudit.mockResolvedValue({
    id: 1,
    direction: 'push',
    module: 'follow-up',
    action: 'noop',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    createdAt: new Date(),
  });
});

const futureDate = (): Date => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

describe('createFollowUpAppointment', () => {
  it('happy path — creates Appointment with prnNumber, userId from createdById, isfollowup=true, default time', async () => {
    const d = futureDate();
    const res = await createFollowUpAppointment('dis-1', 'adm-1', d, undefined, 'reason', 42);

    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.appointmentId).toBe(9001);

    const args = mockedPrisma.appointment.create.mock.calls[0][0];
    expect(args.data).toEqual(expect.objectContaining({
      prnNumber: 1001,
      patientId: null,
      patientName: 'Asha Kumari',
      phoneNumber: '9991112222',
      isfollowup: true,
      status: 'pending',
      time: '10:00',
      userId: 42,
    }));

    // Audit row written with module='follow-up'
    const auditCall = mockedCreateAudit.mock.calls.find(
      (c) => c[0].action === 'appointment_auto_created'
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![0].module).toBe('follow-up');
    expect(auditCall![0].status).toBe('success');
  });

  it('past date → skipped with reason past-date', async () => {
    const past = new Date();
    past.setDate(past.getDate() - 3);

    const res = await createFollowUpAppointment('dis-1', 'adm-1', past, undefined, undefined, 42);

    expect(res).toEqual({ status: 'skipped', reason: 'past-date' });
    expect(mockedPrisma.appointment.create).not.toHaveBeenCalled();

    const auditCall = mockedCreateAudit.mock.calls[0][0];
    expect(auditCall.action).toBe('appointment_auto_creation_skipped');
    expect(auditCall.module).toBe('follow-up');
  });

  it('duplicate appointment on same day → skipped with reason duplicate', async () => {
    mockedPrisma.appointment.findFirst.mockResolvedValue({ id: 777, prnNumber: 1001 });
    const d = futureDate();

    const res = await createFollowUpAppointment('dis-1', 'adm-1', d, undefined, undefined, 42);

    expect(res).toEqual({ status: 'skipped', reason: 'duplicate' });
    expect(mockedPrisma.appointment.create).not.toHaveBeenCalled();

    const auditPayload = JSON.parse(mockedCreateAudit.mock.calls[0][0].payload);
    expect(auditPayload.reason).toBe('duplicate');
    expect(auditPayload.conflictingAppointmentId).toBe(777);
  });

  it('no follow-up date → skipped with reason no-follow-up-date, no DB lookup', async () => {
    const res = await createFollowUpAppointment('dis-1', 'adm-1', null, undefined, undefined, 42);

    expect(res).toEqual({ status: 'skipped', reason: 'no-follow-up-date' });
    expect(mockedPrisma.ipdDischarge.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it('patient not found → failed with reason, audit row failed', async () => {
    mockedPrisma.patientDetails.findFirst.mockResolvedValue(null);
    const d = futureDate();

    const res = await createFollowUpAppointment('dis-1', 'adm-1', d, undefined, undefined, 42);

    expect(res.status).toBe('failed');
    if (res.status !== 'failed') return;
    expect(res.reason).toContain('patient-not-found');
    expect(mockedPrisma.appointment.create).not.toHaveBeenCalled();

    const auditCall = mockedCreateAudit.mock.calls[0][0];
    expect(auditCall.action).toBe('appointment_auto_creation_failed');
    expect(auditCall.status).toBe('failed');
  });
});

// --- Discharge handler integration: follow-up failure doesn't fail discharge ---

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildReq = (): Request =>
  ({
    params: { admissionId: 'adm-1' },
    body: {
      dischargeType: 'regular',
      finalDiagnosis: 'OK',
      conditionAtDischarge: 'stable',
      dischargeSummary: 'summary',
      followUpDate: futureDate().toISOString(),
      medications: [],
    },
    user: { id: 42, username: 'alice' },
  }) as unknown as Request;

describe('createDischarge (controller) — follow-up summary in response', () => {
  it('returns 201 even when follow-up helper throws; message includes the crash summary', async () => {
    mockedPrisma.ipdAdmission.findUnique.mockResolvedValueOnce({ ...admissionFixture, status: 'admitted' });
    mockedPrisma.ipdDischarge.findUnique.mockResolvedValueOnce(null); // No existing discharge (not-yet-discharged guard)
    const created = { ...dischargeFixture, followUpDate: futureDate() };
    mockedPrisma.ipdDischarge.create.mockResolvedValueOnce(created);
    mockedPrisma.ipdDischarge.update.mockResolvedValueOnce(created);
    mockedPrisma.ipdAdmission.update.mockResolvedValue({});
    mockedPrisma.ipdBed.update.mockResolvedValue({});
    // Force a follow-up crash by making the patient lookup throw unexpectedly.
    mockedPrisma.patientDetails.findFirst.mockRejectedValueOnce(new Error('simulated DB crash'));

    const res = buildRes();
    await createDischarge(buildReq(), res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(201);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.message).toContain('IPD discharge summary created successfully');
    // Caught inside the helper → returns a failed status; summarizeFollowUp renders as 'could not be scheduled'.
    expect(body.message).toMatch(/Follow-up could not be scheduled/);
  });
});
