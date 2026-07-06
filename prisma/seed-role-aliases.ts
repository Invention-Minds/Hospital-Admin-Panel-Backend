/// <reference path="../global.d.ts" />

/**
 * Phase 6 / Batch A — seed the RoleAlias table with the spec strings the
 * Quality / Incident / Feedback / Complaint modules have been firing as
 * notification targets. Each maps to a sensible default within the real
 * UserRole enum (super_admin | sub_admin | admin | doctor | unknown) or a
 * User.subAdminType free-text value.
 *
 * Idempotent — upserts by `alias`. Re-running is safe and preserves any
 * targetRole edits an admin made via the UI (we don't touch targetRole on
 * update; only refresh notes and isActive=true if it was deactivated).
 *
 * Run:
 *   npx ts-node prisma/seed-role-aliases.ts
 *   (or: npm run seed:role-aliases)
 *
 * Requires the RoleAlias migration to be applied first.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AliasSeed {
  alias: string;
  targetRole: string;
  notes: string;
}

// Defaults route everything to 'admin' until you have finer-grained
// subAdminType values populated. Operators tune via the /settings/role-aliases
// page without code changes.
const SEEDS: AliasSeed[] = [
  // Phase 9.26 quality module
  { alias: 'Quality Manager',          targetRole: 'admin', notes: 'QI RCA + trend breaches, data-quality misses' },
  { alias: 'Nursing Head',             targetRole: 'admin', notes: 'Nursing-led indicators (falls, pressure ulcers, hand hygiene)' },
  { alias: 'Medical Superintendent / Nursing Head', targetRole: 'admin', notes: 'PSQ-001 escalation' },
  { alias: 'Pharmacy Head',            targetRole: 'admin', notes: 'Pharmacy-led indicators (medication errors, stock-outs)' },
  { alias: 'Lab Head / Quality Manager',     targetRole: 'admin', notes: 'Lab indicators' },
  { alias: 'Radiology Head / Quality Manager', targetRole: 'admin', notes: 'Radiology indicators' },
  { alias: 'Infection Control Officer', targetRole: 'admin', notes: 'HAI / SSI / VAP / CAUTI / CLABSI' },
  { alias: 'HR Head',                  targetRole: 'admin', notes: 'HR training compliance' },
  { alias: 'Facility Manager',         targetRole: 'admin', notes: 'FMS utility / equipment / drills' },
  { alias: 'Patient Experience Manager', targetRole: 'admin', notes: 'OPD/IPD satisfaction, complaints' },
  { alias: 'Grievance Officer',        targetRole: 'admin', notes: 'Complaint workflow + rate' },
  { alias: 'Hospital Safety Committee', targetRole: 'admin', notes: 'Sentinel events' },

  // Phase 6 module follow-ups
  { alias: 'patient_experience',       targetRole: 'admin', notes: 'Feedback reminder bell (6d)' },
  { alias: 'grievance_officer',        targetRole: 'admin', notes: 'Complaint SLA fallback when unassigned (6a)' },

  // Existing incident module
  { alias: 'admin',                    targetRole: 'admin', notes: 'Incident triage default — already matches enum' },
];

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const s of SEEDS) {
    const existing = await prisma.roleAlias.findUnique({ where: { alias: s.alias }, select: { id: true } });
    await prisma.roleAlias.upsert({
      where: { alias: s.alias },
      create: { alias: s.alias, targetRole: s.targetRole, notes: s.notes, isActive: true },
      update: {
        // Refresh notes but NEVER overwrite targetRole — admin edits win.
        notes: s.notes,
      },
    });
    if (existing) updated += 1; else created += 1;
    console.log(`  ${existing ? '~' : '+'} ${s.alias.padEnd(50)} → ${s.targetRole}`);
  }
  console.log(`\nRoleAlias seed complete — ${created} created, ${updated} updated.`);
  console.log(`Edit any of these via the /settings/role-aliases admin page.`);
}

main()
  .catch((e) => { console.error('RoleAlias seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
