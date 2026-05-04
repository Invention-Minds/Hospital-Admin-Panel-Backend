import prisma from '../../service/prisma-client';
import { createHmisAuditLog } from '../hmis-sync/hmis-audit';

/**
 * Daily Bed Census Snapshot (Sprint 4a Phase 1e).
 *
 * NABH MOM.4 / FMS.1 require a persisted historical bed occupancy record.
 * The existing real-time bed-census endpoint queries IpdBed.status live —
 * it cannot answer "what was the occupancy on 2026-04-15?" because bed
 * status is mutated in place by every admission/discharge/transfer.
 *
 * This module writes one row per ward per day to BedCensusSnapshot:
 *   - Midnight cron (00:05 Asia/Kolkata) captures "as-of end-of-day" census.
 *   - Manual trigger for operations / recovery runs.
 *   - Per-ward column breakdown: totals, status buckets (occupied/available/
 *     maintenance/reserved), and physical bed-type buckets (general/ICU/HDU/
 *     isolation).
 *   - (snapshotDate, wardId) unique composite — idempotent within a day.
 *   - HmisAuditLog `module='bed-census'` row emitted per run, success or fail.
 *
 * Server TZ pinning: TZ=Asia/Kolkata MUST be set in the Node environment.
 * snapshotDate is normalized to 00:00 local so the unique key lands on the
 * operational calendar day rather than UTC day.
 */

export type SnapshotReason = 'cron' | 'manual' | 'recovery';

export type SnapshotResult =
  | {
      status: 'success';
      snapshotDate: Date;
      wardCount: number;
      rowIds: number[];
    }
  | {
      status: 'duplicate-blocked';
      snapshotDate: Date;
      conflictingWardIds: string[];
    }
  | {
      status: 'failed';
      reason: string;
    };

/** Normalize a Date to local-midnight (00:00:00.000). */
const normalizeToLocalMidnight = (d: Date): Date => {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/**
 * Aggregate current ward+bed state into a per-ward row batch.
 * Returns the rows ready for prisma.bedCensusSnapshot.createMany.
 */
const buildSnapshotRows = async (
  snapshotDate: Date,
  reason: SnapshotReason,
  createdById?: number
) => {
  const wards = await prisma.ipdWard.findMany({
    include: { beds: { select: { status: true, bedType: true } } },
  });

  return wards.map((w) => {
    const occupiedBeds = w.beds.filter((b) => b.status === 'occupied').length;
    const availableBeds = w.beds.filter((b) => b.status === 'available').length;
    const maintenanceBeds = w.beds.filter((b) => b.status === 'maintenance').length;
    const reservedBeds = w.beds.filter((b) => b.status === 'reserved').length;
    const generalBeds = w.beds.filter((b) => b.bedType === 'general').length;
    const icuBeds = w.beds.filter((b) => b.bedType === 'ICU' || b.bedType === 'icu').length;
    const hduBeds = w.beds.filter((b) => b.bedType === 'HDU' || b.bedType === 'hdu').length;
    const isolationBeds = w.beds.filter((b) => b.bedType === 'isolation').length;

    return {
      snapshotDate,
      wardId: w.id,
      wardName: w.wardName,
      wardCode: w.wardCode,
      department: w.department,
      totalBeds: w.totalBeds,
      occupiedBeds,
      availableBeds,
      maintenanceBeds,
      reservedBeds,
      generalBeds,
      icuBeds,
      hduBeds,
      isolationBeds,
      snapshotReason: reason,
      createdById: createdById ?? null,
    };
  });
};

/**
 * Generate a daily snapshot for the current local date.
 *
 * Behavior:
 *   - If any row already exists for (today, wardId), the whole run is
 *     rejected as `duplicate-blocked` and an audit row with action
 *     `snapshot_dup_blocked` is written. Prevents a manual invocation from
 *     clobbering a clean cron result or vice versa.
 *   - On a clean day, writes N rows (one per ward) + one success audit row.
 *   - On infra failure, writes a failed audit row and returns `failed`.
 */
export const generateDailySnapshot = async (
  reason: SnapshotReason,
  createdById?: number
): Promise<SnapshotResult> => {
  const snapshotDate = normalizeToLocalMidnight(new Date());

  try {
    const existing = await prisma.bedCensusSnapshot.findMany({
      where: { snapshotDate },
      select: { wardId: true },
    });

    if (existing.length > 0) {
      await createHmisAuditLog({
        direction: 'push',
        module: 'bed-census',
        action: 'snapshot_dup_blocked',
        status: 'failed',
        payload: JSON.stringify({
          snapshotDate: snapshotDate.toISOString(),
          reason,
          conflictingWardCount: existing.length,
          conflictingWardIds: existing.map((e) => e.wardId),
        }),
      });
      return {
        status: 'duplicate-blocked',
        snapshotDate,
        conflictingWardIds: existing.map((e) => e.wardId),
      };
    }

    const rows = await buildSnapshotRows(snapshotDate, reason, createdById);

    if (rows.length === 0) {
      await createHmisAuditLog({
        direction: 'push',
        module: 'bed-census',
        action: 'snapshot_generated',
        status: 'success',
        payload: JSON.stringify({
          snapshotDate: snapshotDate.toISOString(),
          reason,
          wardCount: 0,
          note: 'no-wards-defined',
        }),
      });
      return { status: 'success', snapshotDate, wardCount: 0, rowIds: [] };
    }

    // createMany doesn't return ids on MySQL; fetch them back by (snapshotDate, wardId).
    await prisma.bedCensusSnapshot.createMany({ data: rows });
    const created = await prisma.bedCensusSnapshot.findMany({
      where: { snapshotDate },
      select: { id: true },
    });

    await createHmisAuditLog({
      direction: 'push',
      module: 'bed-census',
      action: 'snapshot_generated',
      status: 'success',
      payload: JSON.stringify({
        snapshotDate: snapshotDate.toISOString(),
        reason,
        wardCount: rows.length,
        createdById: createdById ?? null,
      }),
    });

    return {
      status: 'success',
      snapshotDate,
      wardCount: rows.length,
      rowIds: created.map((r) => r.id),
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown-error';
    await createHmisAuditLog({
      direction: 'push',
      module: 'bed-census',
      action: 'snapshot_failed',
      status: 'failed',
      payload: JSON.stringify({
        snapshotDate: snapshotDate.toISOString(),
        reason,
        error: errMsg,
      }),
    });
    return { status: 'failed', reason: errMsg };
  }
};

/**
 * Cron registrar — schedules the midnight run. Called once at server
 * startup from src/index.ts. Uses node-cron with server-local TZ (must be
 * Asia/Kolkata for IST operational alignment; verify in sync doc).
 *
 * Cron expression: '5 0 * * *' → 00:05 local time daily.
 * The 5-minute offset from midnight allows any in-flight admission/
 * discharge transactions to settle before the census snapshot fires.
 */
export const registerBedCensusCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  cron.schedule('5 0 * * *', async () => {
    console.log(`[${new Date().toISOString()}] 🛏️  Generating daily bed-census snapshot...`);
    try {
      const result = await generateDailySnapshot('cron');
      console.log(
        `   → bed-census snapshot: ${result.status}${
          result.status === 'success' ? ` (${result.wardCount} wards)` : ''
        }`
      );
    } catch (error) {
      console.error('Error in bed-census snapshot cron job:', error);
    }
  });
  console.log('✅ Bed-census snapshot cron job initialized (runs daily at 00:05 local)');
};
