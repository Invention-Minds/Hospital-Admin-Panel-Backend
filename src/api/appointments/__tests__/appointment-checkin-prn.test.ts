/**
 * Check-in with a PRN captured in the check-in popup.
 *
 * When reception enters a PRN at check-in (the appointment was booked without
 * one), /checkin saves it and — if that PRN is registered in PatientDetails —
 * corrects the booking's name/age/gender from the patient record. An unknown
 * PRN is saved without touching demographics; no PRN means today's behaviour.
 */

import type { Request, Response } from 'express';

const appointmentMock = { findUnique: jest.fn(), update: jest.fn() };
const patientDetailsMock = { findUnique: jest.fn() };

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    appointment: appointmentMock,
    patientDetails: patientDetailsMock,
  })),
  AppointmentStatus: { pending: 'pending', completed: 'completed', confirmed: 'confirmed', cancelled: 'cancelled' },
}));

jest.mock('../appointment.resolver', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../appointment.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../doctor/doctor.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../whatsapp/whatsapp.controller', () => ({
  sendConfirmedWhatsApp: jest.fn(),
}));
jest.mock('../../sms/sms.controller', () => ({
  sendConfirmedSMS: jest.fn(),
}));
jest.mock('../../../index', () => ({
  notifyPendingAppointments: jest.fn(),
}), { virtual: true });

const recordAppointmentEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../service/appointment-event', () => ({
  recordAppointmentEvent: (...args: unknown[]) => recordAppointmentEventMock(...args),
  classifyAppointmentChange: jest.fn(),
  slotSnapshot: jest.fn().mockReturnValue({}),
  subjectSnapshot: jest.fn().mockReturnValue({}),
}));

import { checkInAppointment } from '../appointment.controller';

const bookedAppointment = {
  id: 10,
  doctorId: 3,
  patientName: 'Ramesh',
  age: '40',
  gender: 'male',
  prnNumber: null,
  type: 'free',
  paidAt: null,
};

const buildReq = (body: Record<string, unknown>): Request =>
  ({ params: { id: '10' }, body, user: { id: 1, username: 'reception1' }, headers: {} } as unknown as Request);

const buildRes = () => {
  const res: Partial<Response> & { statusCode?: number; body?: any } = {};
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((payload: any) => {
    res.body = payload;
    return res;
  });
  return res as Response & { statusCode?: number; body?: any };
};

const run = async (body: Record<string, unknown>) => {
  const res = buildRes();
  await checkInAppointment(buildReq(body), res);
  return res;
};

const updateData = () => appointmentMock.update.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  appointmentMock.findUnique.mockResolvedValue({ ...bookedAppointment });
  appointmentMock.update.mockImplementation(async ({ data }: { data: object }) => ({ ...bookedAppointment, ...data }));
  patientDetailsMock.findUnique.mockResolvedValue(null);
});

describe('checkInAppointment — PRN captured at check-in', () => {
  it('updates name, age and gender from the patient record when the PRN exists', async () => {
    patientDetailsMock.findUnique.mockResolvedValue({ name: 'Ramesh Kumar Rao', age: '42', gender: 'Male' });

    const res = await run({ username: 'reception1', prnNumber: '1042' });

    expect(res.statusCode).toBe(200);
    expect(patientDetailsMock.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { prn: 1042 } }),
    );
    expect(updateData()).toMatchObject({
      checkedIn: true,
      checkedInBy: 'reception1',
      prnNumber: 1042,
      patientName: 'Ramesh Kumar Rao',
      age: '42',
      gender: 'Male',
    });
  });

  it('saves the PRN but leaves demographics alone when the PRN is not registered', async () => {
    const res = await run({ username: 'reception1', prnNumber: 9999 });

    expect(res.statusCode).toBe(200);
    const data = updateData();
    expect(data.prnNumber).toBe(9999);
    expect(data.checkedIn).toBe(true);
    expect(data).not.toHaveProperty('patientName');
    expect(data).not.toHaveProperty('age');
    expect(data).not.toHaveProperty('gender');
  });

  it('never replaces booking data with blank values from the patient record', async () => {
    patientDetailsMock.findUnique.mockResolvedValue({ name: 'Ramesh Kumar', age: null, gender: '   ' });

    await run({ username: 'reception1', prnNumber: 1042 });

    const data = updateData();
    expect(data.patientName).toBe('Ramesh Kumar');
    expect(data).not.toHaveProperty('age');
    expect(data).not.toHaveProperty('gender');
  });

  it('keeps existing behaviour when no PRN is sent', async () => {
    const res = await run({ username: 'reception1' });

    expect(res.statusCode).toBe(200);
    expect(patientDetailsMock.findUnique).not.toHaveBeenCalled();
    const data = updateData();
    expect(data).not.toHaveProperty('prnNumber');
    expect(data).not.toHaveProperty('patientName');
  });

  it('treats a blank PRN as not sent', async () => {
    await run({ username: 'reception1', prnNumber: '  ' });

    expect(patientDetailsMock.findUnique).not.toHaveBeenCalled();
    expect(updateData()).not.toHaveProperty('prnNumber');
  });

  it.each(['ABC', '12.5', '-4', '0'])('rejects an invalid PRN (%s) without checking in', async (prn) => {
    const res = await run({ username: 'reception1', prnNumber: prn });

    expect(res.statusCode).toBe(400);
    expect(appointmentMock.update).not.toHaveBeenCalled();
  });

  it('records the before/after demographics on the check-in event', async () => {
    patientDetailsMock.findUnique.mockResolvedValue({ name: 'Ramesh Kumar Rao', age: '42', gender: 'Male' });

    await run({ username: 'reception1', prnNumber: 1042 });

    const event = recordAppointmentEventMock.mock.calls[0][1];
    expect(event.eventType).toBe('CHECKED_IN');
    expect(event.payload).toMatchObject({
      prnCapturedAtCheckin: 1042,
      patientRecordFound: true,
      demographicsBefore: { patientName: 'Ramesh', age: '40', gender: 'male' },
      demographicsApplied: { patientName: 'Ramesh Kumar Rao', age: '42', gender: 'Male' },
    });
  });
});
