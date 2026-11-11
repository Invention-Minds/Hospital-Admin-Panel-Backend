/// <reference path="../global.d.ts" />
/**
 * Backfill IpdAdmission.admittingDoctorId from the admittingDoctor name snapshot.
 *
 * A name is linked only when, after normalising (drop "Dr"/"Dr.", case,
 * punctuation, extra spaces), it equals exactly ONE doctor's name. Everything
 * else is reported for a human to fix, never guessed:
 *   • ambiguous — two or more doctors share that name
 *   • unmatched — no doctor has that name (a spelling difference, a doctor not
 *     in the Doctor table, or HMIS placeholder text); a likely doctor is
 *     suggested when exactly one doctor's name contains it or vice versa
 *
 * Dry run (default) only reads, and works before the migration is applied:
 *   npx ts-node scripts/backfill-admitting-doctor-id.ts
 * Apply (needs the admittingDoctorId migration; never overwrites a set id):
 *   npx ts-node scripts/backfill-admitting-doctor-id.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import { normalizeDoctorName } from '../src/service/doctor-name-match';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const db = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0];
  console.log(`Database: ${db} · mode: ${APPLY ? 'APPLY' : 'dry run'}\n`);

  const doctors = await prisma.doctor.findMany({ select: { id: true, name: true } });
  const byNorm = new Map<string, { id: number; name: string }[]>();
  for (const d of doctors) {
    const k = normalizeDoctorName(d.name);
    if (k) byNorm.set(k, [...(byNorm.get(k) ?? []), d]);
  }

  // Selecting only these columns keeps the dry run working before the migration.
  const admissions = await prisma.ipdAdmission.findMany({
    select: { id: true, admittingDoctor: true },
  });

  const linkable = new Map<number, string[]>(); // doctorId → admission ids
  const ambiguous = new Map<string, { count: number; doctors: string[] }>();
  const unmatched = new Map<string, { count: number; suggestion: string | null }>();

  for (const a of admissions) {
    const k = normalizeDoctorName(a.admittingDoctor);
    const hits = k ? byNorm.get(k) ?? [] : [];
    if (hits.length === 1) {
      linkable.set(hits[0].id, [...(linkable.get(hits[0].id) ?? []), a.id]);
    } else if (hits.length > 1) {
      const e = ambiguous.get(a.admittingDoctor) ?? { count: 0, doctors: hits.map((h) => `#${h.id} ${h.name}`) };
      e.count += 1;
      ambiguous.set(a.admittingDoctor, e);
    } else {
      const e = unmatched.get(a.admittingDoctor);
      if (e) e.count += 1;
      else {
        const near = k
          ? doctors.filter((d) => {
              const dn = normalizeDoctorName(d.name);
              return dn && (dn.includes(k) || k.includes(dn));
            })
          : [];
        unmatched.set(a.admittingDoctor, { count: 1, suggestion: near.length === 1 ? `#${near[0].id} ${near[0].name}` : null });
      }
    }
  }

  const linkCount = [...linkable.values()].reduce((n, ids) => n + ids.length, 0);
  const sum = (m: Map<string, { count: number }>) => [...m.values()].reduce((n, e) => n + e.count, 0);
  console.log(`Admissions: ${admissions.length} · doctors: ${doctors.length}`);
  console.log(`  linkable (exact, one doctor): ${linkCount}`);
  console.log(`  ambiguous (shared name):      ${sum(ambiguous)}`);
  console.log(`  unmatched:                    ${sum(unmatched)}\n`);

  if (ambiguous.size) {
    console.log('AMBIGUOUS — pick the right doctor by hand:');
    for (const [name, e] of ambiguous) console.log(`  ${JSON.stringify(name)} ×${e.count} → ${e.doctors.join(' | ')}`);
    console.log('');
  }
  if (unmatched.size) {
    console.log('UNMATCHED — fix the name or link by hand (suggestion shown when one doctor is a close match):');
    for (const [name, e] of [...unmatched].sort((x, y) => y[1].count - x[1].count)) {
      console.log(`  ${JSON.stringify(name)} ×${e.count}${e.suggestion ? `  → maybe ${e.suggestion}` : ''}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply after the migration to link the exact matches.');
    return;
  }

  let written = 0;
  for (const [doctorId, ids] of linkable) {
    // Never overwrite an id that is already set.
    const r = await prisma.ipdAdmission.updateMany({ where: { id: { in: ids }, admittingDoctorId: null }, data: { admittingDoctorId: doctorId } });
    written += r.count;
  }
  console.log(`Linked ${written} admission(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
