import cron from 'node-cron';
import moment from 'moment-timezone';
import prisma from './prisma-client';

/**
 * App-store reviewer demo — keeps the Google Play / Apple review login
 * (PLAYREVIEW → doctor DEMO_REVIEWER_DOCTOR_ID) looking like a fresh working
 * day. Reviewers and Play's test robots use that account, so they acknowledge
 * the critical results and work through the OPD queue; and OPD visits are
 * dated, so yesterday's queue is empty today.
 *
 * Off unless DEMO_REVIEWER_DOCTOR_ID is set — set it ONLY on the dev/demo
 * server, never on a hospital's server.
 *
 * Touches only:
 *  - today's OPD visits for the demo doctor with the fake 91990000001x numbers
 *    (created if missing — never edited or deleted);
 *  - critical results acknowledged BY THE REVIEWER USER for patients admitted
 *    under the demo doctor (set back to unacknowledged).
 * Rounds need nothing: "seen" only counts today's marks, so it clears at midnight.
 * Discharges are left alone (clinical records; the flow is fine to show).
 */

const TZ = 'Asia/Kolkata';
const DEMO_PHONE_PREFIX = '9199000000';
const ACTIVE_IPD = ['admitted', 'transferred', 'BED_ACCEPTED'];

/** Demo doctor id from the env, or null when the reset is off. */
export function demoReviewerDoctorId(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.DEMO_REVIEWER_DOCTOR_ID?.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Today's date in IST as appointments store it (YYYY-MM-DD). */
export function istDate(now: Date = new Date()): string {
  return moment(now).tz(TZ).format('YYYY-MM-DD');
}

/** The four fictional walk-in visits (fake numbers, example.com emails). */
export function demoVisits() {
  return [
    { patientName: 'Lakshmi Narayan', age: '62', gender: 'Female', time: '10:00 AM', prnNumber: 9900001, BPs: '148', BPd: '92', pulse: '84', spo2: '97', temp: '98.4', weight: '68' },
    { patientName: 'Arjun Shetty', age: '45', gender: 'Male', time: '10:20 AM', prnNumber: 9900003, BPs: '132', BPd: '84', pulse: '78', spo2: '98', temp: '98.6', weight: '81' },
    { patientName: 'Fatima Khan', age: '38', gender: 'Female', time: '10:40 AM', prnNumber: null, BPs: '118', BPd: '76', pulse: '72', spo2: '99', temp: '98.2', weight: '59' },
    { patientName: 'George Mathew', age: '71', gender: 'Male', time: '11:00 AM', prnNumber: null, BPs: '156', BPd: '96', pulse: '90', spo2: '95', temp: '99.1', weight: '74' },
  ].map((v, i) => ({ ...v, phoneNumber: `${DEMO_PHONE_PREFIX}${11 + i}`, email: `demo${i + 1}@example.com` }));
}

export type DemoResetResult = {
  date: string;
  visitsCreated: number;
  criticalsReset: number;
  warnings: string[];
};

export async function resetReviewerDemo(now: Date = new Date()): Promise<DemoResetResult> {
  const doctorId = demoReviewerDoctorId();
  if (!doctorId) throw new Error('Demo reset is off: set DEMO_REVIEWER_DOCTOR_ID (dev/demo server only)');
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true, name: true, departmentName: true, userId: true } });
  if (!doctor) throw new Error(`Demo doctor ${doctorId} not found`);

  const date = istDate(now);
  const warnings: string[] = [];

  // 1) Today's OPD queue.
  let visitsCreated = 0;
  const existing = await prisma.appointment.count({ where: { doctorId, date, phoneNumber: { startsWith: DEMO_PHONE_PREFIX } } });
  if (!existing) {
    for (const v of demoVisits()) {
      await prisma.appointment.create({
        data: {
          ...v,
          doctorId,
          doctorName: doctor.name,
          department: doctor.departmentName ?? 'Cardiology',
          date,
          requestVia: 'Walk-In',
          status: 'confirmed',
          checkedIn: true,
          checkedInTime: now,
          smsSent: true,
          emailSent: true,
          messageSent: true,
        },
      });
      visitsCreated++;
    }
  }

  // 2) Critical results the reviewer acknowledged, for the demo doctor's inpatients.
  const admissions = await prisma.ipdAdmission.findMany({
    where: { admittingDoctorId: doctorId },
    select: { prn: true, status: true },
  });
  for (const a of admissions) {
    if (!ACTIVE_IPD.includes(a.status)) warnings.push(`Demo admission for PRN ${a.prn} is "${a.status}" — not changed`);
  }
  const prns = [...new Set(admissions.map((a) => a.prn))];
  let criticalsReset = 0;
  if (prns.length && doctor.userId) {
    const r = await prisma.investigationResult.updateMany({
      where: { prn: { in: prns }, criticalFlag: true, isDeleted: false, acknowledgedById: doctor.userId, acknowledgedAt: { not: null } },
      data: { acknowledgedAt: null, acknowledgedBy: null, acknowledgedById: null },
    });
    criticalsReset = r.count;
  }

  return { date, visitsCreated, criticalsReset, warnings };
}

/** Daily at 00:05 IST (and once shortly after start). No-op unless DEMO_REVIEWER_DOCTOR_ID is set. */
export function registerDemoResetCron(): void {
  if (!demoReviewerDoctorId()) {
    console.log('[demo-reset] off (DEMO_REVIEWER_DOCTOR_ID not set)');
    return;
  }
  const run = async () => {
    try {
      const r = await resetReviewerDemo();
      console.log(`[demo-reset] ${r.date}: ${r.visitsCreated} OPD visits created · ${r.criticalsReset} critical results reset`);
      r.warnings.forEach((w) => console.warn(`[demo-reset] ${w}`));
    } catch (err) {
      console.error('[demo-reset] failed:', (err as Error).message);
    }
  };
  setTimeout(() => void run(), 90_000);
  cron.schedule('5 0 * * *', () => void run(), { timezone: TZ });
}
