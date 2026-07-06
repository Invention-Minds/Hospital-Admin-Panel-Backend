import prisma from './prisma-client';
import type { Prisma } from '@prisma/client';

// Phase D — Discharge clearance chain helpers.
//
// Spawns the parallel DischargeClearance rows the moment the discharge summary
// is signed, then evaluates whether the admission is gated-through to actual
// physical discharge. Front Desk's "Discharge patient" button calls
// finalizeDischargeIfReady; until every gate passes, the button stays
// disabled and the helper returns the list of blockers.

export const DISCHARGE_DEPARTMENTS = ['OT', 'BILLING', 'NURSING', 'PHARMACY', 'LAB_RAD', 'DIET', 'MLC'] as const;
export type DischargeDepartment = typeof DISCHARGE_DEPARTMENTS[number];

const VITALS_FRESHNESS_MS = 2 * 60 * 60 * 1000;

/** Returns the set of departments that should be spawned for a given admission.
 * OT only when the admission has any OtSchedule; MLC only when it's an MLC case.
 * Diet / Billing / Nursing / Pharmacy / Lab_Rad always apply. */
async function applicableDepartments(admissionId: string): Promise<DischargeDepartment[]> {
  const depts: DischargeDepartment[] = ['BILLING', 'NURSING', 'PHARMACY', 'LAB_RAD', 'DIET'];

  const otHit = await prisma.otSchedule.findFirst({
    where: { admissionId },
    select: { id: true },
  }).catch(() => null);
  if (otHit) depts.push('OT');

  const admission = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    select: { referralMlcId: true },
  });
  if (admission?.referralMlcId) depts.push('MLC');

  return depts;
}

/** Idempotently spawn DischargeClearance rows for an admission. Called at
 * discharge-summary-sign time. The unique (admissionId, department) constraint
 * means re-runs are no-ops. Accepts an optional Prisma transaction so the
 * caller can roll back the whole sign atomically if anything fails. */
export async function spawnDischargeClearances(
  admissionId: string,
  createdBy: string | null,
  tx?: Prisma.TransactionClient,
): Promise<{ spawned: number; alreadyPresent: number }> {
  const client = tx ?? prisma;
  const depts = await applicableDepartments(admissionId);

  let spawned = 0;
  let alreadyPresent = 0;
  for (const dept of depts) {
    try {
      await client.dischargeClearance.create({
        data: { admissionId, department: dept, status: 'pending', createdBy },
      });
      spawned += 1;
    } catch (err) {
      // Unique violation on (admissionId, department) — already present.
      // Prisma surfaces this as P2002; treat anything thrown as a soft skip
      // so a partial re-spawn doesn't take down the sign transaction.
      if ((err as { code?: string }).code === 'P2002') {
        alreadyPresent += 1;
      } else {
        throw err;
      }
    }
  }
  return { spawned, alreadyPresent };
}

export interface GateResult {
  eligible: boolean;
  blockers: string[];
  clearances: Array<{ department: string; status: string; blockingReason: string | null }>;
}

/** Read-only gate evaluation. Used by the FE to show the Front Desk button
 * enabled/disabled with a tooltip listing blockers. Never mutates. */
