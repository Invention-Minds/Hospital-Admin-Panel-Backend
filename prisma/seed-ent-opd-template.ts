/**
 * Seed the ENT department's OPD assessment template (department-level,
 * doctorId: null — shared by every ENT doctor).
 *
 * Layout (per ENT doctor's request): the standard OPD sections, with the
 * department's handwritten paper format (EAR table of findings x R/L, NOSE,
 * THROAT, NECK) placed under EXAMINATION:
 *   HISTORY → EXAMINATION (Ear / Nose / Throat / Neck) → DIAGNOSIS →
 *   INVESTIGATION → TREATMENT PLAN
 *
 * A selected template REPLACES the fixed History/Examination/... boxes on the
 * OPD assessment, so those sections must be fields here too.
 *
 * Run with:
 *   npx ts-node prisma/seed-ent-opd-template.ts
 *
 * Idempotent — if an active 'opd-handwritten' department-level template
 * already exists for this department, its fields are replaced with the layout
 * below; otherwise a new one is created. Past assessments are unaffected (each
 * stores its own schema snapshot in templatedValues._schema). Original ENT
 * field keys are kept unchanged so earlier values still line up.
 *
 * NOTE: DEPARTMENT below must match the exact department name string used in
 * this hospital's Department table (case-sensitive — templates are looked up
 * by exact match). Confirm it against `Department.name` before running.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEPARTMENT = 'ENT';
const NOTE_TYPE = 'opd-handwritten';

const FIELDS = [
  {
    key: 'history',
    label: 'History',
    type: 'textarea',
    group: 'HISTORY',
    order: 1,
  },
  {
    key: 'earFindings',
    label: 'Ear',
    type: 'table',
    group: 'EXAMINATION',
    order: 2,
    rows: ['External Auditory Canal (EAC)', 'Tympanic Membrane (TM)', 'Post Aural Area'],
    columns: ['R', 'L'],
  },
  {
    key: 'paranasalSinusTenderness',
    label: 'Nose – Paranasal Sinus Tenderness (PNS)',
    type: 'text',
    group: 'EXAMINATION',
    order: 3,
  },
  {
    key: 'oralCavity',
    label: 'Throat – Oral Cavity',
    type: 'text',
    group: 'EXAMINATION',
    order: 4,
  },
  {
    key: 'oropharynx',
    label: 'Throat – Oropharynx',
    type: 'text',
    group: 'EXAMINATION',
    order: 5,
  },
  {
    key: 'neckFindings',
    label: 'Neck',
    type: 'textarea',
    group: 'EXAMINATION',
    order: 6,
  },
  {
    key: 'diagnosis',
    label: 'Diagnosis',
    type: 'textarea',
    group: 'DIAGNOSIS',
    order: 7,
  },
  {
    key: 'investigation',
    label: 'Investigation',
    type: 'textarea',
    group: 'INVESTIGATION',
    order: 8,
  },
  {
    key: 'treatmentPlan',
    label: 'Treatment Plan',
    type: 'textarea',
    group: 'TREATMENT PLAN',
    order: 9,
  },
];

async function main(): Promise<void> {
  const existing = await prisma.noteTemplate.findFirst({
    where: { department: DEPARTMENT, noteType: NOTE_TYPE, doctorId: null, isActive: true },
    select: { id: true, name: true },
  });

  if (existing) {
    await prisma.noteTemplate.update({
      where: { id: existing.id },
      data: { fields: JSON.stringify(FIELDS), updatedBy: 'seed' },
    });
    console.log(`Updated "${existing.name}" (id=${existing.id}) → ${FIELDS.length} fields.`);
    return;
  }

  const created = await prisma.noteTemplate.create({
    data: {
      name: 'ENT Department Format',
      noteType: NOTE_TYPE,
      department: DEPARTMENT,
      doctorId: null,
      fields: JSON.stringify(FIELDS),
      isActive: true,
      isDefault: true,
      createdBy: 'seed',
    },
  });
  console.log(`Created "${created.name}" (id=${created.id}) for department="${DEPARTMENT}" → ${FIELDS.length} fields.`);
}

main()
  .catch((e) => {
    console.error('ENT OPD-template seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
