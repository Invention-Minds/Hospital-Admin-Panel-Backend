/**
 * Dry-run the HMIS export import against the database — PREVIEW ONLY,
 * nothing is written. Prints counts and how each HMIS ward was matched.
 *
 *   npx ts-node scripts/hmis-import-preview.ts <export.xls> [more.xls …]
 */
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import prisma from '../src/service/prisma-client';
import { runHmisImport } from '../src/api/hmis-import/hmis-import.service';

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('Pass one or more HMIS export files');
  const files = paths.map((p) => ({ name: path.basename(p), buffer: fs.readFileSync(p) }));
  const result = await runHmisImport(files, { apply: false, req: { user: { username: 'preview' }, headers: {} } as unknown as Request });

  console.log('Files:');
  for (const f of result.files) console.log(`  ${f.kind.padEnd(11)} ${String(f.rows).padStart(4)} rows  ${f.name}`);
  console.log('\nSummary:', JSON.stringify(result.summary));
  console.log('\nWards:');
  for (const w of result.wards) console.log(`  ${w.hmisName.padEnd(32)} → ${w.matchedTo ?? '(new ward)'}  [${w.how}]`);
  const reasons = new Map<string, number>();
  for (const i of result.items.filter((x) => x.action === 'REVIEW')) {
    const key = (i.note ?? '').replace(/"[^"]*"/g, '"…"').replace(/\d{3,}/g, '#');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log('\nReview reasons:');
  for (const [k, n] of reasons) console.log(`  ${n} × ${k}`);
}

main()
  .catch((e) => { console.error('Preview failed:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
