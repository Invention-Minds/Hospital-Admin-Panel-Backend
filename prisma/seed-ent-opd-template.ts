/**
 * Seed the ENT department's OPD assessment template (department-level,
 * doctorId: null — shared by every ENT doctor), matching the department's
 * handwritten paper format: EAR (table of findings x R/L), NOSE, THROAT, NECK.
 *
 * Run with:
 *   npx ts-node prisma/seed-ent-opd-template.ts
 *
 * Idempotent — skips if an active 'opd-handwritten' department-level template
 * already exists for this department.
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
    key: 'earFindings',
    label: 'EAR — Findings',
    type: 'table',
    group: 'EAR',
    order: 1,
    rows: ['External Auditory Canal (EAC)', 'Tympanic Membrane (TM)', 'Post Aural Area'],
    columns: ['R', 'L'],
  },
  {
    key: 'paranasalSinusTenderness',
    label: 'Paranasal Sinus Tenderness (PNS)',
    type: 'text',
    group: 'NOSE',
    order: 2,
  },
  {
    key: 'oralCavity',
    label: 'Oral Cavity',
    type: 'text',
    group: 'THROAT',
    order: 3,
  },
  {
    key: 'oropharynx',
    label: 'Oropharynx',
    type: 'text',
    group: 'THROAT',
    order: 4,
  },
  {
    key: 'neckFindings',
    label: 'Neck',
    type: 'textarea',
    group: 'NECK',
    order: 5,
  },
];

async function main(): Promise<void> {
  const existing = await prisma.noteTemplate.findFirst({
    where: { department: DEPARTMENT, noteType: NOTE_TYPE, doctorId: null, isActive: true },
    select: { id: true, name: true },
  });
  if (existing) {
    console.log(`Already present: "${existing.name}" (id=${existing.id}) — nothing to do.`);
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
  console.log(`Created "${created.name}" (id=${created.id}) for department="${DEPARTMENT}".`);
}

main()
  .catch((e) => {
    console.error('ENT OPD-template seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
