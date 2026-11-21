const prismaMock = {
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  notification: { create: jest.fn() },
};
jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: prismaMock }));
jest.mock('../../appointments/appointment.controller', () => ({ notifyPendingAppointments: jest.fn() }));
jest.mock('../../../service/app-audit', () => ({ auditLogAs: jest.fn() }));

import type { Request } from 'express';
import { auditLogAs } from '../../../service/app-audit';
import { notifyPendingAppointments } from '../../appointments/appointment.controller';
import { actorLabel, dayRangeLabel, recordDoctorChange, timetableChange, timetableOf } from '../doctor-change-log';

describe('timetableChange', () => {
  const before = timetableOf([
    { day: 'Monday', availableFrom: '10:00-13:00', slotDuration: 20 },
    { day: 'Wednesday', availableFrom: '10:00-13:00', slotDuration: 20 },
  ]);

  it('is null when the same timetable is saved again', () => {
    const same = timetableOf([
      { day: 'Wednesday', availableFrom: '10:00-13:00', slotDuration: 20 },
      { day: 'Monday', availableFrom: '10:00-13:00', slotDuration: 20 },
    ]);
    expect(timetableChange(before, same)).toBeNull();
  });

  it('shows the before and after when a day moves or is added', () => {
    const after = timetableOf([
      { day: 'Monday', availableFrom: '11:00-14:00', slotDuration: 20 },
      { day: 'Wednesday', availableFrom: '10:00-13:00', slotDuration: 20 },
      { day: 'Saturday', availableFrom: '09:00-12:00', slotDuration: 15 },
    ]);
    expect(timetableChange(before, after)).toEqual({
      field: 'Timings',
      from: 'Mon 10:00-13:00 (20 min), Wed 10:00-13:00 (20 min)',
      to: 'Mon 11:00-14:00 (20 min), Wed 10:00-13:00 (20 min), Sat 09:00-12:00 (15 min)',
    });
  });
});

describe('labels', () => {
  it('prefers full name and job title', () => {
    expect(actorLabel({ username: 'ramesh_sub_admin', fullName: 'Ramesh K', role: 'sub_admin', subAdminType: 'Tele Caller' })).toBe('Ramesh K (Tele Caller)');
    expect(actorLabel({ username: 'it_admin', role: 'admin' })).toBe('it (admin)');
    expect(actorLabel({ username: null })).toBe('Unknown');
  });

  it('formats day ranges', () => {
    expect(dayRangeLabel('2026-11-22', '2026-11-22')).toBe('22 Nov');
    expect(dayRangeLabel('2026-11-22', '2026-11-24')).toBe('22 Nov – 24 Nov');
  });
});

describe('recordDoctorChange', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs who did it and alerts each desk user except the actor', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ username: 'asha_admin', fullName: 'Asha', role: 'admin', subAdminType: null });
    prismaMock.user.findMany.mockResolvedValue([{ id: 11, subAdminType: 'Tele Caller' }, { id: 12, subAdminType: 'Front Desk' }]);
    prismaMock.notification.create.mockImplementation(async ({ data }: any) => ({ id: data.userId, ...data }));

    const req = { user: { id: 5, username: 'asha_admin' }, headers: {} } as unknown as Request;
    await recordDoctorChange(req, {
      action: 'LEAVE_ADDED', doctorId: 3, doctorName: 'Dr Rao',
      summary: 'Unavailable 22 Nov – 24 Nov', affectedBookings: 2,
    });

    expect(auditLogAs).toHaveBeenCalledWith(req, { id: 5, username: 'asha_admin', role: 'admin' },
      expect.objectContaining({ module: 'doctor', action: 'LEAVE_ADDED', entityId: 3 }));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: 5 }, subAdminType: { in: ['Tele Caller', 'Front Desk'] } }),
    }));
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    const first = prismaMock.notification.create.mock.calls[0][0].data;
    expect(first).toMatchObject({
      type: 'doctor_leave_added', userId: 11, isCritical: true,
      message: 'Unavailable 22 Nov – 24 Nov — 2 booked patients affected · by Asha (admin)',
    });
    expect(notifyPendingAppointments).toHaveBeenCalledTimes(2);
  });

  it('logs arrivals without alerting the desk', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ username: 'fd1', fullName: 'Meena', role: 'sub_admin', subAdminType: 'Front Desk' });
    const req = { user: { id: 212, username: 'fd1' }, headers: {} } as unknown as Request;
    await recordDoctorChange(req, { action: 'ARRIVED', doctorId: 7, doctorName: 'Dr A', summary: 'Arrived 9:42 AM', alert: false });

    expect(auditLogAs).toHaveBeenCalledWith(req, { id: 212, username: 'fd1', role: 'sub_admin' },
      expect.objectContaining({ module: 'doctor', action: 'ARRIVED', entityId: 7 }));
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('never throws when the database fails', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db down'));
    const req = { user: { id: 5, username: 'x' }, headers: {} } as unknown as Request;
    await expect(recordDoctorChange(req, { action: 'ACTIVATE', doctorId: 1, doctorName: 'Dr A', summary: 'Reactivated' })).resolves.toBeUndefined();
  });
});
