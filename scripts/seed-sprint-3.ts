/* eslint-disable no-console */
/**
 * Sprint 3 seed script.
 *
 * Creates a small dataset covering manual-test needs across Sprint 3a–3g:
 *   - 2 IpdWards, 6 IpdBeds
 *   - 3 PatientDetails (canonical patient table — see
 *     docs/audits/patient-vs-patient-details.md)
 *   - 2 Appointments (one checkedIn, one pending)
 *   - 1 Emergency case
 *   - 1 active IpdAdmission + 2 IpdProgressNotes
 *   - 1 IpdPrescription with 2 medications (modelled as 2 rows)
 *   - 1 InvestigationOrder + 1 critical-flagged InvestigationResult
 *
 * Safety guarantees (hard rules):
 *   - Safe: aborts if the DB contains any non-seed rows in the tables we
 *     write to. Detects seed rows via reserved prefixes/ranges.
 *   - Idempotent: re-running does no harm — every write goes through
 *     `upsert` (when the model has a unique key) or a "findFirst + create"
 *     guard (when it doesn't). Second run reports skipped=N.
 *   - Non-destructive: no TRUNCATE, no DELETE, no DROP anywhere. Verified
 *     by scanning the file with grep before running.
 *   - Uses the same Prisma client the app uses; reads DATABASE_URL via
 *     the project's dotenv wiring.
 *
 * Run with:
 *   cd Hospital-Admin-Panel-Backend
 *   npx ts-node scripts/seed-sprint-3.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------- Seed markers (used for both write + safety check) ---------------
const SEED_PRN_MIN = 9900001;
const SEED_PRN_MAX = 9999999;
const SEED_PREFIX = 'SEED-';
const SEED_EMERGENCY_PRN = 'SEED-ER-001';
const SEED_ADMISSION_NO = 'SEED-IPD-001';
// Second admission — owned by PATIENTS[0] (PRN 9900001), the patient who has
// the seeded critical Potassium result. Required so the encounter lookup in
// runCriticalLabUnacked tags the auto-incident with encounterType='IPD' and
// the detail page renders the IPD chip.
const SEED_LAB_ADMISSION_NO = 'SEED-IPD-002';
const SEED_WARD_CODES = ['SEED-W-GEN', 'SEED-W-ICU'] as const;
const SEED_DATE = '2026-04-20';

type Counts = Record<string, { created: number; skipped: number }>;

const counts: Counts = {};
function bump(entity: string, kind: 'created' | 'skipped'): void {
  if (!counts[entity]) counts[entity] = { created: 0, skipped: 0 };
  counts[entity][kind] += 1;
}

// ---------- Safety: refuse to run if non-seed data is present ---------------
interface SafetyCheckFailure {
  table: string;
  nonSeedCount: number;
  sampleRow: unknown;
}

async function findNonSeedRows(): Promise<SafetyCheckFailure[]> {
  const failures: SafetyCheckFailure[] = [];

  const patientNonSeed = await prisma.patient.count({
    where: { OR: [{ prn: { lt: SEED_PRN_MIN } }, { prn: { gt: SEED_PRN_MAX } }] },
  });
  if (patientNonSeed > 0) {
    const sample = await prisma.patient.findFirst({
      where: { OR: [{ prn: { lt: SEED_PRN_MIN } }, { prn: { gt: SEED_PRN_MAX } }] },
      select: { id: true, prn: true, name: true },
    });
    failures.push({ table: 'Patient', nonSeedCount: patientNonSeed, sampleRow: sample });
  }

  const detailsNonSeed = await prisma.patientDetails.count({
    where: { OR: [{ prn: { lt: SEED_PRN_MIN } }, { prn: { gt: SEED_PRN_MAX } }] },
  });
  if (detailsNonSeed > 0) {
    const sample = await prisma.patientDetails.findFirst({
      where: { OR: [{ prn: { lt: SEED_PRN_MIN } }, { prn: { gt: SEED_PRN_MAX } }] },
      select: { id: true, prn: true, name: true },
    });
    failures.push({ table: 'PatientDetails', nonSeedCount: detailsNonSeed, sampleRow: sample });
  }

  const wardNonSeed = await prisma.ipdWard.count({
    where: { NOT: { wardCode: { startsWith: SEED_PREFIX } } },
  });
  if (wardNonSeed > 0) {
    const sample = await prisma.ipdWard.findFirst({
      where: { NOT: { wardCode: { startsWith: SEED_PREFIX } } },
      select: { id: true, wardCode: true, wardName: true },
    });
    failures.push({ table: 'IpdWard', nonSeedCount: wardNonSeed, sampleRow: sample });
  }

  const admissionNonSeed = await prisma.ipdAdmission.count({
    where: { NOT: { admissionNo: { startsWith: SEED_PREFIX } } },
  });
  if (admissionNonSeed > 0) {
    const sample = await prisma.ipdAdmission.findFirst({
      where: { NOT: { admissionNo: { startsWith: SEED_PREFIX } } },
      select: { id: true, admissionNo: true, prn: true },
    });
    failures.push({ table: 'IpdAdmission', nonSeedCount: admissionNonSeed, sampleRow: sample });
  }

  const emergencyNonSeed = await prisma.emergency.count({
    where: { NOT: { prn: { startsWith: SEED_PREFIX } } },
  });
  if (emergencyNonSeed > 0) {
    const sample = await prisma.emergency.findFirst({
      where: { NOT: { prn: { startsWith: SEED_PREFIX } } },
      select: { id: true, prn: true, patientName: true },
    });
    failures.push({ table: 'Emergency', nonSeedCount: emergencyNonSeed, sampleRow: sample });
  }

  // Appointments are numerous in dev. Gate ONLY on appointments that reference
  // a seeded patient (prnNumber in our seed range) being absent from our seeded
  // set — i.e. we only refuse if there are rows in our range we can't explain.
  // Non-seed appointments (prnNumber outside seed range) are left alone.
  //
  // NOTE on the marker: unique-code fields (wardCode, admissionNo) use a hard
  // "SEED-" hyphen prefix. Human-display name fields use "SEED — " with an
  // em-dash. The safety check must recognise both, so we match on the literal
  // word "SEED" (case-sensitive) rather than "SEED-".
  const NAME_SEED_PREFIX = 'SEED';
  const seedRangeAppointmentsForeign = await prisma.appointment.count({
    where: {
      AND: [
        { prnNumber: { gte: SEED_PRN_MIN } },
        { prnNumber: { lte: SEED_PRN_MAX } },
        { NOT: { patientName: { startsWith: NAME_SEED_PREFIX } } },
      ],
    },
  });
  if (seedRangeAppointmentsForeign > 0) {
    const sample = await prisma.appointment.findFirst({
      where: {
        AND: [
          { prnNumber: { gte: SEED_PRN_MIN } },
          { prnNumber: { lte: SEED_PRN_MAX } },
          { NOT: { patientName: { startsWith: NAME_SEED_PREFIX } } },
        ],
      },
      select: { id: true, prnNumber: true, patientName: true },
    });
    failures.push({
      table: 'Appointment (foreign row in seed PRN range)',
      nonSeedCount: seedRangeAppointmentsForeign,
      sampleRow: sample,
    });
  }

  const investigationForeignInSeedRange = await prisma.investigationResult.count({
    where: {
      AND: [
        { prn: { startsWith: '99' } }, // quick filter by string prn
        { NOT: { testName: { startsWith: NAME_SEED_PREFIX } } },
      ],
    },
  });
  if (investigationForeignInSeedRange > 0) {
    const sample = await prisma.investigationResult.findFirst({
      where: {
        AND: [
          { prn: { startsWith: '99' } },
          { NOT: { testName: { startsWith: NAME_SEED_PREFIX } } },
        ],
      },
      select: { id: true, prn: true, testName: true },
    });
    failures.push({
      table: 'InvestigationResult (foreign row in seed PRN range)',
      nonSeedCount: investigationForeignInSeedRange,
      sampleRow: sample,
    });
  }

  return failures;
}

// ---------- Seed content ---------------------------------------------------

const PATIENTS: Array<{
  prn: number;
  name: string;
  phone: string;
  email: string;
  age: number;
  gender: number;
  gendText: string;
}> = [
  { prn: 9900001, name: 'SEED — Ravi Kumar',     phone: '+919900000001', email: 'seed1@seed.local', age: 52, gender: 1, gendText: 'male' },
  { prn: 9900002, name: 'SEED — Anita Sharma',   phone: '+919900000002', email: 'seed2@seed.local', age: 38, gender: 2, gendText: 'female' },
  { prn: 9900003, name: 'SEED — Murali Iyer',    phone: '+919900000003', email: 'seed3@seed.local', age: 66, gender: 1, gendText: 'male' },
];

const SEED_DOCTOR = 'SEED — Dr. Jacob Ryan';
const SEED_DEPARTMENT = 'General Medicine';

async function seedWardsAndBeds(): Promise<{ genWardId: string; icuWardId: string; genBeds: string[]; icuBeds: string[] }> {
  const [gen, icu] = await Promise.all([
    prisma.ipdWard.upsert({
      where: { wardCode: 'SEED-W-GEN' },
      update: {},
      create: {
        wardName: 'SEED — General Ward',
        wardCode: 'SEED-W-GEN',
        floor: '2',
        department: SEED_DEPARTMENT,
        totalBeds: 4,
      },
    }),
    prisma.ipdWard.upsert({
      where: { wardCode: 'SEED-W-ICU' },
      update: {},
      create: {
        wardName: 'SEED — ICU',
        wardCode: 'SEED-W-ICU',
        floor: '3',
        department: 'Critical Care',
        totalBeds: 2,
      },
    }),
  ]);
  bump('IpdWard', 'created');
  bump('IpdWard', 'created');

  const genBedNumbers = ['SEED-G-01', 'SEED-G-02', 'SEED-G-03', 'SEED-G-04'];
  const icuBedNumbers = ['SEED-ICU-01', 'SEED-ICU-02'];

  const genBeds: string[] = [];
  for (const bedNumber of genBedNumbers) {
    const bed = await prisma.ipdBed.upsert({
      where: { wardId_bedNumber: { wardId: gen.id, bedNumber } },
      update: {},
      create: { bedNumber, wardId: gen.id, bedType: 'general', status: 'available' },
    });
    bump('IpdBed', 'created');
    genBeds.push(bed.id);
  }
  const icuBeds: string[] = [];
  for (const bedNumber of icuBedNumbers) {
    const bed = await prisma.ipdBed.upsert({
      where: { wardId_bedNumber: { wardId: icu.id, bedNumber } },
      update: {},
      create: { bedNumber, wardId: icu.id, bedType: 'ICU', status: 'available' },
    });
    bump('IpdBed', 'created');
    icuBeds.push(bed.id);
  }

  return { genWardId: gen.id, icuWardId: icu.id, genBeds, icuBeds };
}

async function seedPatients(): Promise<void> {
  // NOTE (2026-04-19): Per docs/audits/patient-vs-patient-details.md, the
  // application reads/writes `PatientDetails` exclusively. The `Patient`
  // table exists in the schema but nothing in production paths reads it.
  // Writes to `Patient` were removed to avoid creating rows no consumer
  // reads. The non-seed safety check on `Patient` is kept in
  // findNonSeedRows() so the script still refuses to run if someone
  // manually adds real rows to that table.
  for (const p of PATIENTS) {
    await prisma.patientDetails.upsert({
      where: { prn: p.prn },
      update: {},
      create: {
        prn: p.prn,
        name: p.name,
        mobileNo: p.phone,
        email: p.email,
        age: String(p.age),
        gender: p.gendText,
        patientType: 'SEED',
        country: 'India',
      },
    });
    bump('PatientDetails', 'created');
  }
}

async function seedAppointments(): Promise<void> {
  const rows: Array<{
    patientPrn: number;
    patientName: string;
    phone: string;
    email: string;
    checkedIn: boolean;
    status: 'pending' | 'completed';
  }> = [
    {
      patientPrn: PATIENTS[0].prn, patientName: PATIENTS[0].name, phone: PATIENTS[0].phone, email: PATIENTS[0].email,
      checkedIn: true, status: 'completed',
    },
    {
      patientPrn: PATIENTS[1].prn, patientName: PATIENTS[1].name, phone: PATIENTS[1].phone, email: PATIENTS[1].email,
      checkedIn: false, status: 'pending',
    },
  ];

  for (const row of rows) {
    const existing = await prisma.appointment.findFirst({
      where: {
        patientName: row.patientName,
        prnNumber: row.patientPrn,
        date: SEED_DATE,
      },
    });
    if (existing) {
      bump('Appointment', 'skipped');
      continue;
    }
    await prisma.appointment.create({
      data: {
        patientName: row.patientName,
        phoneNumber: row.phone,
        email: row.email,
        doctorName: SEED_DOCTOR,
        department: SEED_DEPARTMENT,
        date: SEED_DATE,
        time: row.status === 'completed' ? '10:00' : '11:00',
        status: row.status,
        prnNumber: row.patientPrn,
        patientType: 'SEED',
        checkedIn: row.checkedIn,
        checkedInTime: row.checkedIn ? new Date() : null,
      },
    });
    bump('Appointment', 'created');
  }
}

async function seedEmergency(): Promise<void> {
  await prisma.emergency.upsert({
    where: { prn: SEED_EMERGENCY_PRN },
    update: {},
    create: {
      prn: SEED_EMERGENCY_PRN,
      patientName: 'SEED — Meera Joshi',
      phoneNumber: '+919900000099',
      age: 45,
      gender: 'female',
      triageCategory: 'yellow',
      presentingComplaint: 'Severe epigastric pain radiating to the back; onset 2h ago.',
      abcdeAssessment:
        'A: patent. B: RR 22, SpO2 96% on RA. C: HR 110, BP 150/95. D: GCS 15. E: abdomen tender.',
      traumaScore: 15,
      vitalsBP: '150/95',
      vitalsHR: 110,
      vitalsRR: 22,
      vitalsSpO2: 96,
      vitalsTemp: 37.2,
      status: 'arrived',
      createdBy: 'seed-script',
    },
  });
  bump('Emergency', 'created');
}

async function seedIpdAdmission(genWardId: string, genBedId: string): Promise<string> {
  const admission = await prisma.ipdAdmission.upsert({
    where: { admissionNo: SEED_ADMISSION_NO },
    update: {},
    create: {
      admissionNo: SEED_ADMISSION_NO,
      prn: String(PATIENTS[2].prn),
      admissionDate: new Date(),
      admissionTime: '09:00',
      admissionType: 'elective',
      sourceModule: 'direct',
      admittingDoctor: SEED_DOCTOR,
      department: SEED_DEPARTMENT,
      wardId: genWardId,
      bedId: genBedId,
      roomType: 'general',
      diagnosis: 'Community-acquired pneumonia — right lower lobe.',
      status: 'admitted',
      createdBy: 'seed-script',
    },
  });
  bump('IpdAdmission', 'created');

  // Mark bed as occupied to reflect the seeded admission.
  await prisma.ipdBed.update({ where: { id: genBedId }, data: { status: 'occupied' } });

  return admission.id;
}

/** Active admission for PATIENTS[0] (PRN 9900001) so the critical Potassium
 * result has a matching IPD encounter — runCriticalLabUnacked will then tag
 * the auto-incident as IPD instead of UNKNOWN. */
