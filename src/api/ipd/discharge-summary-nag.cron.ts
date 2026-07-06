import prisma from '../../service/prisma-client';
import { resolveTargetRole } from '../../service/role-alias';

// Phase D — Discharge summary nag cron.
//
// Every 15 minutes, finds admissions where the ward doctor flipped
// "ready for discharge" but the summary is still not SIGNED, and pings the
// assigned doctor. After NAG_ESCALATE_AFTER consecutive nags without a sign,
// escalates to the HOD role.
//
// State stored: IpdDischarge.mtAcknowledgedAt + clinicianSignedAt + the
// computed cycles-since-ready figure. We don't persist a "nags sent" counter
// — the doctor either signs the summary or the escalation fires when the age
// crosses the escalation threshold. Simpler and survives restarts.

const NAG_INTERVAL_MIN = 15;
const NAG_ESCALATE_AFTER_CYCLES = 2; // after 2 missed cycles → 30 min → HOD

interface NagRow {
  id: string;
  admissionNo: string;
  admittingDoctor: string;
  department: string;
  dischargeReadyAt: Date;
}

async function findOverdueAdmissions(now: Date): Promise<NagRow[]> {
  const cutoff = new Date(now.getTime() - NAG_INTERVAL_MIN * 60 * 1000);
  // Admissions where ready was flipped > NAG_INTERVAL_MIN ago and summary
  // isn't signed yet. We don't filter by "last notified" — running every 15
  // min naturally aligns the nag cadence.
  const rows = await prisma.ipdAdmission.findMany({
    where: {
      dischargeReadyAt: { lt: cutoff, not: null },
      dischargeChainAbandoned: false,
      status: { notIn: ['discharged', 'LAMA', 'DAMA', 'expired'] },
      OR: [
        { discharge: null },
        { discharge: { summaryStatus: { notIn: ['SIGNED', 'DELIVERED'] } } },
      ],
    },
    select: {
      id: true, admissionNo: true, admittingDoctor: true, department: true,
      dischargeReadyAt: true,
    },
    take: 500,
  });
  return rows.filter((r): r is NagRow => !!r.dischargeReadyAt);
}

async function nagDoctor(row: NagRow, escalate: boolean): Promise<void> {
  const targetAlias = escalate
    ? `hod_${(row.department ?? '').toLowerCase().replace(/\s+/g, '_')}`
    : 'doctor';
  const targetRole = await resolveTargetRole(targetAlias);
  const minsLate = Math.floor((Date.now() - row.dischargeReadyAt.getTime()) / 60_000);
  const subject = escalate
    ? `Discharge summary overdue · ${row.admissionNo}`
    : `Discharge summary pending · ${row.admissionNo}`;
  const body = escalate
    ? `${row.admittingDoctor ?? 'Assigned doctor'} hasn't signed the discharge summary ${minsLate} min after ready-flag — escalating to HOD.`
    : `${row.admittingDoctor ?? 'You'} flagged this patient ready ${minsLate} min ago. Please sign the discharge summary.`;
  try {
    await prisma.notification.create({
      data: {
        type: escalate ? 'discharge_summary_escalation' : 'discharge_summary_nag',
        title: subject,
        message: body,
        status: 'unread',
        targetRole: targetRole ?? undefined,
        isCritical: escalate,
        entityId: 0,
        entityType: `IpdAdmission:${row.id}`,
      },
    });
  } catch (err) {
    console.warn('[discharge-nag]', row.admissionNo, 'notify failed:', (err as Error).message);
  }
}

export async function runDischargeSummaryNagSweep(): Promise<{ checked: number; nagged: number; escalated: number }> {
  const now = new Date();
  const overdue = await findOverdueAdmissions(now);

  let nagged = 0;
  let escalated = 0;
  for (const row of overdue) {
    const minsLate = Math.floor((now.getTime() - row.dischargeReadyAt.getTime()) / 60_000);
    const cycles = Math.floor(minsLate / NAG_INTERVAL_MIN);
    const isEscalate = cycles >= NAG_ESCALATE_AFTER_CYCLES;
    await nagDoctor(row, isEscalate);
    if (isEscalate) escalated += 1; else nagged += 1;
  }
  return { checked: overdue.length, nagged, escalated };
}

export const registerDischargeSummaryNagCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('*/15 * * * *', async () => {
    if (isRunning) { console.log('[discharge-nag] previous sweep still running — skipping'); return; }
    isRunning = true;
    try {
      const summary = await runDischargeSummaryNagSweep();
      if (summary.nagged + summary.escalated > 0) {
        console.log(`[discharge-nag] checked=${summary.checked} nagged=${summary.nagged} escalated=${summary.escalated}`);
      }
    } catch (err) {
      console.error('Error in discharge-nag cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Discharge-summary nag cron initialized (runs every 15 min)');
};
