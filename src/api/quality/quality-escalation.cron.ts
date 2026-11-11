import prisma from '../../service/prisma-client';
import { auditLogSystem } from '../../service/app-audit';
import { sendEscalationAlerts } from '../../service/staff-alerts';
import {
  loadEscalationMatrix, resolveTargetUserIds, type EscalationModule, type EscalationLevelDef,
} from '../../service/quality-escalation';

// Quality escalation matrix sweep (incidents + complaints).
//
// Every 10 minutes: for each open case whose escalation clock has started
// (escalationStartAt set — cases raised before the matrix went live are
// skipped), fire the next level of the module × severity matrix once
// `afterMinutes` have passed since the clock started. One level per case per
// run; the level bump is a conditional updateMany on the current level, so a
// manual sweep and the cron can't double-fire. Each fired level bells its
// targets and writes an ESCALATE row to AppAuditLog (the case timeline).
// Mirrors emergency/referral-escalation.cron.ts.

const INCIDENT_OPEN = ['open', 'triaged', 'investigated', 'capa_in_progress'];
const COMPLAINT_OPEN = ['open', 'acknowledged', 'escalated'];
const BATCH = 2000;

export interface EscalationSweepReport {
  checked: number;
  escalated: number;
  details: Array<{ module: EscalationModule; id: string; code: string; level: number; recipients: number }>;
}

interface OpenCase {
  id: string; code: string; severity: string; unitId: number | null;
  escalationLevel: number; escalationStartAt: Date | null;
}

async function unitNames(): Promise<Map<number, string>> {
  const units = await prisma.hospitalUnit.findMany({ select: { id: true, name: true } });
  return new Map(units.map((u) => [u.id, u.name]));
}

/** `ids` limits the sweep to specific incident / complaint ids (one-case manual sweep). */
export async function runQualityEscalationSweep(
  now: Date = new Date(), opts: { ids?: string[] } = {},
): Promise<EscalationSweepReport> {
  const report: EscalationSweepReport = { checked: 0, escalated: 0, details: [] };
  const matrix = await loadEscalationMatrix();
  const names = await unitNames();
  const idFilter = opts.ids ? { id: { in: opts.ids } } : {};

  const incidents = await prisma.incident.findMany({
    where: { status: { in: INCIDENT_OPEN }, escalationStartAt: { not: null }, ...idFilter },
    select: {
      id: true, code: true, severity: true, severityFinal: true, unitId: true,
      escalationLevel: true, escalationStartAt: true,
    },
    orderBy: { escalationStartAt: 'asc' },
    take: BATCH,
  });
  const complaints = await prisma.complaint.findMany({
    where: { status: { in: COMPLAINT_OPEN }, escalationStartAt: { not: null }, ...idFilter },
    select: { id: true, code: true, severity: true, unitId: true, escalationLevel: true, escalationStartAt: true },
    orderBy: { escalationStartAt: 'asc' },
    take: BATCH,
  });
  report.checked = incidents.length + complaints.length;

  const cases: Array<{ module: EscalationModule; c: OpenCase }> = [
    // Post-investigation severity wins for incidents.
    ...incidents.map((i) => ({ module: 'incident' as const, c: { ...i, severity: i.severityFinal ?? i.severity } })),
    ...complaints.map((c) => ({ module: 'complaint' as const, c })),
  ];

  for (const { module, c } of cases) {
    try {
      const levels = matrix[module][c.severity]?.levels ?? [];
      const next: EscalationLevelDef | undefined = levels.find((l) => l.level === c.escalationLevel + 1);
      if (!next || !c.escalationStartAt) continue; // matrix exhausted / not configured
      const elapsedMin = (now.getTime() - c.escalationStartAt.getTime()) / 60_000;
      if (elapsedMin < next.afterMinutes) continue;

      const where = { id: c.id, escalationLevel: c.escalationLevel };
      const data = { escalationLevel: next.level, lastEscalatedAt: now };
      const { count } = module === 'incident'
        ? await prisma.incident.updateMany({ where: { ...where, status: { in: INCIDENT_OPEN } }, data })
        : await prisma.complaint.updateMany({ where: { ...where, status: { in: COMPLAINT_OPEN } }, data });
      if (count !== 1) continue; // closed / bumped concurrently

      const recipients = await resolveTargetUserIds(next.targets, c.unitId);
      const unit = c.unitId ? names.get(c.unitId) ?? null : null;
      const entity = module === 'incident' ? 'Incident' : 'Complaint';
      const critical = next.level >= 2 || ['sentinel', 'major', 'high'].includes(c.severity);
      if (recipients.length > 0) {
        await prisma.notification.createMany({
          data: recipients.map((userId) => ({
            type: module === 'incident' ? 'incident_escalated' : 'complaint_escalated',
            title: `Escalation L${next.level} · ${c.code}`,
            message: `[${c.severity.toUpperCase()}] ${next.label ?? `Open ${Math.floor(elapsedMin / 60)}h`}` +
              `${unit ? ` · Unit: ${unit}` : ' · No unit assigned'} — still open, please act.`,
            status: 'unread',
            isCritical: critical,
            entityId: 0,
            entityType: `${entity}:${c.id}`,
            userId,
          })),
        });
      }
      // Optional phone alerts for this level (off unless enabled + template approved).
      let phone = { whatsapp: 0, sms: 0 };
      if (next.notifyWhatsapp || next.notifySms) {
        phone = await sendEscalationAlerts(recipients, {
          level: next.level, module: entity, code: c.code, severity: c.severity, unit,
          refId: `${entity}:${c.id}:L${next.level}`,
        }, { whatsapp: !!next.notifyWhatsapp, sms: !!next.notifySms }).catch(() => ({ whatsapp: 0, sms: 0 }));
      }
      await auditLogSystem({
        module, action: 'ESCALATE', entityType: entity, entityId: c.id, source: 'quality-escalation',
        payload: { level: next.level, label: next.label ?? null, targets: next.targets, recipients: recipients.length, unitId: c.unitId, ...(phone.whatsapp || phone.sms ? { phone } : {}) },
      });
      report.escalated += 1;
      report.details.push({ module, id: c.id, code: c.code, level: next.level, recipients: recipients.length });
    } catch (err) {
      console.warn(`[quality-escalation:${c.code}] failed:`, (err as Error).message);
    }
  }
  return report;
}

export const registerQualityEscalationCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('*/10 * * * *', async () => {
    if (isRunning) { console.log('[quality-escalation] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const r = await runQualityEscalationSweep();
      if (r.escalated > 0) console.log(`[quality-escalation] escalated ${r.escalated}/${r.checked} open case(s)`);
    } catch (err) {
      console.error('Error in quality-escalation cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Quality escalation matrix cron initialized (runs every 10 min)');
};