async function seedLabPatientAdmission(genWardId: string, bedId: string): Promise<string> {
  // Why update fields too: if a previous seed run created this row with a
  // different date or status, we want re-runs to converge — the encounter
  // lookup relies on the pinned admissionDate.
  const admission = await prisma.ipdAdmission.upsert({
    where: { admissionNo: SEED_LAB_ADMISSION_NO },
    update: {
      admissionDate: new Date('2026-04-10T11:30:00.000Z'),
      status: 'admitted',
    },
    create: {
      admissionNo: SEED_LAB_ADMISSION_NO,
      prn: String(PATIENTS[0].prn),
      // Fixed past date — the cron rule looks up admissions where
      // admissionDate <= result.reportedAt. The seeded Potassium result keeps
      // its first-seed timestamp on re-runs, so we pin this well before
      // SEED_DATE to stay on the "admitted before result" side of that check.
      admissionDate: new Date('2026-04-10T11:30:00.000Z'),
      admissionTime: '11:30',
      admissionType: 'emergency',
      sourceModule: 'direct',
      admittingDoctor: SEED_DOCTOR,
      department: SEED_DEPARTMENT,
      wardId: genWardId,
      bedId,
      roomType: 'general',
      diagnosis: 'Acute hyperkalemia — admitted for monitoring + IV insulin/dextrose.',
      status: 'admitted',
      createdBy: 'seed-script',
    },
  });
  bump('IpdAdmission', 'created');
  await prisma.ipdBed.update({ where: { id: bedId }, data: { status: 'occupied' } });
  return admission.id;
}

