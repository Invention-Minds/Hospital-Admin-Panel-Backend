/**
 * Sprint 4b.2 — Appointment identity tests.
 *
 * Covers the 3 handlers where attribution previously came from req.body:
 *   1. createAppointment: userId from JWT; body userId ignored.
 *   2. updateAppointment: same.
 *   3. lockAppointment: lockedBy from JWT; body userId ignored.
 *   4. createAppointment (anonymous): no JWT → userId passed as null (public booking preserved).
 *   5. updateAppointment impersonation: body.userId attacker ignored; JWT value wins.
 *   6. lockAppointment no-JWT rejection: returns 401.
 */

import type { Request, Response } from 'express';

// Resolver + dependencies must be mocked BEFORE importing the controller.
const resolverMock = {
  createAppointment: jest.fn(),
  updateAppointment: jest.fn(),
  lockAppointment: jest.fn(),
  getAppointments: jest.fn(),
  deleteAppointment: jest.fn(),
};
jest.mock('../appointment.resolver', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => resolverMock),
}));

jest.mock('../appointment.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getAppointmentById: jest.fn().mockResolvedValue({
      id: 1, patientName: 'p', phoneNumber: '+91', email: '', doctorName: '', department: '', date: '', time: '', status: 'pending', lockedBy: null,
    }),
  })),
}));

jest.mock('../../doctor/doctor.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addBookedSlot: jest.fn(),
    getDoctorById: jest.fn().mockResolvedValue({ id: 1, name: 'Dr. X', phone_number: '+91' }),
    getBookedSlots: jest.fn().mockResolvedValue([]),
    getDoctorAvailability: jest.fn().mockResolvedValue({
      slotDuration: 10,
      availableFrom: '09:00-17:00',
    }),
  })),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    appointment: { findUnique: jest.fn(), update: jest.fn() },
  })),
  AppointmentStatus: { pending: 'pending', completed: 'completed', confirmed: 'confirmed', cancelled: 'cancelled' },
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

import { createAppointment, updateAppointment, lockAppointment } from '../appointment.controller';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
  resolverMock.createAppointment.mockResolvedValue({ id: 1, status: 'pending', userId: 42, doctorId: 1 });
  resolverMock.updateAppointment.mockResolvedValue({ id: 1, doctorId: 1, date: '2026-04-21', time: '10:00', status: 'pending', userId: 42 });
  resolverMock.lockAppointment.mockResolvedValue({ locked: false, appointment: { id: 1, lockedBy: 42 } });
});

describe('Sprint 4b.2 — Appointment identity', () => {
  it('createAppointment (authenticated): userId comes from JWT, body userId ignored', async () => {
    const req = {
      body: {
        patientName: 'Test', phoneNumber: '+91', email: 't@t', doctorName: 'Dr. X', doctorId: 1,
        doctorType: 'Visiting Consultant', // bypass availability check in test
        department: 'General', date: '2026-04-21', time: '10:00', status: 'pending',
        userId: 999, // attacker
      },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await createAppointment(req, buildRes());

    const args = resolverMock.createAppointment.mock.calls[0][0];
    expect(args.userId).toBe(42);
    expect(args.userId).not.toBe(999);
  });

  it('createAppointment (anonymous public booking): no JWT → userId is null, body userId still ignored', async () => {
    const req = {
      body: {
        patientName: 'Test', phoneNumber: '+91', email: 't@t', doctorName: 'Dr. X', doctorId: 1,
        department: 'General', date: '2026-04-21', time: '11:00', status: 'pending',
        // doctorType already set above on the other test; this test also has it via the spread order
        userId: 999,
      },
      // no user — public website flow
    } as unknown as Request;

    await createAppointment(req, buildRes());

    const args = resolverMock.createAppointment.mock.calls[0][0];
    expect(args.userId).toBeNull();
    expect(args.userId).not.toBe(999);
  });

  it('updateAppointment impersonation: body.userId ignored, JWT value wins', async () => {
    const req = {
      params: { id: '1' },
      body: {
        doctor: {}, user: {},
        userId: 999, // attacker
        status: 'completed',
      },
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await updateAppointment(req, buildRes());

    const args = resolverMock.updateAppointment.mock.calls[0][1]; // 2nd arg is updateData
    expect(args.userId).toBe(42);
    expect(args.userId).not.toBe(999);
  });

  it('lockAppointment: userId stamped from JWT, not body', async () => {
    const req = {
      params: { id: '1' },
      body: { userId: 999 }, // attacker
      user: { id: 42, username: 'alice' },
    } as unknown as Request;

    await lockAppointment(req, buildRes());

    expect(resolverMock.lockAppointment).toHaveBeenCalledWith(1, 42);
  });

  it('lockAppointment: returns 401 when no JWT user present', async () => {
    const req = {
      params: { id: '1' },
      body: { userId: 999 },
      // no user
    } as unknown as Request;

    const res = buildRes();
    await lockAppointment(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(resolverMock.lockAppointment).not.toHaveBeenCalled();
  });

  it('updateAppointment without JWT: updateData.userId is NOT set (and not 999 from body)', async () => {
    const req = {
      params: { id: '1' },
      body: {
        doctor: {}, user: {},
        userId: 999,
        status: 'completed',
      },
      // no user
    } as unknown as Request;

    await updateAppointment(req, buildRes());

    const args = resolverMock.updateAppointment.mock.calls[0][1];
    expect(args.userId).toBeUndefined();
    expect(args.userId).not.toBe(999);
  });
});
