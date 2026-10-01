import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';

// Daily doctor-arrival state, held in DoctorAttendance (one row per doctor per
// day). This used to be a JSON file beside the process, which recorded only a
// list of ids for the current day and pruned every other day on each write —
// no arrival time, and no history. The consultation analytics need both.

type AttendanceEntry = { doctorId: number; arrivedAt: Date };

// Date key in Asia/Kolkata so it matches updateDoctorAssignments' todayDate.
export const todayKey = (): string => moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

/** Ids of the doctors marked arrived on a day. Defaults to today. */
export const getArrivedIds = async (date: string = todayKey()): Promise<number[]> => {
  try {
    const rows = await prisma.doctorAttendance.findMany({
      where: { date },
      select: { doctorId: true },
    });
    return rows.map((r) => r.doctorId);
  } catch (error) {
    // Attendance only gates the TV display; a read failure must not take the
    // OPD down with it.
    console.error('Error reading doctor attendance:', error);
    return [];
  }
};

/** Back-compat alias — the TV assignment job still asks for "today". */
export const getTodayIds = (): Promise<number[]> => getArrivedIds();

/** Arrival times for a day, for callers that need when and not just who. */
export const getArrivals = async (date: string = todayKey()): Promise<AttendanceEntry[]> => {
  try {
    const rows = await prisma.doctorAttendance.findMany({
      where: { date },
      select: { doctorId: true, arrivedAt: true },
    });
    return rows;
  } catch (error) {
    console.error('Error reading doctor attendance:', error);
    return [];
  }
};

/**
 * Arrival times for a date range, keyed "doctorId|date". Used by the
 * consultation summary, which reports across a range and would otherwise need
 * one query per day.
 */
export const getArrivalsInRange = async (
  from: string,
  to: string,
): Promise<Map<string, Date>> => {
  const map = new Map<string, Date>();
  try {
    const rows = await prisma.doctorAttendance.findMany({
      where: { date: { gte: from, lte: to } },
      select: { doctorId: true, date: true, arrivedAt: true },
    });
    for (const r of rows) map.set(`${r.doctorId}|${r.date}`, r.arrivedAt);
  } catch (error) {
    console.error('Error reading doctor attendance range:', error);
  }
  return map;
};

export const isArrivedToday = async (doctorId: number): Promise<boolean> =>
  (await getArrivedIds()).includes(doctorId);

/**
 * Mark a doctor arrived today. Idempotent: re-marking keeps the original
 * arrival time rather than pushing it later, because the first mark is the one
 * that reflects when they actually turned up.
 */
export const markArrived = async (doctorId: number, markedBy?: string): Promise<number[]> => {
  const date = todayKey();
  try {
    await prisma.doctorAttendance.upsert({
      where: { doctorId_date: { doctorId, date } },
      create: { doctorId, date, arrivedAt: new Date(), markedBy: markedBy ?? null },
      update: {}, // already arrived — leave arrivedAt alone
    });
  } catch (error) {
    console.error('Error marking doctor arrived:', error);
  }
  return getArrivedIds(date);
};

/** Undo a mark made in error. Deletes the row, so no arrival time survives. */
export const unmarkArrived = async (doctorId: number): Promise<number[]> => {
  const date = todayKey();
  try {
    await prisma.doctorAttendance.deleteMany({ where: { doctorId, date } });
  } catch (error) {
    console.error('Error unmarking doctor arrived:', error);
  }
  return getArrivedIds(date);
};