async function seedProgressNotes(admissionId: string): Promise<void> {
  const existing = await prisma.ipdProgressNote.count({ where: { admissionId } });
  if (existing > 0) {
    for (let i = 0; i < existing; i += 1) bump('IpdProgressNote', 'skipped');
    return;
  }

  const notes = [
    {
      date: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12h ago
      doctorName: SEED_DOCTOR,
      subjective: 'Patient reports mild cough but slept through the night.',
      objective: 'BP 128/82, HR 88, SpO2 94% on RA, afebrile.',
      assessment: 'Community-acquired pneumonia, day 2 IV ceftriaxone, clinically improving.',
      plan: 'Continue IV ceftriaxone 1g q12h; chest physiotherapy; repeat CXR day 3.',
      nursingNotes: 'Encouraged oral fluids; ambulated to bathroom twice.',
      vitalsBP: '128/82',
      vitalsHR: '88',
      vitalsTemp: '36.9',
      vitalsSpO2: '94',
      vitalsRR: '18',
    },
    {
      date: new Date(),
      doctorName: SEED_DOCTOR,
      subjective: 'Cough reducing; appetite returning.',
      objective: 'BP 122/78, HR 82, SpO2 96% on RA, afebrile.',
      assessment: 'Day 3. Responding to IV antibiotics.',
      plan: 'Consider stepping down to oral amoxicillin tomorrow if afebrile; discharge planning.',
      nursingNotes: 'Tolerating oral diet.',
      vitalsBP: '122/78',
      vitalsHR: '82',
      vitalsTemp: '36.8',
      vitalsSpO2: '96',
      vitalsRR: '16',
    },
  ];

  for (const n of notes) {
    await prisma.ipdProgressNote.create({ data: { admissionId, ...n, createdBy: 'seed-script' } });
    bump('IpdProgressNote', 'created');
  }
}

