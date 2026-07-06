import prisma from '../../service/prisma-client';

// Phase 9.19 — Emergency referral escalation cron.
//
// Every few minutes, find referrals still `pending` past their SLA and climb
// the per-department escalation chain: one level per SLA interval elapsed.
// Each new level notifies the chain step's target (a doctor or a role) via
// the in-app bell. Acknowledged/cancelled referrals are skipped; when the
// chain is exhausted, nothing more happens. Registered once from index.ts.

export const runEscalationSweep = async (): Promise<{ checked: number; escalated: number }> => {
  const pending = await prisma.emergencyReferral.findMany({
    where: { status: 'pending' },
    include: {
      referredToDoctor: { select: { departmentId: true } },
      emergency: { select: { prn: true, patientName: true, triageCategory: true } },
    },
  });

  const now = Date.now();
  let escalated = 0;

  for (const ref of pending) {
    const elapsedMin = (now - new Date(ref.referredAt).getTime()) / 60_000;
    // dueLevel = how many SLA intervals have passed (0 = still within first).
    const dueLevel = Math.floor(elapsedMin / Math.max(1, ref.slaMinutes));
    if (dueLevel <= ref.escalationLevel) continue; // not yet time for the next tier

    const nextLevel = ref.escalationLevel + 1;
    const step = await prisma.escalationChainStep.findFirst({
      where: { departmentId: ref.referredToDoctor.departmentId, level: nextLevel },
    });
    if (!step) continue; // chain exhausted (or none configured) — leave as-is

    const isCritical = ref.triageCategory === 'red';
    const message =
      `Unacknowledged referral for ${ref.emergency.patientName} (${ref.emergency.prn}, ${ref.emergency.triageCategory}) ` +
      `— escalation level ${nextLevel}, ${Math.floor(elapsedMin)} min elapsed`;

    if (step.targetType === 'doctor' && step.targetDoctorId) {
      const doc = await prisma.doctor.findUnique({ where: { id: step.targetDoctorId }, select: { userId: true } });
      await prisma.notification.create({
        data: {
          type: 'emergency_referral_escalation',
          title: 'Escalated emergency referral',
          message,
          status: 'unread',
          userId: doc?.userId ?? undefined,
          isCritical,
          entityId: ref.id,
          entityType: 'EmergencyReferral',
        },
      }).catch((e) => console.warn('[referral-escalation] notify doctor failed:', (e as Error).message));
    } else if (step.targetType === 'role' && step.targetRole) {
      await prisma.notification.create({
        data: {
          type: 'emergency_referral_escalation',
          title: 'Escalated emergency referral',
          message,
          status: 'unread',
          targetRole: step.targetRole,
          isCritical,
          entityId: ref.id,
          entityType: 'EmergencyReferral',
        },
      }).catch((e) => console.warn('[referral-escalation] notify role failed:', (e as Error).message));
    }

    await prisma.emergencyReferral.update({
      where: { id: ref.id },
      data: { escalationLevel: nextLevel, lastEscalatedAt: new Date() },
    });
    escalated += 1;
  }

  return { checked: pending.length, escalated };
};

export const registerReferralEscalationCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  // Re-entry guard — a previous run still in flight (slow DB, long chain)
  // would otherwise stack and exhaust the Prisma connection pool (P2024).
  let isRunning = false;
  // Every 3 minutes.
  cron.schedule('*/3 * * * *', async () => {
    if (isRunning) { console.log('[referral-escalation] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const result = await runEscalationSweep();
      if (result.escalated > 0) {
        console.log(`[referral-escalation] escalated ${result.escalated}/${result.checked} pending referral(s)`);
      }
    } catch (error) {
      console.error('Error in referral-escalation cron job:', error);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Referral-escalation cron job initialized (runs every 3 min)');
};
