import prisma from '../../service/prisma-client';
import { resolveTargetRole } from '../../service/role-alias';

// Phase 9.25 / Phase 6d — Feedback survey reminder sweep.
//
// One-shot bell to the patient-experience role when a survey has been sent
// but unanswered for >72h (and isn't yet expired). The bell carries the
// kiosk token so a coordinator can copy the follow-up link and chase
// manually. Once Phase 6b wires SMS/WhatsApp delivery, this is where the
// outbound send-attempt hook goes.

const REMINDER_HOURS = 72;
const TARGET_ROLE = 'patient_experience';
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
      status: 'sent',
      respondedAt: null,
      sentAt: { lt: cutoff, not: null },
      expiresAt: { gt: now },
      lastReminderAt: null,
    },
    select: {
      id: true, token: true, template: true, patientPrn: true, patientName: true,
      sentAt: true,
    },
    take: 500,
  });

  const report: ReminderSweepReport = {
    checked: stale.length, reminded: 0, failed: 0, details: [],
  };

  for (const s of stale) {
    try {
      await prisma.feedbackSurvey.update({
        where: { id: s.id },
        data: { lastReminderAt: now },
      });

      try {
        const link = `${KIOSK_PATH}${s.token}`;
        const targetRole = await resolveTargetRole(TARGET_ROLE);
        await prisma.notification.create({
          data: {
            type: 'feedback_reminder',
            title: `Survey pending · ${s.patientName ?? s.patientPrn ?? s.template}`,
            message: `Sent ${s.sentAt?.toISOString() ?? 'n/a'} · ${REMINDER_HOURS}h overdue. Kiosk path: ${link}`,
            status: 'unread',
            targetRole,
            isCritical: false,
            entityId: 0, // entityId is Int; surveys are uuid → put real id in entityType
            entityType: `FeedbackSurvey:${s.id}`,
          },
        });
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
