import prisma from '../../service/prisma-client';
import { resolveTargetRole } from '../../service/role-alias';

// Phase 9.25 / Phase 6a — Complaint SLA-breach auto-escalation cron.
//
// Sweeps every 15 minutes for complaints whose slaDueAt has passed but
// haven't been resolved or already escalated. Flips status to 'escalated',
// stamps escalatedAt, and fires a loud bell to the assigned officer (or
// 'admin' as fallback). Idempotent via the `escalatedAt IS NULL` filter.

const FALLBACK_ESCALATION_ROLE = 'admin';

export interface SlaSweepReport {
  checked: number;
  escalated: number;
  failed: number;
  details: Array<{ id: string; code: string; outcome: 'escalated' | 'failed'; error?: string }>;
}

export async function runComplaintSlaSweep(): Promise<SlaSweepReport> {
  const now = new Date();
  const report: SlaSweepReport = { checked: 0, escalated: 0, failed: 0, details: [] };

  const breached = await prisma.complaint.findMany({
    where: {
      status: { notIn: ['resolved', 'escalated', 'cancelled'] },
      slaDueAt: { lt: now },
      escalatedAt: null,
    },
    select: {
      id: true, code: true, severity: true, assignedTo: true, slaDueAt: true,
      patientName: true,
    },
    take: 500,
  });
  report.checked = breached.length;

  for (const c of breached) {
    try {
      await prisma.complaint.update({
        where: { id: c.id },
        data: { status: 'escalated', escalatedAt: now },
      });

      // Best-effort bell — the role string may not match a User.role enum
      // but the row exists for audit either way.
      try {
        const targetRole = await resolveTargetRole(c.assignedTo ?? FALLBACK_ESCALATION_ROLE);
        await prisma.notification.create({
          data: {
            type: 'complaint_sla_breach',
            title: `Complaint SLA breached · ${c.code}`,
            message: `[${c.severity.toUpperCase()}] ${c.patientName ? c.patientName + ' — ' : ''}complaint past SLA due (${c.slaDueAt?.toISOString() ?? 'n/a'}).`,
            status: 'unread',
            targetRole,
            isCritical: true,
            entityId: 0, // entityId is Int; complaint id is uuid → put real id in entityType.
            entityType: `Complaint:${c.id}`,
          },
        });
      } catch (err) {
        console.warn('[complaint-sla:notify] failed:', (err as Error).message);
      }

      report.escalated += 1;
      report.details.push({ id: c.id, code: c.code, outcome: 'escalated' });
    } catch (err) {
      report.failed += 1;
      report.details.push({ id: c.id, code: c.code, outcome: 'failed', error: (err as Error).message });
      console.warn(`[complaint-sla:${c.code}] update failed:`, (err as Error).message);
    }
  }

  return report;
}

// ─── Cron registration (mirrors the incident-rules pattern) ────────────

export const registerComplaintSlaCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('*/15 * * * *', async () => {
    if (isRunning) { console.log('[complaint-sla] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const report = await runComplaintSlaSweep();
      if (report.escalated > 0) {
        console.log(`[complaint-sla] sweep escalated ${report.escalated}/${report.checked} complaint(s)` +
          (report.failed > 0 ? ` · ${report.failed} failed` : ''));
      }
    } catch (err) {
      console.error('Error in complaint-sla cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Complaint SLA breach cron initialized (runs every 15 min)');
};
