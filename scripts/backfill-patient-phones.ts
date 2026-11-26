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
 *   • 'Online' (public website) bookings count only if the patient was checked
 *     in — the number was typed by whoever booked, not by staff
 *   • valid Indian mobile only: 10 digits starting 6-9, no repeated-digit dummies
 *   • a number shared by more than --max-shared different patients (default 10)
 *     is skipped — likely a desk/agent number; those patients stay empty and
 *     get a number at their next check-in instead
 *
 * Dry run (default) only reads and prints counts with masked examples:
 *   npx ts-node scripts/backfill-patient-phones.ts [--max-shared=10]
 * Apply (writes, and saves a change log CSV in the home folder, mode 600):
 *   npx ts-node scripts/backfill-patient-phones.ts --apply [--max-shared=10]
 * Safe to re-run: patients already filled are no longer candidates.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BOT_SOURCES = ['whatsapp', 'ai-receptionist'];
const maxSharedArg = process.argv.find((a) => a.startsWith('--max-shared='));
const MAX_SHARED = maxSharedArg ? Number(maxSharedArg.split('=')[1]) : 10;
if (!Number.isInteger(MAX_SHARED) || MAX_SHARED < 1) {
  console.error('--max-shared must be a whole number of 1 or more');
  process.exit(1);
}

const isEmpty = (v: string | null) => !v || v.replace(/\D/g, '').length === 0;

/** Last 10 digits if they form a valid Indian mobile number, else null. */
export const normalizeMobile = (phone: string | null | undefined): string | null => {
  const digits = String(phone ?? '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(digits) && !/^(\d)\1{9}$/.test(digits) ? digits : null;
};

const mask = (p: string) => `${p.slice(0, 2)}******${p.slice(-2)}`;

async function main() {
  const db = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0];
  console.log(`Database: ${db} · mode: ${APPLY ? 'APPLY' : 'dry run'} · max shared: ${MAX_SHARED}\n`);

  const missing = (await prisma.patientDetails.findMany({
    select: { id: true, prn: true, mobileNo: true, contactNo: true },
  })).filter((p) => isEmpty(p.mobileNo) && isEmpty(p.contactNo));
  const missingPrns = new Set(missing.map((p) => p.prn));
  console.log(`Patients with no phone number: ${missing.length}`);

  // Every staff-handled appointment (all patients), newest first — needed to
  // count how many different patients share each number.
  const appts = await prisma.appointment.findMany({
    where: {
      prnNumber: { not: null },
      OR: [{ checkedIn: true }, { userId: { not: null } }],
      NOT: { requestVia: { in: BOT_SOURCES } },
    },
    select: { prnNumber: true, phoneNumber: true, requestVia: true, checkedIn: true },
    orderBy: { created_at: 'desc' },
  });

  const patientsPerPhone = new Map<string, Set<number>>();
  const latestPhone = new Map<number, string>();   // newest qualifying number per PRN
  const onlineOnly = new Set<number>();            // had numbers, but only from unchecked-in Online bookings
  for (const a of appts) {
    const phone = normalizeMobile(a.phoneNumber);
    if (a.prnNumber == null || !phone) continue;
    const unverifiedOnline = (a.requestVia ?? '').toLowerCase() === 'online' && a.checkedIn !== true;
    if (unverifiedOnline) {
      if (missingPrns.has(a.prnNumber) && !latestPhone.has(a.prnNumber)) onlineOnly.add(a.prnNumber);
      continue;
    }
    const set = patientsPerPhone.get(phone) ?? new Set<number>();
    set.add(a.prnNumber);
    patientsPerPhone.set(phone, set);
    if (missingPrns.has(a.prnNumber) && !latestPhone.has(a.prnNumber)) {
      latestPhone.set(a.prnNumber, phone);
      onlineOnly.delete(a.prnNumber);
    }
  }

  const found = new Map<number, string>();
  let sharedSkipped = 0;
  for (const [prn, phone] of latestPhone) {
    if ((patientsPerPhone.get(phone)?.size ?? 0) > MAX_SHARED) sharedSkipped++;
    else found.set(prn, phone);
  }

  const candidates = missing.filter((p) => found.has(p.prn));
  console.log(`Would get a number from a staff-handled appointment: ${candidates.length}`);
  console.log(`Held back — only unverified Online bookings (not checked in): ${onlineOnly.size}`);
  console.log(`Held back — number shared by more than ${MAX_SHARED} patients: ${sharedSkipped}`);
  console.log(`No usable appointment number at all: ${missing.length - candidates.length - onlineOnly.size - sharedSkipped}`);
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
