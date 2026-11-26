/// <reference path="../global.d.ts" />
/**
 * Backfill PatientDetails.mobileNo for patients who have NO phone number
 * (mobileNo and contactNo both empty), from the patient's most recent
 * staff-handled appointment with the same PRN.
 *
 * Same rules as the automatic check-in backfill (src/api/patient/patient-helper.ts
 * backfillPatientPhone):
 *   • never overwrites an existing number (conditional update)
 *   • only numbers from appointments a staff member handled — checked in, or
 *     booked by a logged-in user — never WhatsApp-bot / AI-receptionist
 *     bookings (the patient number receives the record-access OTP)
 *   • valid Indian mobile only: 10 digits starting 6-9, no repeated-digit dummies
 *
 * Dry run (default) only reads and prints counts with masked examples:
 *   npx ts-node scripts/backfill-patient-phones.ts
 * Apply (writes, and saves a change log CSV in the home folder, mode 600):
 *   npx ts-node scripts/backfill-patient-phones.ts --apply
 * Safe to re-run: patients already filled are no longer candidates.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BOT_SOURCES = ['whatsapp', 'ai-receptionist'];
const CHUNK = 1000;

const isEmpty = (v: string | null) => !v || v.replace(/\D/g, '').length === 0;

/** Last 10 digits if they form a valid Indian mobile number, else null. */
export const normalizeMobile = (phone: string | null | undefined): string | null => {
  const digits = String(phone ?? '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(digits) && !/^(\d)\1{9}$/.test(digits) ? digits : null;
};

const mask = (p: string) => `${p.slice(0, 2)}******${p.slice(-2)}`;

async function main() {
  const db = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0];
  console.log(`Database: ${db} · mode: ${APPLY ? 'APPLY' : 'dry run'}\n`);

  const missing = (await prisma.patientDetails.findMany({
    select: { id: true, prn: true, mobileNo: true, contactNo: true },
  })).filter((p) => isEmpty(p.mobileNo) && isEmpty(p.contactNo));
  console.log(`Patients with no phone number: ${missing.length}`);

  // Most recent qualifying appointment number per PRN.
  const found = new Map<number, string>();
  for (let i = 0; i < missing.length; i += CHUNK) {
    const prns = missing.slice(i, i + CHUNK).map((p) => p.prn);
    const appts = await prisma.appointment.findMany({
      where: {
        prnNumber: { in: prns },
        OR: [{ checkedIn: true }, { userId: { not: null } }],
        NOT: { requestVia: { in: BOT_SOURCES } },
      },
      select: { prnNumber: true, phoneNumber: true },
      orderBy: { created_at: 'desc' },
    });
    for (const a of appts) {
      if (a.prnNumber == null || found.has(a.prnNumber)) continue;
      const phone = normalizeMobile(a.phoneNumber);
      if (phone) found.set(a.prnNumber, phone);
    }
  }

  const candidates = missing.filter((p) => found.has(p.prn));
  console.log(`Would get a number from a staff-handled appointment: ${candidates.length}`);
  console.log(`No usable appointment number (stay empty): ${missing.length - candidates.length}`);
  for (const p of candidates.slice(0, 10)) console.log(`  PRN ${p.prn} -> ${mask(found.get(p.prn)!)}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these numbers.');
    return;
  }

  // Change log holds phone numbers: keep it out of the repo and private.
  const logFile = path.join(os.homedir(), `phone-backfill-${db}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  fs.writeFileSync(logFile, 'patientId,prn,mobileNoSet\n', { mode: 0o600 });

  let updated = 0;
  let skipped = 0;
  for (const p of candidates) {
    const phone = found.get(p.prn)!;
    // Conditional write: only if still empty now (a number added meanwhile wins).
    const r = await prisma.patientDetails.updateMany({
      where: {
        id: p.id,
        OR: [{ mobileNo: null }, { mobileNo: '' }],
        AND: [{ OR: [{ contactNo: null }, { contactNo: '' }] }],
      },
      data: { mobileNo: phone },
    });
    if (r.count > 0) {
      updated++;
      fs.appendFileSync(logFile, `${p.id},${p.prn},${phone}\n`);
    } else {
      skipped++;
    }
  }
  console.log(`\nUpdated: ${updated} · skipped (number added meanwhile): ${skipped}`);
  console.log(`Change log (private, keep for undo): ${logFile}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
