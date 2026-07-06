import cron from 'node-cron';
import { moveExhaustedFailuresToDeadLetter } from './hmis-hardening.controller';

/**
 * Phase 9 — schedules the dead-letter mover.
 *
 * Runs every 15 minutes. The mover is idempotent (skips rows already in
 * HmisDeadLetter), so missing or overlapping ticks are harmless. Picks audit
 * rows with status='failed' AND retryCount>=3 AND quarantinedAt IS NULL,
 * copies them into HmisDeadLetter, and stamps the audit row as status='dead'.
 */
export function registerHmisHardeningCron(): void {
  // “*/15 * * * *” = every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const moved = await moveExhaustedFailuresToDeadLetter();
      if (moved > 0) {
        console.log(`[hmis-hardening] dead-letter mover: ${moved} row(s) quarantined`);
      }
    } catch (err) {
      console.error('[hmis-hardening] dead-letter mover failed:', err);
    }
  });
  console.log('[hmis-hardening] dead-letter mover scheduled (*/15 minutes)');
}
