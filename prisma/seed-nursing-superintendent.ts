/**
 * Seed — Nursing Superintendent login + one-time nurse subAdminType migration.
 *
 * Phase NS-5. Two idempotent steps:
 *
 *  1. Provision a 'Nursing Superintendent' account. This is the management role
 *     that sees every ward, owns the Nursing Stations + Roster screens, and
 *     bypasses ward scoping (see _shared/nursing-roles).
 *
 *  2. Collapse legacy bedside-nurse subAdminType values into the canonical
 *     'Nurse'. The codebase previously used several incompatible strings
 *     ('IPD Nurse', 'ICU Nurse', 'Ward Coordinator', 'Nursing', lowercase
 *     'nurse'); they now all become 'Nurse'.
 *
 *     IMPORTANT: 'Nursing' was historically overloaded — the demo data also
 *     used it for a superintendent (employeeId 'NS001'). To avoid demoting a
 *     superintendent to a bedside nurse, the migration skips any account whose
 *     employeeId starts with 'NS'. Review your own data before running in prod.
 *
 * Idempotent: re-running upserts the account by employeeId (password preserved)
 * and the UPDATE is naturally idempotent.
 *
 *   Run:  npm run seed:nursing-super
 *
 * Override the default password for a NEW account:
 *   NS_SUPER_PASSWORD=... npm run seed:nursing-super
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.NS_SUPER_PASSWORD || 'Super@123';
const CREATED_BY = 'seed:nursing-super';

const SUPER = {
  username: 'nursing.super',
  employeeId: 'NS001',
  subAdminType: 'Nursing Superintendent',
  fullName: 'Nursing Superintendent',
  designation: 'Nurse Manager',
};

// Legacy bedside-nurse values that collapse into the canonical 'Nurse'.
const LEGACY_NURSE = ['IPD Nurse', 'ICU Nurse', 'Ward Coordinator', 'Nursing', 'nurse'];

async function main(): Promise<void> {
  console.log('👤 Seeding Nursing Superintendent…');
  const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const row = await prisma.user.upsert({
    where: { employeeId: SUPER.employeeId },
    // EXISTING account (e.g. the NS001 row already in the DB with
    // subAdminType='Nursing'): only promote it to the superintendent role +
    // ensure it's active. Leave username / fullName / designation / password
    // untouched so we never clobber a real account's identity or credentials.
    update: {
      role: UserRole.sub_admin,
      subAdminType: SUPER.subAdminType,
      isActive: true,
      updatedBy: CREATED_BY,
    },
    create: {
      username: SUPER.username,
      password: hashed,
      role: UserRole.sub_admin,
      employeeId: SUPER.employeeId,
      subAdminType: SUPER.subAdminType,
      fullName: SUPER.fullName,
      designation: SUPER.designation,
      isActive: true,
      createdBy: CREATED_BY,
    },
  });
  console.log(`   ✓ ${SUPER.subAdminType} → employeeId=${SUPER.employeeId} (user id ${row.id})`);

  // ── One-time collapse: legacy nurse subAdminTypes → 'Nurse' ──────────────
  // Skip employeeId starting 'NS' so a demo superintendent isn't demoted.
  const migrated = await prisma.user.updateMany({
    where: {
      subAdminType: { in: LEGACY_NURSE },
      NOT: { employeeId: { startsWith: 'NS' } },
    },
    data: { subAdminType: 'Nurse', updatedBy: CREATED_BY },
  });
  console.log(`   ✓ Collapsed ${migrated.count} legacy nurse account(s) → 'Nurse'`);

  console.log(
    `\n✅ Done.\n` +
    `   Superintendent login: employeeId=${SUPER.employeeId}` +
    ` (new accounts use password: ${DEFAULT_PASSWORD}; existing keep theirs).\n` +
    `   Change the password after first login.\n`,
  );
}

main()
  .catch((e) => {
    console.error('❌ seed-nursing-superintendent failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
