import prisma from '../../service/prisma-client';

// Auto-close stale WhatsApp patient queries.
//
// Silent sweep — flips status='closed' for open/answered threads with no patient
// activity for WHATSAPP_AUTOCLOSE_DAYS (default 3). Keeps the doctor inbox clean
// and stats accurate. Closing is silent here (no per-patient WhatsApp notice) to
// avoid 24h-window/template handling on bulk runs; a patient who messages a
// closed thread is told it's closed and routed to start a fresh query.

const AUTOCLOSE_DAYS = Number(process.env.WHATSAPP_AUTOCLOSE_DAYS) || 3;

export interface AutoCloseReport {
  closed: number;
}

export async function runWhatsappAutoCloseSweep(): Promise<AutoCloseReport> {
  const cutoff = new Date(Date.now() - AUTOCLOSE_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.whatsappQuery.updateMany({
    where: { status: { in: ['open', 'answered'] }, lastPatientMsgAt: { lt: cutoff } },
    data: { status: 'closed' },
  });
  return { closed: result.count };
}

export const registerWhatsappAutoCloseCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  // Daily at 01:30 — stale threads accumulate slowly; the sweep is cheap.
  cron.schedule('30 1 * * *', async () => {
    if (isRunning) { console.log('[whatsapp-auto-close] previous sweep still running — skipping'); return; }
    isRunning = true;
    try {
      const report = await runWhatsappAutoCloseSweep();
      if (report.closed > 0) console.log(`[whatsapp-auto-close] closed ${report.closed} stale query(ies)`);
    } catch (err) {
      console.error('[whatsapp-auto-close] sweep failed:', err);
    } finally {
      isRunning = false;
    }
  });
};
