/// <reference path="../global.d.ts" />
/**
 * Demo seed for Phase D (discharge clearance chain) + Phase P (pharmacy +
 * nurse handshake). Idempotent — re-runnable as state evolves.
 *
 * Phase D — picks 4 existing demo IpdAdmissions in 'admitted' status and
 * arranges them in four distinct lifecycle states so the demo can show:
 *   A — flagged ready, MT acked, summary DRAFTED        (lands in MT queue)
 *   B — summary SIGNED, clearance rows spawned, mixed   (board shows traffic-light)
 *   C — summary SIGNED, all clearances cleared, vitals  (Front Desk can finalise)
 *   D — chain abandoned (LAMA bypass)                   (gate disabled forever)
 *
 * Phase P — picks existing active IpdPrescriptions on those admissions and
 * mutates them into the eight handshake states (pending ack, acked, partial
 * dispense, fully dispensed, awaiting collect, fully collected, pharmacy
 * rejected, nurse returned) plus a STAT bypass + a brand substitution.
 *
 * Run: npx ts-node scripts/seed-phase-d-p-demo.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEEDED_BY = 'seed-phase-d-p-demo';

interface AdmissionPick {
  id: string;
  admissionNo: string;
  wardId: string | null;
  bedId: string | null;
}

async function pickDemoAdmissions(limit: number): Promise<AdmissionPick[]> {
  // Prefer DEMO-prefixed admissions to keep the safety-check of seed-sprint-3
  // happy, but if there aren't enough we fall back to any 'admitted' row.
  const rows = await prisma.ipdAdmission.findMany({
    where: { status: 'admitted' },
    select: { id: true, admissionNo: true, wardId: true, bedId: true },
    orderBy: [{ admissionNo: 'asc' }],
    take: limit,
  });
  return rows;
}

async function clearanceUpsert(opts: {
  admissionId: string;
  department: string;
  status: 'pending' | 'cleared' | 'rejected';
  notes?: string;
  reason?: string;
  by?: string;
}): Promise<void> {
  const base = { admissionId: opts.admissionId, department: opts.department, createdBy: SEEDED_BY };
  const update = {
    status: opts.status,
    clearedAt: opts.status === 'cleared' ? new Date() : null,
    clearedBy: opts.status === 'cleared' ? (opts.by ?? 'SEED-coordinator') : null,
    clearedNotes: opts.status === 'cleared' ? (opts.notes ?? 'SEED — auto-cleared for demo') : null,
    rejectedAt: opts.status === 'rejected' ? new Date() : null,
    rejectedBy: opts.status === 'rejected' ? (opts.by ?? 'SEED-coordinator') : null,
    blockingReason: opts.status === 'rejected' ? (opts.reason ?? 'SEED — demo block') : null,
  };
  await prisma.dischargeClearance.upsert({
    where: { admissionId_department: { admissionId: opts.admissionId, department: opts.department } },
    create: { ...base, ...update },
    update,
  });
}

async function ensureSignedDischarge(admissionId: string, admissionNo: string): Promise<void> {
  const existing = await prisma.ipdDischarge.findUnique({ where: { admissionId } });
  if (existing && (existing.summaryStatus === 'SIGNED' || existing.summaryStatus === 'DELIVERED')) return;
  if (existing) {
    await prisma.ipdDischarge.update({
      where: { admissionId },
      data: {
        summaryStatus: 'SIGNED',
        clinicianSignatureId: existing.clinicianSignatureId ?? 'SEED-SIG',
        clinicianSignedAt: new Date(),
        clinicianSignedBy: 'SEED — Dr. Demo',
        mtAcknowledgedAt: existing.mtAcknowledgedAt ?? new Date(),
        mtAcknowledgedBy: existing.mtAcknowledgedBy ?? 'SEED-mt',
        updatedBy: SEEDED_BY,
      },
    });
  } else {
    await prisma.ipdDischarge.create({
      data: {
        admissionId,
        dischargeDate: new Date(),
        dischargeTime: '14:30',
        dischargeType: 'regular',
        finalDiagnosis: `SEED — ${admissionNo} demo discharge.`,
        conditionAtDischarge: 'Stable, afebrile.',
        dischargeSummary: 'SEED — Patient improved on standard therapy. Follow up in clinic in 2 weeks.',
        medications: '[]',
        summaryStatus: 'SIGNED',
        clinicianSignatureId: 'SEED-SIG',
        clinicianSignedAt: new Date(),
        clinicianSignedBy: 'SEED — Dr. Demo',
        mtAcknowledgedAt: new Date(),
        mtAcknowledgedBy: 'SEED-mt',
        createdBy: SEEDED_BY,
      },
    });
  }
}

async function ensureVitals(admissionId: string): Promise<void> {
  // Phase D's gate requires a vitals reading within the last 2h. Seed one if
  // none exists in that window.
  const cutoff = new Date(Date.now() - 90 * 60 * 1000); // 90 min ago
  const recent = await prisma.ipdVitalsReading.findFirst({
    where: { admissionId, recordedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (recent) return;
  await prisma.ipdVitalsReading.create({
    data: {
      admissionId,
      recordedAt: new Date(),
      shift: 'E',
      temperatureC: 36.9,
      pulse: 78,
      respiration: 16,
      bpSystolic: 124,
      bpDiastolic: 78,
      spo2: 98,
      notes: 'SEED — demo discharge-gate vitals',
    },
  });
}

async function ensureAttenderAck(admissionId: string): Promise<void> {
  await prisma.ipdDischarge.updateMany({
    where: { admissionId, attenderAcknowledgedAt: null },
    data: {
      attenderAcknowledgmentSignatureId: 'SEED-ATTENDER-SIG',
      attenderAcknowledgedAt: new Date(),
      attenderName: 'SEED — Demo Attender',
      attenderRelation: 'son',
    },
  });
}

// ─── Phase D ─────────────────────────────────────────────────────────────

async function seedAdmissionA(adm: AdmissionPick): Promise<void> {
  console.log(`A · ${adm.admissionNo} — ready + MT acked + summary DRAFTED`);
  await prisma.ipdAdmission.update({
    where: { id: adm.id },
    data: {
      dischargeReadyAt: new Date(Date.now() - 35 * 60 * 1000), // 35 min ago (nag-eligible)
      dischargeReadyBy: 'SEED — Dr. Demo',
      dischargeChainAbandoned: false,
      updatedBy: SEEDED_BY,
    },
  });
  await prisma.ipdDischarge.upsert({
    where: { admissionId: adm.id },
    create: {
      admissionId: adm.id,
      dischargeDate: new Date(),
      dischargeTime: '12:00',
      dischargeType: 'regular',
      finalDiagnosis: `SEED — ${adm.admissionNo} draft`,
      conditionAtDischarge: 'Stable.',
      dischargeSummary: 'SEED — MT draft in progress.',
      medications: '[]',
      summaryStatus: 'DRAFTED',
      mtAcknowledgedAt: new Date(Date.now() - 25 * 60 * 1000),
      mtAcknowledgedBy: 'SEED-mt',
      createdBy: SEEDED_BY,
    },
    update: {
      summaryStatus: 'DRAFTED',
      mtAcknowledgedAt: new Date(Date.now() - 25 * 60 * 1000),
      mtAcknowledgedBy: 'SEED-mt',
      updatedBy: SEEDED_BY,
    },
  });
}

async function seedAdmissionB(adm: AdmissionPick): Promise<void> {
  console.log(`B · ${adm.admissionNo} — signed, clearances mixed (board demo)`);
  await prisma.ipdAdmission.update({
    where: { id: adm.id },
    data: { dischargeReadyAt: new Date(Date.now() - 2 * 60 * 60 * 1000), dischargeReadyBy: 'SEED — Dr. Demo' },
  });
  await ensureSignedDischarge(adm.id, adm.admissionNo);

  // Mixed clearance state.
  await clearanceUpsert({ admissionId: adm.id, department: 'BILLING', status: 'cleared', notes: 'Final bill paid.' });
  await clearanceUpsert({ admissionId: adm.id, department: 'NURSING', status: 'cleared', notes: 'Belongings handed over.' });
  await clearanceUpsert({ admissionId: adm.id, department: 'PHARMACY', status: 'pending' });
  await clearanceUpsert({ admissionId: adm.id, department: 'LAB_RAD', status: 'rejected', reason: 'CBC report awaited' });
  await clearanceUpsert({ admissionId: adm.id, department: 'DIET', status: 'cleared', notes: 'Counselled on home diet.' });
}

async function seedAdmissionC(adm: AdmissionPick): Promise<void> {
  console.log(`C · ${adm.admissionNo} — signed, ALL cleared, ready to finalise`);
  await prisma.ipdAdmission.update({
    where: { id: adm.id },
    data: { dischargeReadyAt: new Date(Date.now() - 5 * 60 * 60 * 1000), dischargeReadyBy: 'SEED — Dr. Demo' },
  });
  await ensureSignedDischarge(adm.id, adm.admissionNo);
  await ensureAttenderAck(adm.id);
  await ensureVitals(adm.id);
  for (const dept of ['BILLING', 'NURSING', 'PHARMACY', 'LAB_RAD', 'DIET']) {
    await clearanceUpsert({ admissionId: adm.id, department: dept, status: 'cleared' });
  }
}

async function seedAdmissionD(adm: AdmissionPick): Promise<void> {
  console.log(`D · ${adm.admissionNo} — LAMA chain abandoned`);
  await prisma.ipdAdmission.update({
    where: { id: adm.id },
    data: {
      dischargeReadyAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      dischargeReadyBy: 'SEED — Dr. Demo',
      dischargeChainAbandoned: true,
      dischargeChainAbandonedReason: 'SEED — patient left against medical advice (LAMA).',
      dischargeChainAbandonedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      dischargeChainAbandonedBy: 'SEED — Dr. Demo',
      updatedBy: SEEDED_BY,
    },
  });
  await clearanceUpsert({ admissionId: adm.id, department: 'BILLING', status: 'rejected', reason: 'Chain abandoned: LAMA' });
  await clearanceUpsert({ admissionId: adm.id, department: 'NURSING', status: 'rejected', reason: 'Chain abandoned: LAMA' });
}

// ─── Phase P — Prescription handshake states ─────────────────────────────

async function pickPrescriptions(admissionIds: string[], limit: number): Promise<Array<{ id: string; admissionId: string; quantity: number; genericName: string }>> {
  return prisma.ipdPrescription.findMany({
    where: { admissionId: { in: admissionIds }, status: 'active' },
    select: { id: true, admissionId: true, quantity: true, genericName: true },
    orderBy: { prescribedDate: 'asc' },
    take: limit,
  });
}

async function seedPrescriptionStates(rxs: Array<{ id: string; admissionId: string; quantity: number; genericName: string }>): Promise<void> {
  const baseProbe = JSON.stringify({ ok: true, source: 'hmis', generic: 'demo', quantityOnHand: 50, fetchedAt: new Date().toISOString() });
  const lowProbe = JSON.stringify({ ok: true, source: 'hmis', generic: 'demo', quantityOnHand: 3, warning: 'Low stock — only 3 unit(s) on hand.', fetchedAt: new Date().toISOString() });

  const writes: Array<{ rxId: string; data: Record<string, unknown>; label: string }> = [];

  // State 1 — pending ack (just sent).
  if (rxs[0]) writes.push({
    rxId: rxs[0].id, label: 'pending ack',
    data: { sentToPharmacyAt: new Date(Date.now() - 5 * 60 * 1000), stockProbeJson: baseProbe, stockProbeAt: new Date() },
  });
  // State 2 — acked, awaiting dispense.
  if (rxs[1]) writes.push({
    rxId: rxs[1].id, label: 'acked, awaiting dispense',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 20 * 60 * 1000),
      pharmacyAckAt: new Date(Date.now() - 5 * 60 * 1000), pharmacyAckBy: 'SEED-pharmacy',
      stockProbeJson: baseProbe, stockProbeAt: new Date(),
    },
  });
  // State 3 — partially dispensed (2 of 5).
  if (rxs[2]) writes.push({
    rxId: rxs[2].id, label: 'partial dispense',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 40 * 60 * 1000),
      pharmacyAckAt: new Date(Date.now() - 30 * 60 * 1000), pharmacyAckBy: 'SEED-pharmacy',
      dispensedQty: Math.max(1, Math.floor(rxs[2].quantity / 2)),
      dispensedBy: 'SEED-pharmacy',
      stockProbeJson: lowProbe, stockProbeAt: new Date(),
    },
  });
  // State 4 — fully dispensed, awaiting nurse collect.
  if (rxs[3]) writes.push({
    rxId: rxs[3].id, label: 'dispensed, awaiting collect',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 50 * 60 * 1000),
      pharmacyAckAt: new Date(Date.now() - 40 * 60 * 1000), pharmacyAckBy: 'SEED-pharmacy',
      dispensedAt: new Date(Date.now() - 10 * 60 * 1000), dispensedBy: 'SEED-pharmacy',
      dispensedQty: rxs[3].quantity,
      stockProbeJson: baseProbe, stockProbeAt: new Date(),
    },
  });
  // State 5 — fully collected (MAR-ready).
  if (rxs[4]) writes.push({
    rxId: rxs[4].id, label: 'fully collected (MAR-ready)',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 80 * 60 * 1000),
      pharmacyAckAt: new Date(Date.now() - 70 * 60 * 1000), pharmacyAckBy: 'SEED-pharmacy',
      dispensedAt: new Date(Date.now() - 60 * 60 * 1000), dispensedBy: 'SEED-pharmacy',
      dispensedQty: rxs[4].quantity,
      nurseCollectedAt: new Date(Date.now() - 30 * 60 * 1000), nurseCollectedBy: 'SEED-nurse',
      nurseCollectedQty: rxs[4].quantity,
      stockProbeJson: baseProbe, stockProbeAt: new Date(),
    },
  });
  // State 6 — pharmacy rejected.
  if (rxs[5]) writes.push({
    rxId: rxs[5].id, label: 'pharmacy rejected',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 30 * 60 * 1000),
      pharmacyRejectedAt: new Date(Date.now() - 15 * 60 * 1000),
      pharmacyRejectedBy: 'SEED-pharmacy',
      pharmacyRejectedReason: 'SEED — out of stock; suggest alternative.',
      status: 'paused',
      stockProbeJson: lowProbe, stockProbeAt: new Date(),
    },
  });
  // State 7 — STAT bypass + brand substitution.
  if (rxs[6]) writes.push({
    rxId: rxs[6].id, label: 'STAT + brand substituted',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 10 * 60 * 1000),
      isStatBypass: true,
      prescriptionType: 'STAT',
      pharmacyAckAt: new Date(Date.now() - 8 * 60 * 1000), pharmacyAckBy: 'SEED-pharmacy',
      dispensedAt: new Date(Date.now() - 5 * 60 * 1000), dispensedBy: 'SEED-pharmacy',
      dispensedQty: rxs[6].quantity,
      substitutedBrand: 'SEED-Generic Brand X',
      substitutedReason: 'SEED — preferred brand unavailable.',
      stockProbeJson: baseProbe, stockProbeAt: new Date(),
    },
  });
  // State 8 — nurse returned.
  if (rxs[7]) writes.push({
    rxId: rxs[7].id, label: 'nurse returned',
    data: {
      sentToPharmacyAt: new Date(Date.now() - 120 * 60 * 1000),
      pharmacyAckAt: new Date(Date.now() - 100 * 60 * 1000), pharmacyAckBy: 'SEED-pharmacy',
      // dispense markers cleared by the return action — leave nulls + flag the return.
      nurseReturnedAt: new Date(Date.now() - 20 * 60 * 1000),
      nurseReturnedBy: 'SEED-nurse',
      nurseReturnReason: 'SEED — wrong patient label on the strip.',
      stockProbeJson: baseProbe, stockProbeAt: new Date(),
    },
  });

  for (const w of writes) {
    await prisma.ipdPrescription.update({ where: { id: w.rxId }, data: { ...w.data, updatedBy: SEEDED_BY } });
    console.log(`P · rx ${w.rxId.slice(0, 8)} — ${w.label}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[seed-phase-d-p-demo] starting…\n');

  const admissions = await pickDemoAdmissions(4);
  if (admissions.length < 4) {
    console.error(`❌ Need at least 4 'admitted' IpdAdmissions in the DB; found ${admissions.length}. Run seed-dashboard-demo.ts first.`);
    process.exit(2);
  }

  console.log('▶ Phase D — discharge clearance demo states');
  await seedAdmissionA(admissions[0]);
  await seedAdmissionB(admissions[1]);
  await seedAdmissionC(admissions[2]);
  await seedAdmissionD(admissions[3]);

  console.log('\n▶ Phase P — prescription handshake states');
  const admissionIds = admissions.map((a) => a.id);
  const rxs = await pickPrescriptions(admissionIds, 8);
  if (rxs.length < 8) {
    console.warn(`  ⚠ only ${rxs.length} active IpdPrescriptions across those admissions — some Phase P states will be skipped. Run seed-dashboard-demo.ts (which creates prescriptions) if you want all 8.`);
  }
  await seedPrescriptionStates(rxs);

  console.log('\n✅ Done. Walk-through:');
  console.log(`  • MT queue (/discharge/mt-queue) → ${admissions[0].admissionNo}`);
  console.log(`  • Clearance board (mixed)  → /ipd/admission/${admissions[1].id}/discharge-clearance`);
  console.log(`  • Clearance board (ready)  → /ipd/admission/${admissions[2].id}/discharge-clearance · Front-Desk "Discharge patient" should be live.`);
  console.log(`  • Abandoned (LAMA)         → /ipd/admission/${admissions[3].id}/discharge-clearance`);
  console.log(`  • Pharmacy queue           → /pharmacy/queue`);
  console.log(`  • Nurse inbox              → /nurse/medication-inbox`);
}

main()
  .catch((err) => { console.error('[seed-phase-d-p-demo] failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
