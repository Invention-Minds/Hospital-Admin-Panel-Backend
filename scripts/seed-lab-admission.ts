/**
 * One-off seed: gives PRN 9900001 (SEED — Ravi Kumar) an active IPD admission
 * dated before the seeded critical Potassium result, so the CRITICAL_LAB_NOT_
 * ACKNOWLEDGED auto-rule's encounter lookup tags the resulting incident as
 * `encounterType: 'IPD'` and the detail page shows the IPD chip.
 *
 * This is a surgical companion to seed-sprint-3.ts. That script refuses to
 * run once any non-seed data exists in the DB; this one only touches a single
 * IpdAdmission row keyed by admissionNo='SEED-IPD-002', so it's safe to run
 * against a DB that already has demo data.
 *
 * Run:  npx ts-node scripts/seed-lab-admission.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_LAB_ADMISSION_NO = 'SEED-IPD-002';
const SEED_WARD_CODE = 'SEED-W-GEN';
const SEED_BED_NUMBER = 'SEED-G-02';
const SEED_PRN = '9900001';
const SEED_DOCTOR = 'SEED — Dr. Jacob Ryan';
const SEED_DEPARTMENT = 'General Medicine';
// Pinned past date — must be <= InvestigationResult.reportedAt so the cron's
// `admissionDate: { lte: reportedAt }` filter matches.
const SEED_ADMIT_DATE = new Date('2026-04-10T11:30:00.000Z');

async function main(): Promise<void> {
  console.log('[seed-lab-admission] starting…');

  const ward = await prisma.ipdWard.findFirst({ where: { wardCode: SEED_WARD_CODE }, select: { id: true } });
  if (!ward) {
    console.error(`❌ Ward "${SEED_WARD_CODE}" not found. Run seed-sprint-3.ts first to create the seed ward/beds, ` +
      `or change SEED_WARD_CODE in this script to a ward that exists in your DB.`);
    process.exit(2);
  }
  const bed = await prisma.ipdBed.findFirst({
    where: { bedNumber: SEED_BED_NUMBER },
    select: { id: true, status: true },
  });
  if (!bed) {
    console.error(`❌ Bed "${SEED_BED_NUMBER}" not found. Run seed-sprint-3.ts first to create the seed beds.`);
    process.exit(2);
  }

  // IpdAdmission.prn / InvestigationResult.prn / Incident.patientPrn are free
  // string columns, no FK to Patient — the cron's encounter lookup queries
  // IpdAdmission.prn directly, so a Patient row is *not* required. We just
  // warn if it's missing so the operator knows the demo will have no name.
  const patient = await prisma.patient.findFirst({ where: { prn: Number(SEED_PRN) }, select: { id: true, name: true } });
  if (patient) {
    console.log(`  patient: ${patient.name} (PRN ${SEED_PRN})`);
  } else {
    console.log(`  ⚠ no Patient row for PRN ${SEED_PRN} — proceeding anyway (admission/incident don't FK to Patient).`);
  }
  console.log(`  ward:    ${SEED_WARD_CODE}`);
  console.log(`  bed:     ${SEED_BED_NUMBER} (${bed.status})`);

  const admission = await prisma.ipdAdmission.upsert({
    where: { admissionNo: SEED_LAB_ADMISSION_NO },
    update: {
      admissionDate: SEED_ADMIT_DATE,
      status: 'admitted',
      wardId: ward.id,
      bedId: bed.id,
    },
    create: {
      admissionNo: SEED_LAB_ADMISSION_NO,
      prn: SEED_PRN,
      admissionDate: SEED_ADMIT_DATE,
      admissionTime: '11:30',
      admissionType: 'emergency',
      sourceModule: 'direct',
      admittingDoctor: SEED_DOCTOR,
      department: SEED_DEPARTMENT,
      wardId: ward.id,
      bedId: bed.id,
      roomType: 'general',
      diagnosis: 'Acute hyperkalemia — admitted for monitoring + IV insulin/dextrose.',
      status: 'admitted',
      createdBy: 'seed-lab-admission',
    },
    select: { id: true, admissionNo: true, status: true, admissionDate: true },
  });

  await prisma.ipdBed.update({ where: { id: bed.id }, data: { status: 'occupied' } });

  console.log(`✓ Admission ${admission.admissionNo} ready — id=${admission.id}, status=${admission.status}, ` +
    `admissionDate=${admission.admissionDate.toISOString()}`);
  console.log('  Next steps:');
  console.log('   1. Cancel/close the old CRITICAL_LAB_NOT_ACKNOWLEDGED incident for PRN 9900001 (it has no admissionId).');
  console.log('   2. Wait up to 15 min for the incident-rules cron to fire (or restart the backend and wait for the next tick).');
  console.log('   3. The new incident will be raised with admissionId populated → IPD chip will render on the detail page.');
}

main()
  .catch((err) => { console.error('[seed-lab-admission] failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
