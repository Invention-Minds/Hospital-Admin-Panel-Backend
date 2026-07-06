import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';

// Daily doctor-arrival state, persisted as a small JSON file (no DB / no Prisma).
// Shape: { "YYYY-MM-DD": number[] }  -> arrived doctor ids per IST day.
// Stored relative to the process working directory so it survives `npm run build`
// (which cleans dist/) and process restarts.
const STORE_PATH = path.join(process.cwd(), 'doctor-attendance.json');

type AttendanceMap = { [date: string]: number[] };

// Date key in Asia/Kolkata so it matches updateDoctorAssignments' todayDate.
export const todayKey = (): string => moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

const readStore = (): AttendanceMap => {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return raw ? (JSON.parse(raw) as AttendanceMap) : {};
  } catch (error) {
    console.error('Error reading attendance store:', error);
    return {};
  }
};

const writeStore = (data: AttendanceMap): void => {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data), 'utf-8');
  } catch (error) {
    console.error('Error writing attendance store:', error);
  }
};

// Drop every date except today so the file doesn't grow unbounded.
const pruneOldDates = (data: AttendanceMap): AttendanceMap => {
  const today = todayKey();
  if (Object.keys(data).length === 1 && data[today]) return data;
  return data[today] ? { [today]: data[today] } : {};
};

export const getTodayIds = (): number[] => {
  const data = readStore();
  return data[todayKey()] ?? [];
};

export const isArrivedToday = (doctorId: number): boolean =>
  getTodayIds().includes(doctorId);

export const markArrived = (doctorId: number): number[] => {
  const data = pruneOldDates(readStore());
  const today = todayKey();
  const ids = new Set(data[today] ?? []);
  ids.add(doctorId);
  data[today] = Array.from(ids);
  writeStore(data);
  return data[today];
};

export const unmarkArrived = (doctorId: number): number[] => {
  const data = pruneOldDates(readStore());
  const today = todayKey();
  data[today] = (data[today] ?? []).filter((id) => id !== doctorId);
  writeStore(data);
  return data[today];
};
