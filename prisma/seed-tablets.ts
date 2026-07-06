/**
 * TabletMaster — seed the drug/tablet master catalogue.
 *
 * Run with:
 *   npx ts-node prisma/seed-tablets.ts
 *   (or: npm run seed:tablets)
 *
 * Idempotent — dedupes on brandName (the same natural key the create-tablet
 * API uses: prescription.controller.ts findFirst({ where: { brandName } })).
 * Re-running skips tablets that already exist and only inserts new ones, so
 * the existing "Dolo" row (and anything added via the UI) is left untouched.
 *
 * pregnancyCategory (FDA letter A|B|C|D|X) and lactationSafety
 * (safe|caution|contraindicated) feed the IPD teratogenic-drug alerts
 * (see src/api/ipd/pregnancy-alerts.ts), so they're populated where the
 * drug's profile is well established.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TabletSeed {
  genericName: string;
  brandName: string;
  type: string;
  description?: string;
  pregnancyCategory?: 'A' | 'B' | 'C' | 'D' | 'X';
  lactationSafety?: 'safe' | 'caution' | 'contraindicated';
}

// Common Indian-hospital formulary tablets. `type` is "Tablet" for all here.
const TABLETS: TabletSeed[] = [
  { genericName: 'Paracetamol 650mg', brandName: 'Dolo 650', type: 'Tablet', description: 'Antipyretic / analgesic', pregnancyCategory: 'B', lactationSafety: 'safe' },
  { genericName: 'Paracetamol 500mg', brandName: 'Crocin 500', type: 'Tablet', description: 'Antipyretic / analgesic', pregnancyCategory: 'B', lactationSafety: 'safe' },
  { genericName: 'Amoxicillin + Clavulanic acid 625mg', brandName: 'Augmentin 625 Duo', type: 'Tablet', description: 'Broad-spectrum antibiotic', pregnancyCategory: 'B', lactationSafety: 'safe' },
  { genericName: 'Azithromycin 500mg', brandName: 'Azithral 500', type: 'Tablet', description: 'Macrolide antibiotic', pregnancyCategory: 'B', lactationSafety: 'caution' },
  { genericName: 'Cefixime 200mg', brandName: 'Taxim-O 200', type: 'Tablet', description: 'Cephalosporin antibiotic', pregnancyCategory: 'B', lactationSafety: 'safe' },
  { genericName: 'Ciprofloxacin 500mg', brandName: 'Ciplox 500', type: 'Tablet', description: 'Fluoroquinolone antibiotic', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Metronidazole 400mg', brandName: 'Metrogyl 400', type: 'Tablet', description: 'Antibiotic / antiprotozoal', pregnancyCategory: 'B', lactationSafety: 'caution' },
  { genericName: 'Pantoprazole 40mg', brandName: 'Pan 40', type: 'Tablet', description: 'Proton-pump inhibitor', pregnancyCategory: 'B', lactationSafety: 'caution' },
  { genericName: 'Omeprazole 20mg', brandName: 'Omez 20', type: 'Tablet', description: 'Proton-pump inhibitor', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Aceclofenac + Paracetamol', brandName: 'Zerodol-P', type: 'Tablet', description: 'NSAID + analgesic', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Ibuprofen + Paracetamol', brandName: 'Combiflam', type: 'Tablet', description: 'NSAID + analgesic', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Diclofenac 50mg', brandName: 'Voveran 50', type: 'Tablet', description: 'NSAID', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Cetirizine 10mg', brandName: 'Cetzine 10', type: 'Tablet', description: 'Antihistamine', pregnancyCategory: 'B', lactationSafety: 'caution' },
  { genericName: 'Levocetirizine + Montelukast', brandName: 'Montair-LC', type: 'Tablet', description: 'Antihistamine + leukotriene antagonist', pregnancyCategory: 'B', lactationSafety: 'caution' },
  { genericName: 'Ondansetron 4mg', brandName: 'Ondem 4', type: 'Tablet', description: 'Antiemetic', pregnancyCategory: 'B', lactationSafety: 'safe' },
  { genericName: 'Domperidone 10mg', brandName: 'Domstal 10', type: 'Tablet', description: 'Prokinetic antiemetic', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Metformin 500mg', brandName: 'Glycomet 500', type: 'Tablet', description: 'Biguanide antidiabetic', pregnancyCategory: 'B', lactationSafety: 'safe' },
  { genericName: 'Telmisartan 40mg', brandName: 'Telma 40', type: 'Tablet', description: 'ARB antihypertensive', pregnancyCategory: 'D', lactationSafety: 'caution' },
  { genericName: 'Amlodipine 5mg', brandName: 'Amlong 5', type: 'Tablet', description: 'Calcium-channel blocker', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Atorvastatin 10mg', brandName: 'Atorva 10', type: 'Tablet', description: 'Statin / lipid-lowering', pregnancyCategory: 'X', lactationSafety: 'contraindicated' },
  { genericName: 'Aspirin 75mg', brandName: 'Ecosprin 75', type: 'Tablet', description: 'Antiplatelet', pregnancyCategory: 'D', lactationSafety: 'caution' },
  { genericName: 'Levothyroxine 50mcg', brandName: 'Thyronorm 50', type: 'Tablet', description: 'Thyroid hormone replacement', pregnancyCategory: 'A', lactationSafety: 'safe' },
  { genericName: 'Prednisolone 10mg', brandName: 'Wysolone 10', type: 'Tablet', description: 'Corticosteroid', pregnancyCategory: 'C', lactationSafety: 'caution' },
  { genericName: 'Calcium Carbonate + Vitamin D3', brandName: 'Shelcal 500', type: 'Tablet', description: 'Calcium + vitamin D supplement', pregnancyCategory: 'A', lactationSafety: 'safe' },
  { genericName: 'Folic Acid 5mg', brandName: 'Folvite 5', type: 'Tablet', description: 'Folate supplement', pregnancyCategory: 'A', lactationSafety: 'safe' },
  { genericName: 'Vitamin B-Complex', brandName: 'Becosules', type: 'Tablet', description: 'B-complex + vitamin C supplement', pregnancyCategory: 'A', lactationSafety: 'safe' },
  { genericName: 'Vitamin C 500mg', brandName: 'Limcee 500', type: 'Tablet', description: 'Ascorbic acid supplement', pregnancyCategory: 'A', lactationSafety: 'safe' },
];

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;

  for (const t of TABLETS) {
    const existing = await prisma.tabletMaster.findFirst({
      where: { brandName: t.brandName },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.tabletMaster.create({
      data: {
        genericName: t.genericName,
        brandName: t.brandName,
        type: t.type,
        description: t.description ?? null,
        pregnancyCategory: t.pregnancyCategory ?? null,
        lactationSafety: t.lactationSafety ?? null,
        createdBy: 'seed',
      },
    });
    created++;
    console.log(`  + ${t.brandName} (${t.genericName})`);
  }

  console.log(`\nTabletMaster seed complete — ${created} created, ${skipped} already present.`);
}

main()
  .catch((e) => {
    console.error('Tablet seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
