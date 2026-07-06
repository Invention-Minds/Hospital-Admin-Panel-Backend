/**
 * OT workflow — seed initial OT rooms.
 *
 * Run with:
 *   npx ts-node prisma/seed-ot-rooms.ts
 *
 * Idempotent — upserts on OtRoom.code (which is @unique). Status is left
 * untouched on existing rows so an in-use room doesn't get reset to
 * 'available' by a re-run.
 *
 * Six rooms typical for a mid-size multi-speciality hospital:
 *   • 3 major OTs (general / ortho / neuro)
 *   • 1 minor OT for day-care procedures
 *   • 1 cath lab
 *   • 1 endoscopy suite
 *
 * Adjust counts / equipment classes to match your hospital before running in
 * production. For demo / dev, the defaults are fine.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RoomSeed {
  code: string;
  name: string;
  type: 'major' | 'minor' | 'cath-lab' | 'endoscopy';
  equipmentClass: string | null;
  hepaFiltered: boolean;
}

const ROOMS: RoomSeed[] = [
  { code: 'OT-MAJOR-1', name: 'Major OT 1 — General Surgery', type: 'major', equipmentClass: 'general', hepaFiltered: true },
  { code: 'OT-MAJOR-2', name: 'Major OT 2 — Orthopaedics',    type: 'major', equipmentClass: 'ortho',   hepaFiltered: true },
  { code: 'OT-MAJOR-3', name: 'Major OT 3 — Neurosurgery',    type: 'major', equipmentClass: 'neuro',   hepaFiltered: true },
  { code: 'OT-MINOR-1', name: 'Minor OT — Day-care',          type: 'minor', equipmentClass: 'general', hepaFiltered: false },
  { code: 'CATH-LAB-1', name: 'Cath Lab 1',                   type: 'cath-lab',  equipmentClass: 'cardiac', hepaFiltered: false },
  { code: 'ENDO-1',     name: 'Endoscopy Suite',              type: 'endoscopy', equipmentClass: 'GI',      hepaFiltered: false },
];

async function main(): Promise<void> {
  console.log('Seeding OT rooms…\n');
  for (const r of ROOMS) {
    const row = await prisma.otRoom.upsert({
      where: { code: r.code },
      update: {
        name: r.name, type: r.type,
        equipmentClass: r.equipmentClass, hepaFiltered: r.hepaFiltered,
        // Intentionally do NOT touch `status` — a re-run shouldn't reset an
        // in-use room back to 'available'.
      },
      create: {
        code: r.code, name: r.name, type: r.type,
        equipmentClass: r.equipmentClass, hepaFiltered: r.hepaFiltered,
        status: 'available',
      },
    });
    console.log(`  ${row.code.padEnd(11)} ${row.type.padEnd(10)} ${row.status.padEnd(12)} ${row.name}`);
  }
  console.log(`\nSeeded ${ROOMS.length} OT rooms.`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
