import { refreshAllSnapshots } from './acuity-snapshot.service';

// Phase 9.13 — Treatment Dashboard acuity-refresh cron.
//
// Vitals writes already trigger a snapshot via the on-write hook, so this
// cron is the safety net: it recomputes every admitted patient every 30
// minutes. That keeps the "vitals overdue" / staleness signals honest even
// for patients whose vitals haven't been touched, and re-bands anyone whose
// thresholds shifted. Registered once at startup from src/index.ts.

export const registerAcuityRefreshCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  // Every 30 minutes.
  cron.schedule('*/30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] 🩺 Refreshing NEWS2 acuity snapshots...`);
    try {
      const result = await refreshAllSnapshots();
      console.log(`   → acuity refresh: ${result.scored}/${result.processed} admissions scored`);
    } catch (error) {
      console.error('Error in acuity-refresh cron job:', error);
    }
  });
  console.log('✅ Acuity-refresh cron job initialized (runs every 30 min)');
};
