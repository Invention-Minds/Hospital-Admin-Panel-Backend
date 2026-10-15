/**
 * AI receptionist service — slot computation and pending-request booking.
 */

const prismaMock = {
  doctorAvailability: { findFirst: jest.fn(), findMany: jest.fn() },
  bookedSlot: { findMany: jest.fn() },
  appointment: { findMany: jest.fn(), create: jest.fn() },
  unavailableSlot: { findMany: jest.fn() },
  doctor: { findUnique: jest.fn() },
  notification: { create: jest.fn() },
  callbackRequest: { create: jest.fn() },
};

jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: prismaMock }));
jest.mock('../../../service/appointment-event', () => ({
  recordAppointmentEventSystem: jest.fn().mockResolvedValue(undefined),
  slotSnapshot: jest.fn(() => ({})),
  subjectSnapshot: jest.fn(() => ({})),
}));

import { recordAppointmentEventSystem } from '../../../service/appointment-event';
import { BookingError, createAppointmentRequest, getFreeSlots, last10 } from '../ai-receptionist.service';

const FUTURE = '2099-01-05'; // a Monday

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.doctorAvailability.findFirst.mockResolvedValue({ availableFrom: '10:00-11:00', slotDuration: 20 });
  prismaMock.bookedSlot.findMany.mockResolvedValue([{ time: '10:20 AM' }]);
  prismaMock.appointment.findMany.mockResolvedValue([]);
  prismaMock.unavailableSlot.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({ id: 1 });
});

describe('last10', () => {
  it('normalises Indian numbers to 10 digits', () => {
    expect(last10('+91 98765-43210')).toBe('9876543210');
    expect(last10('09876543210')).toBe('9876543210');
    expect(last10('919876543210')).toBe('9876543210');
  });
});

describe('getFreeSlots', () => {
  it('builds slots from availability minus taken ones', async () => {
    expect(await getFreeSlots(7, FUTURE)).toEqual(['10:00 AM', '10:40 AM']);
    expect(prismaMock.doctorAvailability.findFirst).toHaveBeenCalledWith({ where: { doctorId: 7, day: 'mon' } });
  });

  it('returns nothing when the doctor has no availability that weekday', async () => {
    prismaMock.doctorAvailability.findFirst.mockResolvedValue(null);
    expect(await getFreeSlots(7, FUTURE)).toEqual([]);
  });
});

describe('createAppointmentRequest', () => {
  const input = { patientName: 'Ravi', phone: '+919876543210', doctorId: 7, date: FUTURE, time: '10:00 AM' };

  it('creates a pending request like the WhatsApp bot, without a BookedSlot', async () => {
    prismaMock.doctor.findUnique.mockResolvedValue({ id: 7, name: 'Dr. Rao', departmentName: 'Cardiology', isActive: true });
    prismaMock.appointment.create.mockImplementation(async ({ data }: any) => ({ id: 55, ...data }));

    const appt = await createAppointmentRequest(input);

    expect(appt.id).toBe(55);
    const data = prismaMock.appointment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'pending',
      requestVia: 'ai-receptionist',
      phoneNumber: '9876543210',
      doctorName: 'Dr. Rao',
      department: 'Cardiology',
      email: '',
    });
    expect(recordAppointmentEventSystem).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 55, eventType: 'REQUESTED', actorType: 'bot', source: 'ai-receptionist' }),
    );
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('rejects a slot that is already taken', async () => {
    prismaMock.doctor.findUnique.mockResolvedValue({ id: 7, name: 'Dr. Rao', departmentName: 'Cardiology', isActive: true });
    await expect(createAppointmentRequest({ ...input, time: '10:20 AM' })).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive doctor', async () => {
    prismaMock.doctor.findUnique.mockResolvedValue({ id: 7, name: 'Dr. Rao', departmentName: 'Cardiology', isActive: false });
    await expect(createAppointmentRequest(input)).rejects.toBeInstanceOf(BookingError);
  });
});
