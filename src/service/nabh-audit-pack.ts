import fs from 'fs/promises';
import path from 'path';
import prisma from './prisma-client';

/**
 * Phase 10 — NABH audit pack builder.
 *
 * Given a date range + scope, collects all records that comprise the audit
 * trail for that scope and writes a JSON bundle to disk. The bundle is
 * deliberately a JSON file (not zip) so auditors can search it with grep —
 * a zip can be created downstream if desired.
 *
 * Scope discriminates which workflows are included:
 *   full     — everything below
 *   wf-1     — payment gate (appointments paid + revenue rollups)
 *   wf-2     — admission handshake (bed requests + admissions in handshake states)
 *   wf-3     — daily care (medication logs + daily closures)
 *   wf-4     — ICU transfers
 *   wf-5     — discharges (with AI-draft + sign-off chain)
 *   incident — staff handovers (used as the contingency surface in this build)
 *   hmis     — HMIS audit log + dead-letters + conflicts
 */

export type AuditPackScope =
  | 'full'
  | 'wf-1'
  | 'wf-2'
  | 'wf-3'
  | 'wf-4'
  | 'wf-5'
  | 'incident'
  | 'hmis'
  | 'ot'       // Phase 11 — OT workflow evidence
  | 'dietetics'; // Diet plans + meal orders + intake + interactions

export interface AuditPackInput {
  scope: AuditPackScope;
  fromDate: Date; // inclusive
  toDate: Date;   // inclusive
}

export interface AuditPackResult {
  filePath: string;
  rowCount: number;
  bundleBytes: number;
}

const STORAGE_DIR =
  process.env.NABH_AUDIT_PACK_DIR ||
  process.env.PDF_STORAGE_DIR ||
  '/var/www/docminds/pdfs';

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    /* ignore — directory may already exist */
  }
}

/**
 * Build the bundle in-memory then flush as a single JSON file. For very large
 * exports we'd stream — leaving that for later. Here we cap each section at
 * 10k rows per query to avoid runaway memory.
 */
