/// <reference path="../global.d.ts" />

/**
 * Phase 9.26 / Phase 1 — seed the QualityIndicator catalogue.
 *
 * Mirrors `src/api/quality/quality-indicator-catalogue.ts` (108 NABH/QCI
 * indicators) into the QualityIndicator table so an admin can disable a row,
 * override a benchmark, or change the amber band at runtime.
 *
 * Idempotent — upserts by `qiCode`. Preserves admin overrides on update:
 *   - `isActive`, `defaultBenchmark`, `amberThresholdPct`, `escalationOwner`,
 *     and `notes` are NEVER overwritten once set differently from catalogue.
 *
 * Run:
 *   npx ts-node prisma/seed-quality-indicators.ts
 *   (or add an npm script: "seed:quality-indicators": "ts-node prisma/seed-quality-indicators.ts")
 *
 * Requires the QualityIndicator migration to be applied first.
 */

import { PrismaClient } from '@prisma/client';
import { QI_CATALOGUE } from '../src/api/quality/quality-indicator-catalogue';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;

  for (const def of QI_CATALOGUE) {
    const existing = await prisma.qualityIndicator.findUnique({
      where: { qiCode: def.qiCode },
      select: { id: true },
    });

    await prisma.qualityIndicator.upsert({
      where: { qiCode: def.qiCode },
      create: {
        qiCode: def.qiCode,
        chapter: def.chapter,
        nabhRef: def.nabhRef,
        department: def.department,
        name: def.name,
        indicatorType: def.indicatorType,
        numeratorDef: def.numeratorDef,
        denominatorDef: def.denominatorDef,
        multiplier: def.multiplier,
        unit: def.unit,
        frequency: def.frequency,
        direction: def.direction,
        defaultBenchmark: def.defaultBenchmark,
        amberThresholdPct: 80,
        isCritical: def.isCritical,
        criticalRule: def.criticalRule ?? null,
        dataCaptureFields: def.dataCaptureFields ?? null,
        escalationOwner: def.escalationOwner,
        rcaRequiredRule: def.rcaRequiredRule,
        nabhClause: def.nabhClause ?? null,
        sourceUrl: def.sourceUrl ?? null,
        isActive: true,
      },
      update: {
        // Refresh catalogue-derived descriptive fields only.
        // Don't touch isActive / defaultBenchmark / amberThresholdPct /
        // escalationOwner / notes — those are admin-controlled.
        chapter: def.chapter,
        nabhRef: def.nabhRef,
        department: def.department,
        name: def.name,
        indicatorType: def.indicatorType,
        numeratorDef: def.numeratorDef,
        denominatorDef: def.denominatorDef,
        multiplier: def.multiplier,
        unit: def.unit,
        frequency: def.frequency,
        direction: def.direction,
        isCritical: def.isCritical,
        criticalRule: def.criticalRule ?? null,
        dataCaptureFields: def.dataCaptureFields ?? null,
        rcaRequiredRule: def.rcaRequiredRule,
        nabhClause: def.nabhClause ?? null,
        sourceUrl: def.sourceUrl ?? null,
      },
    });

    if (existing) {
      updated += 1;
    } else {
      created += 1;
      const benchStr = def.defaultBenchmark === null ? 'hospital-defined' : String(def.defaultBenchmark);
      console.log(`  + ${def.qiCode.padEnd(8)} ${def.chapter.padEnd(4)} ${def.name.slice(0, 60)} [bench=${benchStr}]`);
    }
  }

  console.log(`\nQualityIndicator seed complete — ${created} created, ${updated} updated.`);
  console.log(`Catalogue total: ${QI_CATALOGUE.length}`);
}

main()
  .catch((e) => { console.error('QualityIndicator seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
