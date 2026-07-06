import cron from 'node-cron';
import { runRollup } from './revenue.controller';

/**
 * Phase 2.5 — Nightly revenue rollup cron.
 *
 * Runs at 00:30 local time. Recomputes rollup for "yesterday" (so the day
 * is fully closed) and for "today" (catches any late same-day payments).
 *
 * Wire from src/index.ts:
 *
 *   import { registerRevenueCron } from './api/revenue/revenue.cron';
 *   registerRevenueCron();
 */

export function registerRevenueCron(): void {
  cron.schedule('30 0 * * *', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const fmt = (d: Date): string => d.toISOString().slice(0, 10);

    try {
      const yResult = await runRollup(fmt(yesterday), 'cron');
      const tResult = await runRollup(fmt(today), 'cron');
      console.log(
        `[revenue-cron] yesterday=${fmt(yesterday)} rows=${yResult.rowsWritten} amt=${yResult.totalAmount} | today=${fmt(today)} rows=${tResult.rowsWritten} amt=${tResult.totalAmount}`
      );
    } catch (err) {
      console.error('[revenue-cron] failed:', err);
    }
  });

  console.log('[revenue-cron] scheduled at 00:30 daily');
}
