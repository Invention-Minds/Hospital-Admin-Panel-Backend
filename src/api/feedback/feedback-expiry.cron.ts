import prisma from '../../service/prisma-client';

// Phase 9.25 / Phase 6d — Feedback survey expiry sweep.
//
// Silent cron — flips status='expired' for surveys past expiresAt that
// haven't been completed. The kiosk submit endpoint already rejects
// expired tokens; this just keeps `status` accurate for inbox stats so
// dashboards aren't poisoned by stale 'sent' rows.

export interface ExpirySweepReport {
  checked: number;
  expired: number;
}

export async function runFeedbackExpirySweep(): Promise<ExpirySweepReport> {
  const now = new Date();
  const result = await prisma.feedbackSurvey.updateMany({
    where: {
      status: { notIn: ['completed', 'expired'] },
      expiresAt: { lt: now, not: null },
    },
    data: { status: 'expired' },
  });
  return { checked: result.count, expired: result.count };
}

export const registerFeedbackExpiryCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  // Hourly — status drift accumulates fast and the operation is cheap.
  cron.schedule('0 * * * *', async () => {
    if (isRunning) { console.log('[feedback-expiry] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const report = await runFeedbackExpirySweep();
      if (report.expired > 0) {
        console.log(`[feedback-expiry] sweep expired ${report.expired} survey(s)`);
      }
    } catch (err) {
      console.error('Error in feedback-expiry cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Feedback survey expiry cron initialized (runs hourly)');
};
