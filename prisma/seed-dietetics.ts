/**
 * Dietetics — seed the starter masters the module needs before any meal
 * order can be generated or any drug-food warning can fire:
 *   • MealTimeSlot        — breakfast / lunch / snacks / dinner
 *   • AllergenMaster      — common food allergens
 *   • DietMaster          — standard hospital diets (macros left blank for
 *                           the hospital dietician to fill in)
 *   • DrugFoodInteraction — built-in catalogue (no admin UI; edit in DB)
 *
 * NOT seeded: MealMaster items and the weekly MenuPlan. Those are
 * hospital-specific — set them up in Dietetics → Setup. Until each diet has a
 * menu, the generator creates no meal orders for patients on it.
 *
 * Create-only, never updates:
 *   • slots + diets are inserted only when the table is empty
 *   • allergens (by name) and interactions (by `match`) add just the missing rows
 *
 * The drug-food guidance is a generic starter set — have the hospital
 * pharmacist / dietician review it before go-live.
 *
 * Run:
 *   npx ts-node prisma/seed-dietetics.ts
 *   (or: npm run seed:dietetics)
 *
 * Requires the `dietetics` migration to be applied first.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SLOTS = [
  { name: 'Breakfast', code: 'breakfast', startTime: '07:30', endTime: '09:00', sequence: 1 },
  { name: 'Lunch', code: 'lunch', startTime: '12:30', endTime: '14:00', sequence: 2 },
  { name: 'Evening snacks', code: 'snacks', startTime: '16:30', endTime: '17:30', sequence: 3 },
  { name: 'Dinner', code: 'dinner', startTime: '19:30', endTime: '21:00', sequence: 4 },
];

const ALLERGENS = [
  'Milk', 'Egg', 'Peanut', 'Tree nuts', 'Soy', 'Wheat / Gluten',
  'Fish', 'Shellfish', 'Sesame', 'Mustard',
];

// `general` is the code COP.7.b treats as non-therapeutic — keep it.
const DIETS: Array<{
  name: string; code: string; description: string;
  restrictions: string[]; targetConditions: string[];
}> = [
  {
    name: 'General diet', code: 'general',
    description: 'Normal balanced hospital diet.',
    restrictions: [], targetConditions: [],
  },
  {
    name: 'Soft diet', code: 'soft',
    description: 'Soft, easy-to-chew foods; no hard, fried or fibrous items.',
    restrictions: ['Soft'], targetConditions: ['Post-operative', 'Dental / chewing difficulty'],
  },
  {
    name: 'Clear liquid diet', code: 'clear-liquid',
    description: 'Clear fluids only (water, strained juice, clear soup, ORS).',
    restrictions: ['Liquid'], targetConditions: ['Pre / post procedure', 'Bowel preparation'],
  },
  {
    name: 'Full liquid diet', code: 'full-liquid',
    description: 'All fluids including milk-based drinks, soups and porridge.',
    restrictions: ['Liquid'], targetConditions: ['Post-operative progression', 'Swallowing difficulty'],
  },
  {
    name: 'Diabetic diet', code: 'diabetic',
    description: 'Controlled carbohydrate, no added sugar, high fibre.',
    restrictions: ['No added sugar'], targetConditions: ['Diabetes'],
  },
  {
    name: 'Renal diet', code: 'renal',
    description: 'Restricted sodium, potassium, phosphorus and fluid as prescribed.',
    restrictions: ['Low salt', 'Low potassium', 'Fluid restricted'], targetConditions: ['Chronic kidney disease', 'Dialysis'],
  },
  {
    name: 'Cardiac diet', code: 'cardiac',
    description: 'Low salt, low saturated fat.',
    restrictions: ['Low salt', 'Low fat'], targetConditions: ['Hypertension', 'Cardiac disease'],
  },
  {
    name: 'High-protein diet', code: 'high-protein',
    description: 'Increased protein and energy for recovery.',
    restrictions: [], targetConditions: ['Burns', 'Malnutrition', 'Post-operative recovery'],
  },
];

// `match` is a case-insensitive substring of the prescription's generic or
// brand name (see getInteractionsForAdmission).
const INTERACTIONS: Array<{ match: string; severity: 'info' | 'warning' | 'critical'; foodGuidance: string }> = [
  { match: 'warfarin', severity: 'warning', foodGuidance: 'Keep vitamin K intake (green leafy vegetables) consistent day to day. Avoid alcohol and cranberry juice.' },
  { match: 'acenocoumarol', severity: 'warning', foodGuidance: 'Keep vitamin K intake (green leafy vegetables) consistent day to day. Avoid alcohol.' },
  { match: 'phenelzine', severity: 'critical', foodGuidance: 'Strictly avoid tyramine-rich foods: aged cheese, cured / fermented meat, soy sauce, yeast extracts, overripe fruit.' },
  { match: 'tranylcypromine', severity: 'critical', foodGuidance: 'Strictly avoid tyramine-rich foods: aged cheese, cured / fermented meat, soy sauce, yeast extracts, overripe fruit.' },
  { match: 'linezolid', severity: 'warning', foodGuidance: 'Avoid large amounts of tyramine-rich foods (aged cheese, fermented / cured meat, soy sauce).' },
  { match: 'isoniazid', severity: 'info', foodGuidance: 'Avoid tyramine- and histamine-rich foods (aged cheese, tuna, mackerel) — may cause flushing / headache. Best taken on an empty stomach.' },
  { match: 'ciprofloxacin', severity: 'warning', foodGuidance: 'Do not give with milk, curd or calcium / iron supplements — separate by at least 2 hours.' },
  { match: 'norfloxacin', severity: 'warning', foodGuidance: 'Do not give with milk, curd or calcium / iron supplements — separate by at least 2 hours.' },
  { match: 'doxycycline', severity: 'warning', foodGuidance: 'Separate from milk, dairy, antacids and iron by at least 2 hours.' },
  { match: 'tetracycline', severity: 'warning', foodGuidance: 'Give on an empty stomach; separate from milk, dairy and iron by at least 2 hours.' },
  { match: 'levothyroxine', severity: 'info', foodGuidance: 'Give on an empty stomach 30–60 min before breakfast. Separate from calcium, iron, soy and high-fibre food.' },
  { match: 'thyroxine', severity: 'info', foodGuidance: 'Give on an empty stomach 30–60 min before breakfast. Separate from calcium, iron, soy and high-fibre food.' },
  { match: 'alendronate', severity: 'info', foodGuidance: 'Give with plain water only on an empty stomach; no food or drink for 30 min; patient stays upright.' },
  { match: 'spironolactone', severity: 'warning', foodGuidance: 'Avoid potassium-rich foods in excess (banana, coconut water, tomato) and potassium salt substitutes.' },
  { match: 'eplerenone', severity: 'warning', foodGuidance: 'Avoid potassium-rich foods in excess and potassium salt substitutes.' },
  { match: 'simvastatin', severity: 'warning', foodGuidance: 'Avoid grapefruit and grapefruit juice.' },
  { match: 'atorvastatin', severity: 'info', foodGuidance: 'Avoid large amounts of grapefruit juice.' },
  { match: 'tacrolimus', severity: 'warning', foodGuidance: 'Avoid grapefruit / pomelo. Give consistently with respect to meals.' },
  { match: 'ciclosporin', severity: 'warning', foodGuidance: 'Avoid grapefruit / pomelo and potassium-rich foods in excess.' },
  { match: 'cyclosporin', severity: 'warning', foodGuidance: 'Avoid grapefruit / pomelo and potassium-rich foods in excess.' },
  { match: 'metronidazole', severity: 'warning', foodGuidance: 'No alcohol (including alcohol-containing tonics) during and for 48 h after the course.' },
  { match: 'lithium', severity: 'warning', foodGuidance: 'Keep salt and fluid intake consistent; avoid sudden low-salt diets or dehydration.' },
  { match: 'ferrous', severity: 'info', foodGuidance: 'Separate from tea, coffee, milk and calcium by 2 hours; vitamin C (citrus) improves absorption.' },
  { match: 'metformin', severity: 'info', foodGuidance: 'Give with or just after meals.' },
];

async function main(): Promise<void> {
  const counts: Record<string, { created: number; skipped: number }> = {};
  const bump = (entity: string, kind: 'created' | 'skipped'): void => {
    counts[entity] ??= { created: 0, skipped: 0 };
    counts[entity][kind] += 1;
  };

  // Slots and diets are a starter set only: if the hospital has already
  // configured any, matching by name/code would miss near-duplicates
  // ("Evening snack" vs "Evening snacks") and add a second slot at the same time.
  if (await prisma.mealTimeSlot.count() === 0) {
    for (const s of SLOTS) {
      await prisma.mealTimeSlot.create({ data: { ...s, isActive: true } });
      bump('MealTimeSlot', 'created');
    }
  } else {
    console.log('MealTimeSlot: already configured — skipped');
  }

  for (const name of ALLERGENS) {
    const existing = await prisma.allergenMaster.findUnique({ where: { name }, select: { id: true } });
    if (existing) { bump('AllergenMaster', 'skipped'); continue; }
    await prisma.allergenMaster.create({ data: { name, isActive: true } });
    bump('AllergenMaster', 'created');
  }

  const hasDiets = (await prisma.dietMaster.count()) > 0;
  if (hasDiets) console.log('DietMaster: already configured — skipped');
  for (const d of hasDiets ? [] : DIETS) {
    await prisma.dietMaster.create({
      data: {
        name: d.name,
        code: d.code,
        description: d.description,
        restrictions: JSON.stringify(d.restrictions),
        targetConditions: JSON.stringify(d.targetConditions),
        isGeneral: d.code === 'general',
        isActive: true,
        createdBy: 'seed-dietetics',
      },
    });
    bump('DietMaster', 'created');
  }

  for (const i of INTERACTIONS) {
    const existing = await prisma.drugFoodInteraction.findFirst({ where: { match: i.match }, select: { id: true } });
    if (existing) { bump('DrugFoodInteraction', 'skipped'); continue; }
    await prisma.drugFoodInteraction.create({ data: { ...i, isActive: true } });
    bump('DrugFoodInteraction', 'created');
  }

  for (const [entity, c] of Object.entries(counts)) {
    console.log(`${entity}: created ${c.created}, skipped ${c.skipped}`);
  }
  console.log('Next: add meal items + a weekly menu per diet in Dietetics → Setup.');
}

main()
  .catch((e) => { console.error('Dietetics seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
