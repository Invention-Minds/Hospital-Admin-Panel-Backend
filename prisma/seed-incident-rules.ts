/// <reference path="../global.d.ts" />

/**
 * Phase 9.24 / Phase 2 — seed the IncidentRule catalogue.
 *
 * Mirrors the static rule defs from src/api/incident/rule-catalogue.ts so the
 * admin can toggle `isActive=false` on a row to silence a rule at runtime.
 *
 * Idempotent — upserts by `key`. Re-running is safe.
 *
 * Run:
 *   npx ts-node prisma/seed-incident-rules.ts
 *   (or: npm run seed:incident-rules)
 *
 * Requires the `phase_9_24_incident_module` migration to be applied first.
 */

import { PrismaClient } from '@prisma/client';
import { RULE_CATALOGUE } from '../src/api/incident/rule-catalogue';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const def of Object.values(RULE_CATALOGUE)) {
    const existing = await prisma.incidentRule.findUnique({ where: { key: def.key }, select: { id: true } });
    await prisma.incidentRule.upsert({
      where: { key: def.key },
      create: {
        key: def.key, name: def.name, description: def.description,
        category: def.category, defaultSeverity: def.defaultSeverity,
        nabhClause: def.nabhClause, thresholdMinutes: def.thresholdMinutes ?? null,
        isActive: true,
      },
      update: {
        // Refresh metadata but DON'T touch isActive (preserve admin override).
        name: def.name, description: def.description,
        category: def.category, defaultSeverity: def.defaultSeverity,
        nabhClause: def.nabhClause, thresholdMinutes: def.thresholdMinutes ?? null,
      },
    });
    if (existing) updated += 1; else created += 1;
    console.log(`  ${existing ? '~' : '+'} ${def.key} (${def.defaultSeverity}, ${def.nabhClause})`);
  }
  console.log(`\nIncidentRule seed complete — ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => { console.error('IncidentRule seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