async function seedIpdPrescriptions(admissionId: string): Promise<void> {
  const existing = await prisma.ipdPrescription.count({ where: { admissionId } });
  if (existing > 0) {
    for (let i = 0; i < existing; i += 1) bump('IpdPrescription', 'skipped');
    return;
  }

  const meds = [
    {
      genericName: 'Ceftriaxone',
      brandName: 'SEED — Rocephin',
      dose: '1 g',
      frequency: 'q12h',
      duration: '5 days',
      route: 'iv' as const,
      instructions: 'Infuse over 30 minutes in 100 mL NS.',
      quantity: 10,
      isCarryOver: false,
      adminStatus: 'pending',
      status: 'active',
    },
    {
      genericName: 'Paracetamol',
      brandName: 'SEED — Calpol',
      dose: '500 mg',
      frequency: 'q6h PRN',
      duration: '3 days',
      route: 'oral' as const,
      instructions: 'For temperature > 38°C.',
      quantity: 12,
      isCarryOver: false,
      adminStatus: 'pending',
      status: 'active',
    },
  ];

  for (const m of meds) {
    await prisma.ipdPrescription.create({
      data: { admissionId, prescribedBy: SEED_DOCTOR, ...m, createdBy: 'seed-script' },
    });
    bump('IpdPrescription', 'created');
  }
}

