import cron from 'node-cron';
import prisma from './prisma-client';
import { securityConfig } from '../config/security-logging';
import { flushAlerts } from './security-alert';

/**
 * Security alerting + retention crons.
 *
 * Wire from src/index.ts:
 *   import { registerSecurityAlertCron, registerSecurityLogPruneCron } from './service/security-alert.cron';
 *   registerSecurityAlertCron();
 *   registerSecurityLogPruneCron();
 */

/**
 * Flush buffered threats as ONE aggregated email every
 * SECURITY_ALERT_INTERVAL_MIN minutes (default 5). Rate-limited by design —
 * we never email per request.
 */
export function registerSecurityAlertCron(): void {
  if (!securityConfig.enabled) {
    console.log('[security-alert-cron] disabled (SECURITY_LOGGING_ENABLED=false)');
    return;
  }
  const minutes = securityConfig.alertIntervalMin;
  // node-cron has no "every N minutes" token for N>59; clamp to 1..59.
  const step = Math.min(Math.max(minutes, 1), 59);
  cron.schedule(`*/${step} * * * *`, async () => {
    try {
      await flushAlerts(Date.now());
    } catch (err) {
      console.error('[security-alert-cron] flush failed:', err);
    }
  });
  console.log(`[security-alert-cron] scheduled every ${step} min`);
}

/**
 * Prune SecurityRequestLog rows older than the retention window, daily at
 * 03:15 local, so the table doesn't grow unbounded.
 */
export function registerSecurityLogPruneCron(): void {
  if (!securityConfig.enabled) return;
  cron.schedule('15 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - securityConfig.retentionDays * 24 * 60 * 60 * 1000);
      const { count } = await prisma.securityRequestLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      console.log(
        `[security-log-prune] deleted ${count} rows older than ${securityConfig.retentionDays} days`
      );
    } catch (err) {
      console.error('[security-log-prune] failed:', err);
    }
  });
  console.log(`[security-log-prune] scheduled daily 03:15 (retention ${securityConfig.retentionDays}d)`);
}
