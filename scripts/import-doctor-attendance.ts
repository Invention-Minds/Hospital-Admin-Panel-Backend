/**
 * One-time import of doctor-attendance.json into the DoctorAttendance table.
 *
 * The old store kept a bare list of doctor ids for the current day and pruned
 * every other day on each write, so the only thing there is to import is
 * whichever day the file was last written — and it carries no arrival time.
 *
 * Because of that, imported rows get the file's last-modified time as their
 * arrivedAt and are stamped `markedBy = 'import:doctor-attendance.json'`. That
 * time is an approximation of the LAST mark of the day, not of each doctor's
 * own arrival: treat imported rows as "this doctor was in", not as a punctuality
 * record. Rows marked through the UI from now on carry real times.
 *
 * Safe to re-run: an existing row for the same doctor and day is left alone, so
 * a genuine arrival time is never overwritten by an approximate one.
 *
 *   npx ts-node scripts/import-doctor-attendance.ts            # preview only
 *   npx ts-node scripts/import-doctor-attendance.ts --write    # apply
 *
 * Run it on the machine that runs the API — the file lives in that process's
 * working directory, so a developer checkout holds a different (usually stale)
 * copy from production.
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STORE_PATH = path.join(process.cwd(), 'doctor-attendance.json');
const APPLY = process.argv.includes('--write');

type AttendanceMap = { [date: string]: number[] };

async function main(): Promise<void> {
  if (!fs.existsSync(STORE_PATH)) {
    console.log(`Nothing to import — no file at ${STORE_PATH}`);
    return;
  }

  const raw = fs.readFileSync(STORE_PATH, 'utf-8');
  let store: AttendanceMap;
  try {
    store = raw ? (JSON.parse(raw) as AttendanceMap) : {};
  } catch {
    console.error(`Could not parse ${STORE_PATH} — aborting.`);
    process.exitCode = 1;
    return;
  }

  // The file has no per-doctor times; its mtime is the closest thing available.
  const arrivedAt = fs.statSync(STORE_PATH).mtime;
  const dates = Object.keys(store).sort();

  if (!dates.length) {
    console.log('Nothing to import — the file holds no days.');
    return;
  }

  console.log(`Source : ${STORE_PATH}`);
  console.log(`Days   : ${dates.join(', ')}`);
  console.log(`Time   : ${arrivedAt.toISOString()} (file mtime — approximate)`);
  console.log(APPLY ? 'Mode   : WRITE\n' : 'Mode   : preview (pass --write to apply)\n');

  let created = 0;
  let skippedExisting = 0;
  let skippedMissingDoctor = 0;

  for (const date of dates) {
    for (const doctorId of store[date] ?? []) {
      const doctor = await prisma.doctor.findUnique({
        where: { id: doctorId },
        select: { id: true, name: true },
      });
      if (!doctor) {
        // The id may belong to a doctor deleted since the file was written.
        console.log(`  skip  ${date}  doctor ${doctorId} — no such doctor`);
        skippedMissingDoctor++;
        continue;
      }

      const existing = await prisma.doctorAttendance.findUnique({
        where: { doctorId_date: { doctorId, date } },
      });
      if (existing) {
        console.log(`  skip  ${date}  ${doctor.name} — already recorded`);
        skippedExisting++;
        continue;
      }

      console.log(`  add   ${date}  ${doctor.name}`);
      if (APPLY) {
        await prisma.doctorAttendance.create({
          data: { doctorId, date, arrivedAt, markedBy: 'import:doctor-attendance.json' },
        });
      }
      created++;
    }
  }

  console.log(
    `\n${APPLY ? 'Imported' : 'Would import'} ${created} row(s); ` +
      `${skippedExisting} already present, ${skippedMissingDoctor} unknown doctor(s).`,
  );
  if (!APPLY && created) console.log('Re-run with --write to apply.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