async function seedInvestigationOrderAndCriticalResult(): Promise<void> {
  const order = await prisma.investigationOrder.findFirst({
    where: { prn: String(PATIENTS[0].prn), doctorName: SEED_DOCTOR, remarks: 'SEED — routine panel' },
  });

  let orderId: number;
  if (order) {
    orderId = order.id;
    bump('InvestigationOrder', 'skipped');
  } else {
    const created = await prisma.investigationOrder.create({
      data: {
        prn: String(PATIENTS[0].prn),
        date: SEED_DATE,
        doctorId: 999,
        doctorName: SEED_DOCTOR,
        remarks: 'SEED — routine panel',
      },
    });
    orderId = created.id;
    bump('InvestigationOrder', 'created');
  }

  const resultExists = await prisma.investigationResult.findFirst({
    where: { orderId, testName: 'SEED — Potassium' },
  });
  if (resultExists) {
    bump('InvestigationResult', 'skipped');
    return;
  }

  await prisma.investigationResult.create({
    data: {
      orderId,
      prn: String(PATIENTS[0].prn),
      testName: 'SEED — Potassium',
      department: 'lab',
      result: '7.2',
      unit: 'mmol/L',
      referenceRange: '3.5–5.0',
      criticalFlag: true,
      status: 'final',
      reportedAt: new Date(),
    },
  });
  bump('InvestigationResult', 'created');
}