export async function evaluateDischargeGate(admissionId: string): Promise<GateResult> {
  const blockers: string[] = [];

  const admission = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    select: {
      id: true, status: true, dischargeChainAbandoned: true,
      discharge: {
        select: {
          summaryStatus: true, attenderAcknowledgedAt: true,
        },
      },
    },
  });
  if (!admission) return { eligible: false, blockers: ['Admission not found'], clearances: [] };

  if (admission.status === 'discharged') return { eligible: false, blockers: ['Already discharged'], clearances: [] };
  if (admission.dischargeChainAbandoned) return { eligible: false, blockers: ['Discharge chain was abandoned (LAMA/DAMA path)'], clearances: [] };

  const summaryStatus = admission.discharge?.summaryStatus ?? 'NONE';
  if (summaryStatus !== 'SIGNED' && summaryStatus !== 'DELIVERED') {
    blockers.push(`Discharge summary not signed (status=${summaryStatus})`);
  }
  if (!admission.discharge?.attenderAcknowledgedAt) {
    blockers.push('Attender acknowledgement missing');
  }

  // Vitals snapshot within last 2h.
  const vitalsCutoff = new Date(Date.now() - VITALS_FRESHNESS_MS);
  const recentVitals = await prisma.ipdVitalsReading.findFirst({
    where: { admissionId, recordedAt: { gte: vitalsCutoff } },
    select: { id: true },
  });
  if (!recentVitals) {
    blockers.push('No vitals reading within the last 2 hours');
  }

  // All clearance rows must be 'cleared'. Any 'pending' or 'rejected' blocks.
  const clearances = await prisma.dischargeClearance.findMany({
    where: { admissionId },
    select: { department: true, status: true, blockingReason: true },
    orderBy: { department: 'asc' },
  });
  for (const c of clearances) {
    if (c.status !== 'cleared') {
      blockers.push(`${c.department}: ${c.status}${c.blockingReason ? ' — ' + c.blockingReason : ''}`);
    }
  }
  if (clearances.length === 0) {
    blockers.push('No clearance rows spawned yet (summary not signed?)');
  }

  return { eligible: blockers.length === 0, blockers, clearances };
}

/** Front Desk's "Discharge patient" button calls this. Re-checks every gate
 * inside a transaction, then flips admission.status and frees the bed. Returns
 * the same shape as evaluateDischargeGate so the caller can show the blockers
 * if the gate fails. */
export async function finalizeDischargeIfReady(opts: {
  admissionId: string;
  actorUsername: string | null;
}): Promise<GateResult & { finalized: boolean }> {
  const gate = await evaluateDischargeGate(opts.admissionId);
  if (!gate.eligible) return { ...gate, finalized: false };

  await prisma.$transaction(async (tx) => {
    const admission = await tx.ipdAdmission.findUnique({
      where: { id: opts.admissionId },
      select: { bedId: true, status: true },
    });
    if (!admission) throw new Error('Admission disappeared mid-finalize');
    if (admission.status === 'discharged') return; // raced with another caller

    await tx.ipdAdmission.update({
      where: { id: opts.admissionId },
      data: { status: 'discharged', updatedBy: opts.actorUsername ?? undefined },
    });
    if (admission.bedId) {
      await tx.ipdBed.update({
        where: { id: admission.bedId },
        data: { status: 'available' },
      });
    }
    await tx.ipdDischarge.updateMany({
      where: { admissionId: opts.admissionId, summaryStatus: { not: 'DELIVERED' } },
      data: { summaryStatus: 'DELIVERED' },
    });
  });
  return { ...gate, finalized: true };
}

/** LAMA / DAMA bypass — cancels any pending clearance rows and marks the
 * admission's chain as abandoned. Callers (lama / dama controllers) invoke
 * this so finalizeDischargeIfReady never tries to gate the existing LAMA flow. */
export async function abandonDischargeChain(opts: {
  admissionId: string;
  reason: string;
  actorUsername: string | null;
  actorId: number | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ipdAdmission.update({
      where: { id: opts.admissionId },
      data: {
        dischargeChainAbandoned: true,
        dischargeChainAbandonedReason: opts.reason,
        dischargeChainAbandonedAt: new Date(),
        dischargeChainAbandonedBy: opts.actorUsername ?? undefined,
        updatedBy: opts.actorUsername ?? undefined,
      },
    });
    // Mark any still-pending clearances as rejected with a reason — keeps the
    // audit trail honest instead of silently leaving them open forever.
    await tx.dischargeClearance.updateMany({
      where: { admissionId: opts.admissionId, status: 'pending' },
      data: {
        status: 'rejected',
        blockingReason: `Chain abandoned: ${opts.reason}`,
        rejectedAt: new Date(),
        rejectedBy: opts.actorUsername ?? undefined,
        rejectedById: opts.actorId ?? undefined,
      },
    });
  });
}
