/// <reference path="../global.d.ts" />
/**
 * Seed sub_admin users for the Phase D + Phase P workflow roles.
 *
 *   - Medical Transcriptionist  → /discharge/mt-queue
 *   - Pharmacy Coordinator      → /pharmacy/queue + /discharge/queue/PHARMACY
 *   - Billing Coordinator       → /discharge/queue/BILLING
 *   - Discharge Coordinator     → /discharge/queue/* (board switcher)
 *   - Dietician                 → /discharge/queue/DIET
 *
 * Each user lands as role='sub_admin', isReceptionist=false, with the
 * subAdminType the sidebar gates against. employeeId is SEED-prefixed so the
 * upsert is idempotent and the rows are easy to spot (or delete) later.
 *
 * Run: npx ts-node scripts/seed-phase-users.ts
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = 'Welcome@123'; // change at first login
const CREATED_BY = 'seed-phase-users';

interface SeedUser {
  employeeId: string;
  username: string;
  fullName: string;
  subAdminType: string;
}

const USERS: SeedUser[] = [
  { employeeId: 'SEED-MT-01',   username: 'mt.demo',        fullName: 'SEED — Maya (Medical Transcriptionist)', subAdminType: 'Medical Transcriptionist' },
  { employeeId: 'SEED-PHARM-01',username: 'pharmacy.demo',  fullName: 'SEED — Priya (Pharmacy Coordinator)',    subAdminType: 'Pharmacy Coordinator' },
  { employeeId: 'SEED-BILL-01', username: 'billing.demo',   fullName: 'SEED — Bharath (Billing Coordinator)',   subAdminType: 'Billing Coordinator' },
  { employeeId: 'SEED-DSCH-01', username: 'discharge.demo', fullName: 'SEED — Deepa (Discharge Coordinator)',   subAdminType: 'Discharge Coordinator' },
  { employeeId: 'SEED-DIET-01', username: 'diet.demo',      fullName: 'SEED — Dhruv (Dietician)',                subAdminType: 'Dietician' },
];

async function main(): Promise<void> {
  console.log('[seed-phase-users] starting…\n');
  const hashedPassword = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  let created = 0;
  let updated = 0;
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { employeeId: u.employeeId } });
    if (existing) {
      // Self-heal: re-apply the subAdminType + fullName + isActive in case
      // the row drifted; leave the password alone so manual changes survive.
      await prisma.user.update({
        where: { employeeId: u.employeeId },
        data: {
          username: u.username,
          fullName: u.fullName,
          role: 'sub_admin' as UserRole,
          subAdminType: u.subAdminType,
          isActive: true,
          isReceptionist: false,
          updatedBy: CREATED_BY,
        },
      });
      updated += 1;
      console.log(`  ↺ ${u.employeeId} · ${u.subAdminType} (existing — fields re-applied)`);
    } else {
      await prisma.user.create({
        data: {
          employeeId: u.employeeId,
          username: u.username,
          password: hashedPassword,
          role: 'sub_admin' as UserRole,
          subAdminType: u.subAdminType,
          fullName: u.fullName,
          isActive: true,
          isReceptionist: false,
          createdBy: CREATED_BY,
        },
      });
      created += 1;
      console.log(`  ✓ ${u.employeeId} · ${u.subAdminType} (created)`);
    }
  }

  console.log(`\n✅ Done. created=${created}, updated=${updated}`);
  console.log(`\nLogin credentials (all users):`);
  console.log(`  password: ${DEFAULT_PASSWORD}`);
  console.log(`  use any of the employeeIds above`);
  console.log(`\nWhere they show up in the sidebar:`);
  console.log(`  Medical Transcriptionist → MT Queue`);
  console.log(`  Pharmacy Coordinator     → Pharmacy Queue + Discharge Clearance`);
  console.log(`  Billing Coordinator      → Discharge Clearance`);
  console.log(`  Discharge Coordinator    → Discharge Clearance (board switcher)`);
  console.log(`  Dietician                → Discharge Clearance (DIET dept)`);
}

main()
  .catch((err) => { console.error('[seed-phase-users] failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
