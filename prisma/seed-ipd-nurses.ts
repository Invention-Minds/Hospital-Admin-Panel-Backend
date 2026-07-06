/**
 * Seed — IPD-side nurse login accounts.
 *
 * Creates the three clinical-ward staff logins the IPD module gates on
 * (sidebar IPD / Admissions, ICU transfer, staff handover, treatment dashboard):
 *   • IPD Nurse        — ward nurse
 *   • ICU Nurse        — ICU nurse
 *   • Ward Coordinator — charge nurse (also gets ward-census + roster)
 *
 * These subAdminType values were previously not creatable from the settings UI,
 * so no account ever satisfied the IPD sidebar gate. This seed provisions them.
 *
 * Idempotent: re-running upserts by employeeId (won't duplicate rows). Existing
 * accounts keep their current password — only username/role/subAdminType are
 * refreshed — so a re-run never silently resets a password a user has changed.
 *
 *   Run:  npm run seed:ipd-nurses
 *
 * Override the default password for NEW accounts:  IPD_NURSE_PASSWORD=... npm run seed:ipd-nurses
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Default password for newly-created accounts. Change after first login.
const DEFAULT_PASSWORD = process.env.IPD_NURSE_PASSWORD || 'Nurse@123';
const CREATED_BY = 'seed:ipd-nurses';

interface NurseSeed {
  username: string;
  employeeId: string;
  subAdminType: 'IPD Nurse' | 'ICU Nurse' | 'Ward Coordinator';
  fullName: string;
  designation: string;
}

// employeeIds deliberately avoid the B<n> / C<n> patterns the login redirect
// parses (those route to /nursing/<block> and /channel/<n>) — keeps these
// accounts on the subAdminType → /ipd branch instead.
const NURSES: NurseSeed[] = [
  { username: 'ipd.nurse',        employeeId: 'IPDN001', subAdminType: 'IPD Nurse',        fullName: 'IPD Nurse',        designation: 'Staff Nurse' },
  { username: 'icu.nurse',        employeeId: 'ICUN001', subAdminType: 'ICU Nurse',        fullName: 'ICU Nurse',        designation: 'Staff Nurse' },
  { username: 'ward.coordinator', employeeId: 'WARD001', subAdminType: 'Ward Coordinator', fullName: 'Ward Coordinator', designation: 'Charge Nurse' },
];

async function main(): Promise<void> {
  console.log('👤 Seeding IPD nurse logins…');
  const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  for (const n of NURSES) {
    const row = await prisma.user.upsert({
      where: { employeeId: n.employeeId },
      // On re-run: refresh identity/role but DO NOT touch the password.
      update: {
        username: n.username,
        role: UserRole.sub_admin,
        subAdminType: n.subAdminType,
        fullName: n.fullName,
        designation: n.designation,
        isActive: true,
        updatedBy: CREATED_BY,
      },
      create: {
        username: n.username,
        password: hashed,
        role: UserRole.sub_admin,
        employeeId: n.employeeId,
        subAdminType: n.subAdminType,
        fullName: n.fullName,
        designation: n.designation,
        isActive: true,
        createdBy: CREATED_BY,
      },
    });
    console.log(`   ✓ ${n.subAdminType.padEnd(16)} → employeeId=${n.employeeId} (user id ${row.id})`);
  }

  console.log(
    `\n✅ Done. ${NURSES.length} accounts ready.\n` +
    `   Login with the employeeId above. New accounts use password: ${DEFAULT_PASSWORD}\n` +
    `   (existing accounts keep their current password). Change it after first login.\n`,
  );
}

main()
  .catch((e) => {
    console.error('❌ seed-ipd-nurses failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
