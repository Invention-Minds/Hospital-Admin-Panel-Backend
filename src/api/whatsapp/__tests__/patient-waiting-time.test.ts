/**
 * checkPatientWaitingTime (every-2-minute cron in whatsapp.controller).
 *
 * The job is not exported, so we capture the callback registered for
 * "*\/2 * * * *" through a node-cron mock and run it against a mocked Prisma.
 * Expected outcomes follow the original logic: alert when a consultation runs
 * past slotDuration + 10 min (then every 5 min), and stamp the overrun on the
 * NEXT pending patient (earliest time).
 */

const prismaMock = {
  doctor: { findMany: jest.fn() },
  appointment: { findMany: jest.fn(), update: jest.fn() },
};

const scheduled: Record<string, Array<() => Promise<void>>> = {};

jest.mock('node-cron', () => ({
  schedule: jest.fn((expr: string, fn: () => Promise<void>) => {
    (scheduled[expr] ??= []).push(fn);
    return { stop: jest.fn() };
  }),
}));
jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: prismaMock }));
jest.mock('../../appointments/appointment.controller', () => ({
  notifyPendingAppointments: jest.fn(), messageSent: jest.fn(), adminAlertSent: jest.fn(),
}));
jest.mock('../../attendance/attendance.store', () => ({ getTodayIds: jest.fn() }));
jest.mock('../../screenshot/screenshot.controller', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../services/services.controller', () => ({
  callRepeatedAppointments: jest.fn(), processRepeatedAppointments: jest.fn(),
}));
jest.mock('../../therapy/therapy.controller', () => ({ sendTherapyReminders: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../service/notification-recipients', () => ({ getRecipientPhones: jest.fn() }));
jest.mock('../../../service/appointment-event', () => ({
  recordAppointmentEvent: jest.fn(), recordAppointmentEventSystem: jest.fn(),
  slotSnapshot: jest.fn(), subjectSnapshot: jest.fn(),
}));

// Monday 23 Nov 2026, 10:30 IST (05:00 UTC).
const NOW = new Date('2026-11-23T05:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000);
const updated = new Date('2026-11-01T00:00:00.000Z');

const avail = (day: string, slotDuration = 20, updatedAt: Date | null = updated) =>
  ({ day, availableFrom: '09:00-13:00', slotDuration, updatedAt });

const doctor = (id: number, extra: Record<string, unknown> = {}) => ({
  id, userId: 100 + id, doctorType: 'Consultant', name: `Doc ${id}`,
  availability: [avail('Mon')], unavailableDates: [], ...extra,
});

/** One doctor's queue: an ongoing consult started `elapsed` min ago + pending patients. */
const queue = (doctorId: number, elapsed: number) => [
  { id: doctorId * 10 + 1, doctorId, doctorName: `Doc ${doctorId}`, patientName: 'Ongoing', time: '10:00 AM',
    checkedIn: true, checkedOut: true, checkedOutTime: minsAgo(elapsed), endConsultationTime: null, extraWaitingTime: null },
  { id: doctorId * 10 + 2, doctorId, doctorName: `Doc ${doctorId}`, patientName: 'Later', time: '10:40 AM',
    checkedIn: true, checkedOut: false, checkedOutTime: null, endConsultationTime: null, extraWaitingTime: null },
  { id: doctorId * 10 + 3, doctorId, doctorName: `Doc ${doctorId}`, patientName: 'Next', time: '10:20 AM',
    checkedIn: true, checkedOut: false, checkedOutTime: null, endConsultationTime: null, extraWaitingTime: null },
];

let runJob: () => Promise<void>;

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../whatsapp.controller');
  const jobs = scheduled['*/2 * * * *'];
  expect(jobs).toHaveLength(1);
  runJob = jobs[0];
});

afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.appointment.update.mockResolvedValue({});
});

describe('checkPatientWaitingTime', () => {
  it('queries only today: IST-day unavailable dates and today\'s checked-in appointments', async () => {
    prismaMock.doctor.findMany.mockResolvedValue([doctor(1), doctor(2)]);
    prismaMock.appointment.findMany.mockResolvedValue([]);

    await runJob();

    const docArgs = prismaMock.doctor.findMany.mock.calls[0][0];
    expect(docArgs.where).toEqual({ userId: { not: null } });
    expect(docArgs.select.unavailableDates.where.date).toEqual({
      gte: new Date('2026-11-22T18:30:00.000Z'), // 23 Nov 00:00 IST
      lte: new Date('2026-11-23T18:29:59.999Z'), // 23 Nov 23:59:59.999 IST
    });
    expect(prismaMock.appointment.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.appointment.findMany.mock.calls[0][0].where).toEqual({
      date: '2026-11-23', status: 'confirmed', checkedIn: true, doctorId: { in: [1, 2] },
    });
  });

  it('stamps the overrun on the earliest pending patient when elapsed = slot + 10', async () => {
    prismaMock.doctor.findMany.mockResolvedValue([doctor(1)]);
    prismaMock.appointment.findMany.mockResolvedValue(queue(1, 30)); // slot 20 → threshold 30

    await runJob();

    expect(prismaMock.appointment.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.appointment.update).toHaveBeenCalledWith({
      where: { id: 13 }, // 'Next' at 10:20 AM, not 'Later' at 10:40 AM
      data: { extraWaitingTime: 10 }, // 30 elapsed − 20 slot
    });
  });

  it('repeats every 5 minutes after the threshold, and stays silent in between', async () => {
    prismaMock.doctor.findMany.mockResolvedValue([doctor(1), doctor(2), doctor(3)]);
    prismaMock.appointment.findMany.mockResolvedValue([
      ...queue(1, 35), // threshold + 5 → alert
      ...queue(2, 32), // threshold + 2 → no alert
      ...queue(3, 25), // before threshold → no alert
    ]);

    await runJob();

    expect(prismaMock.appointment.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.appointment.update).toHaveBeenCalledWith({ where: { id: 13 }, data: { extraWaitingTime: 15 } });
  });

  it('skips doctors who are unavailable today, visiting consultants, or have no slot today', async () => {
    prismaMock.doctor.findMany.mockResolvedValue([
      doctor(1, { unavailableDates: [{ id: 9 }] }),
      doctor(2, { doctorType: 'Visiting Consultant' }),
      doctor(3, { availability: [avail('Tue')] }),
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([...queue(1, 30), ...queue(2, 30), ...queue(3, 30)]);

    await runJob();

    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it('uses only the latest availability batch (older Monday rows are ignored)', async () => {
    const older = new Date('2026-10-01T00:00:00.000Z');
    prismaMock.doctor.findMany.mockResolvedValue([
      doctor(1, { availability: [avail('Tue', 20, updated), avail('Mon', 20, older)] }),
    ]);
    prismaMock.appointment.findMany.mockResolvedValue(queue(1, 30));

    await runJob();

    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it('uses the slot duration from today\'s availability and needs an ongoing consult', async () => {
    prismaMock.doctor.findMany.mockResolvedValue([
      doctor(1, { availability: [avail('Mon', 15)] }), // threshold 25
      doctor(2),
    ]);
    const noOngoing = queue(2, 30).filter((a) => a.patientName !== 'Ongoing');
    prismaMock.appointment.findMany.mockResolvedValue([...queue(1, 25), ...noOngoing]);

    await runJob();

    expect(prismaMock.appointment.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.appointment.update).toHaveBeenCalledWith({ where: { id: 13 }, data: { extraWaitingTime: 10 } });
  });
});
