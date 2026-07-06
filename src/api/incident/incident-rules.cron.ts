import { runAllCronRules } from './rule-catalogue';

// Phase 9.24 / Phase 2 — Incident auto-capture cron.
//
// Sweeps every 15 minutes for time-bound incident rules. On-write rules don't
// need this — controllers raise them inline. The 24h dedupe in
// raiseAutoIncident keeps a sweep from creating duplicate rows.

export const registerIncidentRulesCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-invariant, @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  // Re-entry guard — protects the Prisma pool from stacked sweeps under load.
  let isRunning = false;
  cron.schedule('*/15 * * * *', async () => {
    if (isRunning) { console.log('[incident-rules] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const { raised, checked } = await runAllCronRules();
      if (raised > 0) {
        console.log(`[incident-rules] sweep raised ${raised}/${checked} incident(s)`);
      }
    } catch (err) {
      console.error('Error in incident-rules cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Incident-rules cron job initialized (runs every 15 min)');
};