export async function buildAuditPack(input: AuditPackInput): Promise<AuditPackResult> {
  const { scope, fromDate, toDate } = input;
  const TAKE = 10_000;

  const range = { gte: fromDate, lte: toDate };
  const includeAll = scope === 'full';

  const bundle: Record<string, unknown> = {
    meta: {
      scope,
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      generatedAt: new Date().toISOString(),
    },
  };
  let total = 0;

  // ─── WF-1 — payment gate / revenue ──────────────────────────────────
  if (includeAll || scope === 'wf-1') {
    const [paidAppointments, revenueRollups] = await Promise.all([
      prisma.appointment.findMany({
        where: { paidAt: range, paymentStatus: { in: ['paid', 'PAID'] } },
        take: TAKE,
      }),
      prisma.revenueRollup.findMany({
        where: { date: { gte: fromDate.toISOString().slice(0, 10), lte: toDate.toISOString().slice(0, 10) } },
        take: TAKE,
      }),
    ]);
    bundle['wf1_paidAppointments'] = paidAppointments;
    bundle['wf1_revenueRollups'] = revenueRollups;
    total += paidAppointments.length + revenueRollups.length;
  }

  // ─── WF-2 — admission handshake ─────────────────────────────────────
  if (includeAll || scope === 'wf-2') {
    const [bedRequests, handshakeAdmissions] = await Promise.all([
      prisma.ipdBedRequest.findMany({
        where: { requestedAt: range },
        take: TAKE,
      }),
      prisma.ipdAdmission.findMany({
        where: {
          createdAt: range,
          status: { in: ['PROPOSED', 'BED_REQUESTED', 'BED_ACCEPTED', 'admitted'] },
        },
        take: TAKE,
      }),
    ]);
    bundle['wf2_bedRequests'] = bedRequests;
    bundle['wf2_admissions'] = handshakeAdmissions;
    total += bedRequests.length + handshakeAdmissions.length;
  }

  // ─── WF-3 — daily care + MAR ack ────────────────────────────────────
  if (includeAll || scope === 'wf-3') {
    const [medicationLogs, dailyClosures] = await Promise.all([
      prisma.ipdMedicationLog.findMany({
        where: { administeredAt: range },
        take: TAKE,
      }),
      prisma.ipdDailyClosure.findMany({
        where: { closureDate: range },
        take: TAKE,
      }),
    ]);
    bundle['wf3_medicationLogs'] = medicationLogs;
    bundle['wf3_dailyClosures'] = dailyClosures;
    total += medicationLogs.length + dailyClosures.length;
  }

  // ─── WF-4 — ICU transfers ───────────────────────────────────────────
  if (includeAll || scope === 'wf-4') {
    const transfers = await prisma.ipdIcuTransferRequest.findMany({
      where: { proposedAt: range },
      take: TAKE,
    });
    bundle['wf4_icuTransfers'] = transfers;
    total += transfers.length;
  }

  // ─── WF-5 — discharges ──────────────────────────────────────────────
  if (includeAll || scope === 'wf-5') {
    const discharges = await prisma.ipdDischarge.findMany({
      where: { dischargeDate: range },
      take: TAKE,
    });
    bundle['wf5_discharges'] = discharges;
    total += discharges.length;
  }

  // ─── Incident / staff handover ──────────────────────────────────────
  if (includeAll || scope === 'incident') {
    const handovers = await prisma.staffHandover.findMany({
      where: { raisedAt: range },
      take: TAKE,
    });
    bundle['incident_staffHandovers'] = handovers;
    total += handovers.length;
  }

  // ─── HMIS sync ──────────────────────────────────────────────────────
  if (includeAll || scope === 'hmis') {
    const [auditLog, deadLetters, conflicts] = await Promise.all([
      prisma.hmisAuditLog.findMany({
        where: { createdAt: range },
        take: TAKE,
      }),
      prisma.hmisDeadLetter.findMany({
        where: { movedAt: range },
        take: TAKE,
      }),
      prisma.hmisConflict.findMany({
        where: { detectedAt: range },
        take: TAKE,
      }),
    ]);
    bundle['hmis_auditLog'] = auditLog;
    bundle['hmis_deadLetters'] = deadLetters;
    bundle['hmis_conflicts'] = conflicts;
    total += auditLog.length + deadLetters.length + conflicts.length;
  }

  // ─── Phase 11 — OT workflow ─────────────────────────────────────────
  if (includeAll || scope === 'ot') {
    const [
      otRooms,
      otSchedules,
      preOpChecklists,
      safetyChecklists,
      intraOpNotes,
      anaesthesiaCharts,
      pacuRecords,
      pacuVitals,
      otOutcomes,
    ] = await Promise.all([
      prisma.otRoom.findMany({ take: TAKE }),
      prisma.otSchedule.findMany({
        where: { date: range },
        take: TAKE,
      }),
      prisma.otPreOpChecklist.findMany({
        where: { schedule: { is: { date: range } } },
        take: TAKE,
      }),
      prisma.otSafetyChecklist.findMany({
        where: { schedule: { is: { date: range } } },
        take: TAKE,
      }),
      prisma.otIntraOpNote.findMany({
        where: { schedule: { is: { date: range } } },
        take: TAKE,
      }),
      prisma.otAnaesthesiaChart.findMany({
        where: { schedule: { is: { date: range } } },
        take: TAKE,
      }),
      prisma.pacuRecord.findMany({
        where: { schedule: { is: { date: range } } },
        take: TAKE,
      }),
      prisma.pacuVital.findMany({
        where: { pacu: { is: { schedule: { is: { date: range } } } } },
        take: TAKE,
      }),
      prisma.otOutcome.findMany({
        where: { schedule: { is: { date: range } } },
        take: TAKE,
      }),
    ]);
    bundle['ot_rooms'] = otRooms;
    bundle['ot_schedules'] = otSchedules;
    bundle['ot_preOpChecklists'] = preOpChecklists;
    bundle['ot_safetyChecklists'] = safetyChecklists;
    bundle['ot_intraOpNotes'] = intraOpNotes;
    bundle['ot_anaesthesiaCharts'] = anaesthesiaCharts;
    bundle['ot_pacuRecords'] = pacuRecords;
    bundle['ot_pacuVitals'] = pacuVitals;
    bundle['ot_outcomes'] = otOutcomes;
    total +=
      otRooms.length + otSchedules.length + preOpChecklists.length +
      safetyChecklists.length + intraOpNotes.length + anaesthesiaCharts.length +
      pacuRecords.length + pacuVitals.length + otOutcomes.length;
  }

  // ─── Dietetics — diet plans + meal orders + intake + deliveries ────
  if (includeAll || scope === 'dietetics') {
    const [dietPlans, mealOrders, mealDeliveries, mealIntakes, drugFoodInteractions] = await Promise.all([
      prisma.dietPlan.findMany({
        where: { createdAt: range },
        take: TAKE,
      }),
      prisma.mealOrder.findMany({
        where: { scheduledFor: range },
        take: TAKE,
      }),
      prisma.mealDelivery.findMany({
        where: { deliveredAt: range },
        take: TAKE,
      }),
      prisma.mealIntake.findMany({
        where: { recordedAt: range },
        take: TAKE,
      }),
      prisma.drugFoodInteraction.findMany({ take: TAKE }),
    ]);
    bundle['dietetics_dietPlans'] = dietPlans;
    bundle['dietetics_mealOrders'] = mealOrders;
    bundle['dietetics_mealDeliveries'] = mealDeliveries;
    bundle['dietetics_mealIntakes'] = mealIntakes;
    bundle['dietetics_drugFoodInteractions'] = drugFoodInteractions;
    total += dietPlans.length + mealOrders.length + mealDeliveries.length + mealIntakes.length + drugFoodInteractions.length;
  }

  // ─── Cross-cutting — signatures + AppAuditLog (always included) ─────
  // Auditors typically want the full signature trail + cross-module audit
  // log alongside any scope.
  const [signatures, appAuditLogs, consentSignatures] = await Promise.all([
    prisma.signatureBlob.findMany({
      where: { createdAt: range },
      take: TAKE,
    }),
    prisma.appAuditLog.findMany({
      where: { createdAt: range },
      take: TAKE,
    }),
    prisma.consentSignature.findMany({
      where: { signedAt: range },
      take: TAKE,
    }),
  ]);
  bundle['signatures'] = signatures;
  bundle['appAuditLogs'] = appAuditLogs;
  bundle['consentSignatures'] = consentSignatures;
  total += signatures.length + appAuditLogs.length + consentSignatures.length;

  // ─── Flush to disk ──────────────────────────────────────────────────
  await ensureDir(STORAGE_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `nabh-audit-${scope}-${ts}.json`;
  const filePath = path.join(STORAGE_DIR, fileName);
  const json = JSON.stringify(bundle, null, 2);
  await fs.writeFile(filePath, json, 'utf8');

  return {
    filePath,
    rowCount: total,
    bundleBytes: Buffer.byteLength(json, 'utf8'),
  };
}
