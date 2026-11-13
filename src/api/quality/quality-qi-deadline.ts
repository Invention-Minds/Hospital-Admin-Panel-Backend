import moment from 'moment-timezone';
import { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import { QI_TZ, monthWindow, AUTO_SOURCE_CODES } from './quality-indicator-auto-source';
import { resolveTargetRole } from '../../service/role-alias';

// Monthly QI submission deadline + reminders (eFeedor gap: "October due 8 Nov").
//
// Data for month M is due on day `submissionDueDay` (QualityConfig, default 8)
// of month M+1. A daily 09:00 IST sweep sends ONE summary bell per stage while
// last month's data is incomplete:
//   opened     the 1st (after the 02:00 auto-source run)
//   due_soon   3 days before the due day
//   due_today  on the due day
//   overdue_n  the day after, then every 7 days until month end
// QualityQiReminder records each (period, stage) sent, so a dismissed bell
// (a click deletes it) is not re-sent and two servers can't both send it.
// Replaces the old weekly per-indicator `qi_data_missing` cron, which
// only fired after day 5 and sent one bell per missing indicator.

export const DEFAULT_DUE_DAY = 8;
export const MIN_DUE_DAY = 1;
export const MAX_DUE_DAY = 28; // every month has a 28th
const DUE_SOON_DAYS = 3;
export const BELL_TYPE = 'qi_submission_due';
const AUTO_CODES = new Set(AUTO_SOURCE_CODES);

export async function getDueDay(): Promise<number> {
  const row = await prisma.qualityConfig.findUnique({ where: { id: 1 }, select: { submissionDueDay: true } });
  return row?.submissionDueDay ?? DEFAULT_DUE_DAY;
}

export async function setDueDay(day: number, userId: number | null): Promise<number> {
  const row = await prisma.qualityConfig.upsert({
    where: { id: 1 },
    create: { id: 1, submissionDueDay: day, updatedById: userId },
    update: { submissionDueDay: day, updatedById: userId },
  });
  return row.submissionDueDay;
}

/** The month whose data is currently being collected: last month. */
export const submissionPeriod = (now: Date = new Date()): string =>
  moment(now).tz(QI_TZ).subtract(1, 'month').format('YYYY-MM');

/** End of the due day (IST) for a 'YYYY-MM' period. */
export function dueDateFor(period: string, dueDay: number): Date {
  return moment.tz(period, 'YYYY-MM', true, QI_TZ).add(1, 'month').date(dueDay).endOf('day').toDate();
}

export type SubmissionState = 'not_started' | 'open' | 'due_soon' | 'due_today' | 'overdue' | 'complete';

export interface MissingIndicator {
  qiCode: string; name: string; chapter: string; escalationOwner: string;
  /** Filled by the 1st-of-month auto-source; missing means its source data / denominator is absent. */
  autoSourced: boolean;
}

export interface SubmissionStatus {
  period: string;
  dueDay: number;
  dueDate: string;   // ISO, end of the due day IST
  daysLeft: number;  // calendar days to the due day (negative = overdue)
  state: SubmissionState;
  expected: number;
  entered: number;
  enteredLate: number; // records first saved after the due date
  missing: MissingIndicator[];
}

/** Calendar days from `now` to the due day, both in IST. */
function daysUntil(due: Date, now: Date): number {
  const a = moment(now).tz(QI_TZ).startOf('day');
  const b = moment(due).tz(QI_TZ).startOf('day');
  return b.diff(a, 'days');
}

/**
 * Entry status for one month. Expected = active indicators with a Monthly
 * frequency (same set the old data-quality sweep checked).
 */
export async function getSubmissionStatus(period: string, now: Date = new Date()): Promise<SubmissionStatus> {
  const window = monthWindow(period);
  if (!window) throw new Error(`Bad period ${period}`);
  const dueDay = await getDueDay();
  const due = dueDateFor(period, dueDay);

  const indicators = await prisma.qualityIndicator.findMany({
    where: { isActive: true, frequency: { contains: 'Monthly' } },
    select: { id: true, qiCode: true, name: true, chapter: true, escalationOwner: true },
    orderBy: [{ chapter: 'asc' }, { qiCode: 'asc' }],
  });
  const records = await prisma.qualityIndicatorRecord.findMany({
    where: { period, indicatorId: { in: indicators.map((i) => i.id) } },
    select: { indicatorId: true, createdAt: true },
  });
  const have = new Set(records.map((r) => r.indicatorId));
  const missing = indicators.filter((i) => !have.has(i.id)).map((i) => ({
    qiCode: i.qiCode, name: i.name, chapter: i.chapter, escalationOwner: i.escalationOwner,
    autoSourced: AUTO_CODES.has(i.qiCode),
  }));

  const daysLeft = daysUntil(due, now);
  let state: SubmissionState;
  if (now < window.periodEnd) state = 'not_started';
  else if (missing.length === 0) state = 'complete';
  else if (daysLeft < 0) state = 'overdue';
  else if (daysLeft === 0) state = 'due_today';
  else if (daysLeft <= DUE_SOON_DAYS) state = 'due_soon';
  else state = 'open';

  return {
    period, dueDay, dueDate: due.toISOString(), daysLeft, state,
    expected: indicators.length,
    entered: indicators.length - missing.length,
    enteredLate: records.filter((r) => r.createdAt > due).length,
    missing,
  };
}

/**
 * Reminder stage reached today for last month's data, or null when nothing
 * is due today. Only the latest stage is returned — after downtime we send
 * one catch-up bell, not every stage that was missed.
 */
export function stageFor(now: Date, dueDay: number): string | null {
  const today = moment(now).tz(QI_TZ);
  const day = today.date();
  if (day > dueDay) return `overdue_${Math.floor((day - dueDay - 1) / 7) + 1}`;
  if (day === dueDay) return 'due_today';
  if (day >= dueDay - DUE_SOON_DAYS) return 'due_soon';
  return 'opened';
}

const fmtMonth = (period: string): string => moment.tz(period, 'YYYY-MM', QI_TZ).format('MMMM YYYY');

function chapterSummary(missing: MissingIndicator[]): string {
  const by = new Map<string, number>();
  for (const m of missing) by.set(m.chapter, (by.get(m.chapter) ?? 0) + 1);
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`);
  return parts.length > 6 ? `${parts.slice(0, 6).join(', ')}, …` : parts.join(', ');
}

export function reminderText(s: SubmissionStatus, stage: string): { title: string; message: string } {
  const month = fmtMonth(s.period);
  const dueText = moment(s.dueDate).tz(QI_TZ).format('D MMM');
  const left = s.missing.length;
  const when = stage === 'due_today' ? `due today (${dueText})`
    : stage.startsWith('overdue') ? `was due ${dueText} — ${-s.daysLeft} day(s) overdue`
      : `due ${dueText} (${s.daysLeft} day(s) left)`;
  const title = stage.startsWith('overdue') ? `QI data overdue · ${month}`
    : stage === 'due_today' ? `QI data due today · ${month}`
      : `QI data due · ${month}`;
  return {
    title,
    message: `${month} quality indicators: ${s.entered} of ${s.expected} entered, ${left} missing (${chapterSummary(s.missing)}) — ${when}.`,
  };
}

export interface ReminderReport {
  period: string; stage: string | null; missing: number;
  sent: boolean; reason?: string;
}

/** Daily sweep. `now` is injectable for tests. Never sends the same (period, stage) twice. */
export async function runQiDeadlineReminders(now: Date = new Date()): Promise<ReminderReport> {
  const period = submissionPeriod(now);
  const dueDay = await getDueDay();
  const stage = stageFor(now, dueDay);
  if (!stage) return { period, stage, missing: 0, sent: false, reason: 'no stage today' };

  const status = await getSubmissionStatus(period, now);
  if (status.missing.length === 0) return { period, stage, missing: 0, sent: false, reason: 'all entered' };

  try {
    await prisma.qualityQiReminder.create({ data: { period, stage, missing: status.missing.length } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { period, stage, missing: status.missing.length, sent: false, reason: 'already sent' };
    }
    throw err;
  }

  const { title, message } = reminderText(status, stage);
  await prisma.notification.create({
    data: {
      type: BELL_TYPE, title, message, status: 'unread',
      targetRole: await resolveTargetRole('Quality Manager'),
      isCritical: stage.startsWith('overdue'),
      entityId: 0, entityType: `QiSubmission:${period}`,
    },
  });
  return { period, stage, missing: status.missing.length, sent: true };
}

export const registerQiDeadlineCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('0 9 * * *', async () => {
    if (isRunning) { console.log('[qi-deadline] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const r = await runQiDeadlineReminders();
      if (r.sent) console.log(`[qi-deadline] ${r.period} ${r.stage}: ${r.missing} missing → bell sent`);
    } catch (err) {
      console.error('Error in qi-deadline cron:', err);
    } finally {
      isRunning = false;
    }
  }, { timezone: QI_TZ });
  console.log('✅ QI submission deadline reminder cron initialized (daily 09:00 IST)');
};
