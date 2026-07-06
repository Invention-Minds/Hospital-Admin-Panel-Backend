/**
 * Phase 9.21 — seed doctor-wise OPD note templates (for AI auto-fill testing).
 *
 * Run with:
 *   npx ts-node prisma/seed-doctor-opd-templates.ts
 *   (or: npm run seed:opd-templates)
 *
 * Creates ONE personal `opd-handwritten` template per active doctor that has a
 * linked user account (the OPD assessment form resolves the doctor via
 * Doctor.userId, so doctors without a user can't be matched). The template is
 * marked isDefault for that doctor, so it auto-selects when they open the OPD
 * assessment and the "✨ Auto-fill with AI" box appears.
 *
 * Idempotent — skips a doctor who already has a personal opd-handwritten
 * template. Two field variants alternate so you can see that templates differ
 * per doctor (the AI fills whichever keys the chosen template defines).
 *
 * NOTE: requires the `phase_9_21_doctor_note_templates` migration to be applied
 * first (the NoteTemplate.doctorId column).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOTE_TYPE = 'opd-handwritten';

// Two text/textarea field sets (AI-fillable). Handwritten-type fields are
// intentionally avoided — the model can't draw, only structure text.
const VARIANT_A = [
  { key: 'chiefComplaint', label: 'Chief complaint', type: 'text', required: true, order: 1 },
  { key: 'historyOfPresentingIllness', label: 'History of presenting illness', type: 'textarea', order: 2 },
  { key: 'pastHistory', label: 'Past / co-morbid history', type: 'textarea', order: 3 },
  { key: 'examination', label: 'On examination', type: 'textarea', order: 4 },
  { key: 'provisionalDiagnosis', label: 'Provisional diagnosis', type: 'text', order: 5 },
  { key: 'investigationsAdvised', label: 'Investigations advised', type: 'textarea', order: 6 },
  { key: 'treatmentPlan', label: 'Treatment plan', type: 'textarea', order: 7 },
  { key: 'followUp', label: 'Follow-up advice', type: 'text', order: 8 },
];

const VARIANT_B = [
  { key: 'presentingComplaint', label: 'Presenting complaint', type: 'text', required: true, order: 1 },
  { key: 'historyDuration', label: 'Duration / onset', type: 'text', order: 2 },
  { key: 'historyDetails', label: 'History details', type: 'textarea', order: 3 },
  { key: 'allergies', label: 'Allergies', type: 'text', order: 4 },
  { key: 'systemicExam', label: 'Systemic examination', type: 'textarea', order: 5 },
  { key: 'clinicalImpression', label: 'Clinical impression', type: 'text', order: 6 },
  { key: 'medications', label: 'Medications advised', type: 'textarea', order: 7 },
  { key: 'reviewAfter', label: 'Review after', type: 'text', order: 8 },
];

async function main(): Promise<void> {
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true, NOT: { userId: null } },
    select: { id: true, name: true, departmentName: true, userId: true },
    orderBy: { id: 'asc' },
  });

  if (doctors.length === 0) {
    console.log('No active doctors with a linked user account found — nothing to seed.');
    console.log('(The OPD form resolves the doctor via Doctor.userId, so a doctor needs a user login.)');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < doctors.length; i++) {
    const doc = doctors[i];

    const existing = await prisma.noteTemplate.findFirst({
      where: { doctorId: doc.id, noteType: NOTE_TYPE },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const fields = i % 2 === 0 ? VARIANT_A : VARIANT_B;
    await prisma.noteTemplate.create({
      data: {
        name: `${doc.name} — OPD Template`,
        noteType: NOTE_TYPE,
        department: doc.departmentName || 'General',
        doctorId: doc.id,
        fields: JSON.stringify(fields),
        isActive: true,
        isDefault: true, // personal default for this doctor
        createdBy: 'seed',
      },
    });
    created++;
    console.log(`  + ${doc.name} (doctorId=${doc.id}, userId=${doc.userId}, dept=${doc.departmentName}) — variant ${i % 2 === 0 ? 'A' : 'B'}`);
  }

  console.log(`\nDoctor OPD-template seed complete — ${created} created, ${skipped} already present.`);
  if (created > 0) {
    console.log('Log in as one of the doctors above, open an OPD assessment, and the personal template + "Auto-fill with AI" box should appear.');
  }
}

main()
  .catch((e) => {
    console.error('Doctor OPD-template seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
