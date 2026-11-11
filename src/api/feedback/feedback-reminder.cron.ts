import prisma from '../../service/prisma-client';
import { complaintHandlerUserIds } from './complaint-sla.cron';

// Phase 9.25 / Phase 6d — Feedback survey reminder sweep.
//
// Each survey pending/sent but unanswered for >72h (and not yet expired) is
// counted once (lastReminderAt), and the complaint handlers (Quality Manager +
// Patient Relations) get one digest bell per sweep. Age is sentAt when the
// WhatsApp send went out, else createdAt.

const REMINDER_HOURS = 72;

export interface ReminderSweepReport {
  checked: number;
  reminded: number;
  failed: number;
  details: Array<{ surveyId: string; outcome: 'reminded' | 'failed'; error?: string }>;
}

export async function runFeedbackReminderSweep(): Promise<ReminderSweepReport> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REMINDER_HOURS * 60 * 60 * 1000);

  const stale = await prisma.feedbackSurvey.findMany({
    where: {
      status: { in: ['pending', 'sent'] },
      respondedAt: null,
      lastReminderAt: null,
      expiresAt: { gt: now },
      OR: [
        { sentAt: { lt: cutoff } },
        { sentAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true, template: true,
    },
    take: 500,
  });

  const report: ReminderSweepReport = {
    checked: stale.length, reminded: 0, failed: 0, details: [],
  };
  if (!stale.length) return report;

  // Conditional flip per row = one-shot dedupe even if a manual sweep overlaps.
  const flippedIds: string[] = [];
  for (const s of stale) {
    try {
      const flipped = await prisma.feedbackSurvey.updateMany({
        where: { id: s.id, lastReminderAt: null },
        data: { lastReminderAt: now },
      });
      if (flipped.count !== 1) continue;
      flippedIds.push(s.id);
      report.reminded += 1;
      report.details.push({ surveyId: s.id, outcome: 'reminded' });
    } catch (err) {
      report.failed += 1;
      report.details.push({ surveyId: s.id, outcome: 'failed', error: (err as Error).message });
      console.warn(`[feedback-reminder:${s.id}] failed:`, (err as Error).message);
    }
  }
  if (flippedIds.length === 0) return report;

  // One digest bell per handler per sweep — not one per survey (that was
  // handlers × every unanswered visit). No tokens in the text: a bell is not
  // the place for a live, unauthenticated survey link.
  try {
    const handlerIds = await complaintHandlerUserIds();
    if (handlerIds.length > 0) {
      const byTemplate = new Map<string, number>();
      for (const s of stale) {
        if (flippedIds.includes(s.id)) byTemplate.set(s.template, (byTemplate.get(s.template) ?? 0) + 1);
      }
      const breakdown = [...byTemplate.entries()].map(([t, n]) => `${t}: ${n}`).join(', ');
      const n = flippedIds.length;
      await prisma.notification.createMany({
        data: handlerIds.map((userId) => ({
          type: 'feedback_reminder',
          title: `${n} feedback survey${n === 1 ? '' : 's'} unanswered > ${REMINDER_HOURS}h`,
          message: `${breakdown}. Open the feedback inbox to follow up.`,
          status: 'unread',
          isCritical: false,
          entityId: 0,
          entityType: 'FeedbackSurvey:digest',
          userId,
        })),
      });
    }
  } catch (err) {
    console.warn('[feedback-reminder:notify] failed:', (err as Error).message);
  }

  return report;
}

export const registerFeedbackReminderCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  // Every 4h — reminders accumulate slowly and bell-spam isn't useful.
  cron.schedule('0 */4 * * *', async () => {
    if (isRunning) { console.log('[feedback-reminder] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const report = await runFeedbackReminderSweep();
      if (report.reminded > 0) {
        console.log(`[feedback-reminder] sweep reminded ${report.reminded}/${report.checked} survey(s)` +
          (report.failed > 0 ? ` · ${report.failed} failed` : ''));
      }
    } catch (err) {
      console.error('Error in feedback-reminder cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Feedback survey reminder cron initialized (runs every 4 hours)');
};