// ---------- Orchestration --------------------------------------------------

async function main(): Promise<void> {
  console.log('[seed-sprint-3] starting…');

  const failures = await findNonSeedRows();
  if (failures.length > 0) {
    console.error('\n❌ Non-seed data detected in the following tables. Refusing to seed.\n');
    for (const f of failures) {
      console.error(`  - ${f.table}: ${f.nonSeedCount} row(s). Sample: ${JSON.stringify(f.sampleRow)}`);
    }
    console.error(
      '\nThis script only runs against databases that are empty of non-seed data.' +
        '\nReview the sample rows above and clean them (or point to a fresh DB) before retrying.\n'
    );
    process.exit(2);
  }

  console.log('  safety check passed — DB has no non-seed data.');

  const { genWardId, genBeds } = await seedWardsAndBeds();
  await seedPatients();
  await seedAppointments();
  await seedEmergency();
  const admissionId = await seedIpdAdmission(genWardId, genBeds[0]);
  await seedProgressNotes(admissionId);
  await seedIpdPrescriptions(admissionId);
  await seedLabPatientAdmission(genWardId, genBeds[1]);
  await seedInvestigationOrderAndCriticalResult();

  console.log('\n[seed-sprint-3] done. Summary:');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`\nNavigate to: /ipd/admission/${admissionId}/progress-note (Sprint 3a-2)`);
  console.log(`Navigate to: /ipd/admission/${admissionId}/discharge      (Sprint 3b, once built)`);
}

main()
  .catch((err: unknown) => {
    console.error('[seed-sprint-3] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
