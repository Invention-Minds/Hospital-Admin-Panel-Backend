import prisma from '../../service/prisma-client';
import { syncOrdersForAdmission } from './meal-order.cron';

/**
 * Read a DietMaster list field (restrictions / targetConditions). Stored as a
 * JSON array; older saves were JSON-encoded more than once, so peel layers
 * until we reach an array or plain text.
 */
export function decodeDietList(raw: string | null | undefined): string[] {
  let v: unknown = raw;
  for (let i = 0; i < 5 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string'
    ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    : [];
}

export type DietAlertType = 'ADMISSION' | 'DISCHARGE' | 'TRANSFER' | 'BED_REOCCUPIED';

/** Bed + ward label for an admission, for alert text. */
async function bedLabel(admissionId: string): Promise<{
  admissionNo: string | null; wardName: string | null; bedNumber: string | null; bedId: string | null; prn: string | null;
}> {
  const adm = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    select: {
      admissionNo: true, prn: true, bedId: true,
      ward: { select: { wardName: true } },
      bed: { select: { bedNumber: true } },
    },
  });
  return {
    admissionNo: adm?.admissionNo ?? null,
    prn: adm?.prn ?? null,
    bedId: adm?.bedId ?? null,
    wardName: adm?.ward?.wardName ?? null,
    bedNumber: adm?.bed?.bedNumber ?? null,
  };
}

/**
 * Raise a Dietary alert (admission / discharge / transfer). On admission or
 * transfer INTO a bed that another patient left in the last 48h, a second
 * BED_REOCCUPIED alert warns Dietary not to serve the previous patient's diet.
 *
 * Call AFTER the admission change has committed. Never throws.
 */
export async function raiseDietAlert(
  type: Exclude<DietAlertType, 'BED_REOCCUPIED'>,
  admissionId: string,
  opts: { previousBed?: string | null } = {},
): Promise<void> {
  try {
    // The same event can reach us from two paths (e.g. admit + bed handshake);
    // don't show Dietary the same unacknowledged alert twice.
    const dup = await prisma.dietaryAlert.findFirst({
      where: { admissionId, type, acknowledgedAt: null, createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
      select: { id: true },
    });
    if (dup) return;

    const b = await bedLabel(admissionId);
    const where = [b.wardName, b.bedNumber].filter(Boolean).join(' / ') || 'no bed';
    const who = b.admissionNo ?? admissionId;
    const text: Record<typeof type, string> = {
      ADMISSION: `New admission ${who} in ${where} — no diet yet until assessed / census received.`,
      DISCHARGE: `${who} discharged from ${where} — trays not yet prepared were cancelled.`,
      TRANSFER: `${who} moved ${opts.previousBed ? `from ${opts.previousBed} ` : ''}to ${where}.`,
    };
    await prisma.dietaryAlert.create({
      data: {
        type, admissionId,
        wardName: b.wardName, bedNumber: b.bedNumber,
        previousBed: opts.previousBed ?? null,
        message: text[type],
      },
    });

    // Same bed, different patient, recently — the wrong-diet risk the
    // hospital described (discharge → new admission in the same bed).
    if ((type === 'ADMISSION' || type === 'TRANSFER') && b.bedId) {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const previous = await prisma.ipdAdmission.findFirst({
        where: {
          bedId: b.bedId,
          id: { not: admissionId },
          status: { not: 'admitted' },
          updatedAt: { gte: since },
        },
        orderBy: { updatedAt: 'desc' },
        select: { admissionNo: true },
      });
      if (previous) {
        await prisma.dietaryAlert.create({
          data: {
            type: 'BED_REOCCUPIED', admissionId,
            wardName: b.wardName, bedNumber: b.bedNumber,
            message: `Bed ${b.bedNumber ?? ''} now has a DIFFERENT patient (${who}); previous occupant ${previous.admissionNo} left recently. Do NOT serve the previous patient's diet.`,
          },
        });
      }
    }
  } catch (err) {
    console.error(`[dietetics] raiseDietAlert(${type}) failed for admission ${admissionId}:`, err);
  }
}

/**
 * Close out dietetics for an admission that has just left 'admitted'
 * (clearance-chain discharge, direct discharge, HMIS discharge webhook).
 *
 *   1. ACTIVE / INTERIM diet plan → ENDED (endDate = now); meal holds lifted.
 *   2. Meal orders for today's remaining slots + tomorrow are synced, so any
 *      tray still ORDERED is SKIPPED with "Patient no longer admitted".
 *      Prepared / served trays are left alone.
 *   3. DISCHARGE alert to Dietary.
 *
 * Call AFTER the admission status change has committed. Never throws.
 */
export async function closeDietOnDischarge(admissionId: string): Promise<void> {
  try {
    await prisma.dietPlan.updateMany({
      where: { admissionId, status: { in: ['ACTIVE', 'INTERIM'] } },
      data: { status: 'ENDED', endDate: new Date() },
    });
    await prisma.mealHold.updateMany({
      where: { admissionId, liftedAt: null },
      data: { liftedAt: new Date(), liftedBy: 'discharge' },
    });
    await syncOrdersForAdmission(admissionId);
  } catch (err) {
    console.error(`[dietetics] closeDietOnDischarge failed for admission ${admissionId}:`, err);
  }
  await raiseDietAlert('DISCHARGE', admissionId);
}

/**
 * Patient moved bed / ward. Pending trays keep their admission link (so the
 * kitchen list already shows the new bed); this re-stamps their ward/bed and
 * alerts Dietary. Never throws.
 */
export async function onAdmissionTransferred(admissionId: string, previousBedId?: string | null): Promise<void> {
  let previousBed: string | null = null;
  try {
    if (previousBedId) {
      const bed = await prisma.ipdBed.findUnique({
        where: { id: previousBedId },
        select: { bedNumber: true, ward: { select: { wardName: true } } },
      });
      previousBed = bed ? [bed.ward?.wardName, bed.bedNumber].filter(Boolean).join(' / ') : null;
    }
    await syncOrdersForAdmission(admissionId);
  } catch (err) {
    console.error(`[dietetics] transfer sync failed for admission ${admissionId}:`, err);
  }
  await raiseDietAlert('TRANSFER', admissionId, { previousBed });
}
