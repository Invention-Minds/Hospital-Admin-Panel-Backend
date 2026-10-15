import prisma from '../../service/prisma-client';
import { complaintHandlerUserIds } from './complaint-sla.cron';

// Phase 9.25 / Phase 6d — Feedback survey reminder sweep.
//
// One-shot bell to the complaint handlers (Quality Manager + Patient
// Relations) when a survey has been pending/sent but unanswered for >72h (and
// isn't yet expired). Nothing sets sentAt until SMS/WhatsApp delivery is
// wired, so age falls back to createdAt. The bell carries the kiosk path so a
// coordinator can chase manually.

const REMINDER_HOURS = 72;
const KIOSK_PATH = '/feedback/k/'; // appended with the token

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
      id: true, token: true, template: true, patientPrn: true, patientName: true,
      sentAt: true, createdAt: true,
    },
    take: 500,
  });

  const report: ReminderSweepReport = {
    checked: stale.length, reminded: 0, failed: 0, details: [],
  };
  if (!stale.length) return report;

  const handlerIds = await complaintHandlerUserIds();

  for (const s of stale) {
    try {
      // Conditional flip = one-shot dedupe even if a manual sweep overlaps.
      const flipped = await prisma.feedbackSurvey.updateMany({
        where: { id: s.id, lastReminderAt: null },
        data: { lastReminderAt: now },
      });
      if (flipped.count !== 1) continue;

      try {
        if (handlerIds.length > 0) {
          const since = s.sentAt ? `Sent ${s.sentAt.toISOString()}` : `Created ${s.createdAt.toISOString()}`;
          await prisma.notification.createMany({
            data: handlerIds.map((userId) => ({
              type: 'feedback_reminder',
              title: `Survey pending · ${s.patientName ?? s.patientPrn ?? s.template}`,
              message: `${since} · ${REMINDER_HOURS}h+ unanswered. Kiosk path: ${KIOSK_PATH}${s.token}`,
              status: 'unread',
              isCritical: false,
              entityId: 0, // entityId is Int; surveys are uuid → put real id in entityType
              entityType: `FeedbackSurvey:${s.id}`,
              userId,
            })),
          });
        }
      } catch (err) {
        console.warn('[feedback-reminder:notify] failed:', (err as Error).message);
      }

      report.reminded += 1;
      report.details.push({ surveyId: s.id, outcome: 'reminded' });
    } catch (err) {
      report.failed += 1;
      report.details.push({ surveyId: s.id, outcome: 'failed', error: (err as Error).message });
      console.warn(`[feedback-reminder:${s.id}] failed:`, (err as Error).message);
    }
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
