import prisma from '../../service/prisma-client';
import { resolveTargetRole } from '../../service/role-alias';
import { PATIENT_RELATIONS, QUALITY_MANAGER } from '../_shared/quality-roles';

// Phase 9.25 / Phase 6a — Complaint SLA-breach auto-escalation cron.
//
// Sweeps every 15 minutes for complaints whose slaDueAt has passed but
// haven't been resolved or already escalated. Flips status to 'escalated',
// stamps escalatedAt, and fires a loud bell to the assignee (or every
// complaint handler when unassigned). Idempotent: the flip is a conditional
// updateMany on `escalatedAt IS NULL`, and only the run that wins it notifies,
// so the cron and a manual sweep can't double-notify.

const FALLBACK_ESCALATION_ROLE = 'admin';

export interface SlaSweepReport {
  checked: number;
  escalated: number;
  failed: number;
  details: Array<{ id: string; code: string; outcome: 'escalated' | 'failed'; error?: string }>;
}

/**
 * User ids of the complaint handlers (Quality Manager admins + Patient
 * Relations sub-admins). Notifications are per-user because the bell matches
 * on userId; role strings don't map onto adminType / subAdminType.
 */
export async function complaintHandlerUserIds(): Promise<number[]> {
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { role: 'admin', adminType: QUALITY_MANAGER },
        { subAdminType: PATIENT_RELATIONS },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
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
      id: true, code: true, severity: true, assignedToId: true, slaDueAt: true,
      patientName: true,
    },
    take: 500,
  });
  report.checked = breached.length;

  let handlerIds: number[] | null = null;

  for (const c of breached) {
    try {
      const flipped = await prisma.complaint.updateMany({
        where: { id: c.id, escalatedAt: null, status: { notIn: ['resolved', 'escalated', 'cancelled'] } },
        data: { status: 'escalated', escalatedAt: now },
      });
      if (flipped.count !== 1) continue; // another sweep / a manual action got there first

      try {
        const base = {
          type: 'complaint_sla_breach',
          title: `Complaint SLA breached · ${c.code}`,
          message: `[${c.severity.toUpperCase()}] ${c.patientName ? c.patientName + ' — ' : ''}complaint past SLA due (${c.slaDueAt?.toISOString() ?? 'n/a'}).`,
          status: 'unread',
          isCritical: true,
          entityId: 0, // entityId is Int; complaint id is uuid → put real id in entityType.
          entityType: `Complaint:${c.id}`,
        };
        if (c.assignedToId) {
          await prisma.notification.create({ data: { ...base, userId: c.assignedToId } });
        } else {
          handlerIds ??= await complaintHandlerUserIds();
          if (handlerIds.length > 0) {
            await prisma.notification.createMany({ data: handlerIds.map((userId) => ({ ...base, userId })) });
          } else {
            await prisma.notification.create({
              data: { ...base, targetRole: await resolveTargetRole(FALLBACK_ESCALATION_ROLE) },
            });
          }
        }
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
