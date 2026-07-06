/**
 * Dietetics — seed initial catalogue.
 *
 * Run with:
 *   npx ts-node prisma/seed-dietetics.ts
 *
 * Idempotent — uses upsert on each table's natural key. Re-running it after
 * editing this file updates rows in place; nothing is duplicated.
 *
 * What this populates (enough for the nightly MealOrder cron to start
 * producing rows out-of-the-box):
 *   • 5 meal-time slots
 *   • 12 allergens
 *   • 10 diets (general + therapeutic + texture-modified)
 *   • ~30 meal items, joined to compatible diets and known allergens
 *   • Full 7-day × 4-slot menu for General and Diabetic-1800 diets
 *   • Lunch+dinner only for Soft and Full-liquid (kitchen serves the same
 *     items every day for these — fewer rotations)
 *   • 10 drug-food interaction patterns
 *   • 1 default canteen TV channel
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Meal time slots ────────────────────────────────────────────────
const SLOTS = [
  { name: 'Early breakfast', code: 'EARLY',  startTime: '06:00', endTime: '07:00', sequence: 1 },
  { name: 'Breakfast',       code: 'BFAST',  startTime: '08:00', endTime: '09:30', sequence: 2 },
  { name: 'Lunch',           code: 'LUNCH',  startTime: '12:30', endTime: '14:00', sequence: 3 },
  { name: 'Evening snack',   code: 'SNACK',  startTime: '16:30', endTime: '17:30', sequence: 4 },
  { name: 'Dinner',          code: 'DINNER', startTime: '19:30', endTime: '21:00', sequence: 5 },
];

// ─── Allergens ──────────────────────────────────────────────────────
const ALLERGENS = [
  'Peanut', 'Tree nut', 'Milk / Dairy', 'Egg', 'Wheat / Gluten',
  'Soy', 'Fish', 'Shellfish', 'Sesame', 'Mustard', 'Sulphites', 'Lactose',
];

// ─── Diets ──────────────────────────────────────────────────────────
interface DietSeed {
  code: string; name: string; description: string;
  caloriesKcal?: number; proteinG?: number; carbsG?: number; fatG?: number;
  sodiumMg?: number; potassiumMg?: number; fluidMl?: number;
  restrictions?: string; targetConditions?: string;
  isVeg?: boolean; isJain?: boolean; isHalal?: boolean; isKosher?: boolean; isNoOnionGarlic?: boolean;
}

const DIETS: DietSeed[] = [
  {
    code: 'GEN', name: 'General diet',
    description: 'Regular Indian hospital diet — no specific restriction.',
    caloriesKcal: 2000, proteinG: 60, carbsG: 280, fatG: 65,
    isVeg: true,
  },
  {
    code: 'DM-1800', name: 'Diabetic 1800 kcal',
    description: 'Calorie-controlled, low-glycaemic-index, split across 5 meals.',
    caloriesKcal: 1800, proteinG: 80, carbsG: 220, fatG: 55, sodiumMg: 2300,
    restrictions: 'No added sugar; limit fruit juice; whole grains preferred',
    targetConditions: 'Type 2 diabetes, prediabetes',
    isVeg: true,
  },
  {
    code: 'DM-1500', name: 'Diabetic 1500 kcal',
    description: 'Calorie-controlled for overweight diabetic patients.',
    caloriesKcal: 1500, proteinG: 75, carbsG: 180, fatG: 45, sodiumMg: 2300,
    restrictions: 'No added sugar; portion-controlled rice/roti',
    targetConditions: 'Type 2 diabetes with BMI > 25',
    isVeg: true,
  },
  {
    code: 'CKD-LP', name: 'Renal / low protein',
    description: 'For non-dialysis CKD — restricted protein, potassium, phosphate.',
    caloriesKcal: 2000, proteinG: 40, carbsG: 300, fatG: 70,
    sodiumMg: 2000, potassiumMg: 2000, fluidMl: 1500,
    restrictions: 'Avoid: bananas, oranges, leafy greens, dairy. Low-protein roti.',
    targetConditions: 'CKD stage 3-4 (pre-dialysis)',
    isVeg: true,
  },
  {
    code: 'HTN-NS', name: 'Hypertension / no added salt',
    description: 'DASH-style; sodium < 2g/day; potassium-rich.',
    caloriesKcal: 2000, proteinG: 75, carbsG: 270, fatG: 60, sodiumMg: 2000,
    restrictions: 'No added salt; no pickles; no papad; no processed foods',
    targetConditions: 'Essential hypertension, CHF',
    isVeg: true,
  },
  {
    code: 'CARD', name: 'Cardiac / low fat',
    description: 'Low saturated fat, low cholesterol, low sodium.',
    caloriesKcal: 1800, proteinG: 70, carbsG: 250, fatG: 40, sodiumMg: 2000,
    restrictions: 'No ghee/butter; lean protein only; no fried items',
    targetConditions: 'IHD, post-MI, hyperlipidaemia',
    isVeg: true,
  },
  {
    code: 'SOFT', name: 'Soft diet',
    description: 'Easy-to-chew, easy-to-digest for post-op / dental / dysphagia.',
    caloriesKcal: 1800, proteinG: 60, carbsG: 240, fatG: 55,
    restrictions: 'No raw vegetables; no nuts; no hard crusts; well-cooked only',
    targetConditions: 'Post-surgical, dental, mild dysphagia',
    isVeg: true,
  },
  {
    code: 'LIQ-CLR', name: 'Clear liquids',
    description: 'Day 1 post-op or bowel prep — see-through fluids only.',
    caloriesKcal: 600, fluidMl: 2000,
    restrictions: 'Clear soups, electrolytes, weak tea, water, clear juices only',
    targetConditions: 'Immediate post-op, pre-colonoscopy, gastroenteritis',
    isVeg: true,
  },
  {
    code: 'LIQ-FULL', name: 'Full liquids',
    description: 'All liquids including milk-based — step-up from clear liquids.',
    caloriesKcal: 1200, proteinG: 40, fluidMl: 2000,
    restrictions: 'No solids; milk, lassi, dal water, smooth soups, porridge slurry',
    targetConditions: 'Day 2-3 post-op, severe sore throat, dysphagia',
    isVeg: true,
  },
  {
    code: 'PAED', name: 'Paediatric general',
    description: 'Age-appropriate portions, no choking hazards.',
    caloriesKcal: 1400, proteinG: 35, carbsG: 200, fatG: 45,
    restrictions: 'No whole nuts, no popcorn, no hard candy',
    targetConditions: 'Children 2-12 years',
    isVeg: true,
  },
  {
    code: 'GER', name: 'Geriatric soft',
    description: 'Easy-to-chew, calorie-adequate for elderly patients.',
    caloriesKcal: 1600, proteinG: 60, carbsG: 220, fatG: 50,
    restrictions: 'Soft textures, easy to digest, mild seasoning',
    targetConditions: 'Patients > 70 years, age-related dysphagia or dentition issues',
    isVeg: true,
  },
];

// ─── Meals ──────────────────────────────────────────────────────────
interface MealSeed {
  name: string; description?: string; category: string; caloriesKcal?: number;
  isVeg?: boolean;
  compatibleDietCodes: string[];
  allergenNames: string[];
}

const MEALS: MealSeed[] = [
  // Breakfast options
  { name: 'Idli (3 pcs) + sambar + chutney', category: 'Main', caloriesKcal: 250,
    compatibleDietCodes: ['GEN', 'DM-1800', 'DM-1500', 'HTN-NS', 'CARD', 'PAED'],
    allergenNames: [] },
  { name: 'Masala dosa + chutney', category: 'Main', caloriesKcal: 400,
    compatibleDietCodes: ['GEN', 'PAED'],
    allergenNames: [] },
  { name: 'Plain dosa + sambar', category: 'Main', caloriesKcal: 300,
    compatibleDietCodes: ['GEN', 'DM-1800', 'HTN-NS', 'CARD', 'PAED'],
    allergenNames: [] },
  { name: 'Oats porridge (low salt)', category: 'Main', caloriesKcal: 200,
    compatibleDietCodes: ['GEN', 'DM-1800', 'DM-1500', 'HTN-NS', 'CARD', 'SOFT', 'PAED', 'CKD-LP'],
    allergenNames: ['Milk / Dairy', 'Lactose'] },
  { name: 'Wheat upma', category: 'Main', caloriesKcal: 280,
    compatibleDietCodes: ['GEN', 'DM-1800', 'HTN-NS', 'PAED'],
    allergenNames: ['Wheat / Gluten'] },
  { name: 'Vegetable poha', category: 'Main', caloriesKcal: 260,
    compatibleDietCodes: ['GEN', 'DM-1800', 'DM-1500', 'HTN-NS', 'CARD', 'PAED'],
    allergenNames: ['Peanut'] },
  { name: 'Paratha (2) + curd', category: 'Main', caloriesKcal: 450,
    compatibleDietCodes: ['GEN', 'PAED'],
    allergenNames: ['Wheat / Gluten', 'Milk / Dairy', 'Lactose'] },
  { name: 'Ragi malt (sugar-free)', category: 'Beverage', caloriesKcal: 180,
    compatibleDietCodes: ['DM-1800', 'DM-1500', 'GER', 'PAED', 'SOFT', 'LIQ-FULL'],
    allergenNames: ['Milk / Dairy', 'Lactose'] },

  // Lunch / dinner — mains
  { name: 'Chapati (2) + dal + sabzi', category: 'Main', caloriesKcal: 500,
    compatibleDietCodes: ['GEN', 'DM-1800', 'HTN-NS', 'CARD', 'PAED'],
    allergenNames: ['Wheat / Gluten'] },
  { name: 'Steamed rice + dal + sabzi', category: 'Main', caloriesKcal: 480,
    compatibleDietCodes: ['GEN', 'DM-1800', 'CKD-LP', 'HTN-NS', 'CARD', 'PAED'],
    allergenNames: [] },
  { name: 'Curd rice', category: 'Main', caloriesKcal: 350,
    compatibleDietCodes: ['GEN', 'SOFT', 'GER', 'PAED'],
    allergenNames: ['Milk / Dairy', 'Lactose'] },
  { name: 'Khichdi (moong dal)', category: 'Main', caloriesKcal: 380,
    compatibleDietCodes: ['GEN', 'DM-1800', 'HTN-NS', 'CARD', 'SOFT', 'GER', 'PAED'],
    allergenNames: [] },
  { name: 'Vegetable pulao', category: 'Main', caloriesKcal: 520,
    compatibleDietCodes: ['GEN', 'PAED'],
    allergenNames: ['Milk / Dairy'] },
  { name: 'Sambar rice', category: 'Main', caloriesKcal: 420,
    compatibleDietCodes: ['GEN', 'HTN-NS', 'PAED'],
    allergenNames: [] },
  { name: 'Low-protein roti (2) + dal water + sabzi', category: 'Main', caloriesKcal: 380,
    compatibleDietCodes: ['CKD-LP'],
    allergenNames: ['Wheat / Gluten'] },

  // Soups / liquids
  { name: 'Clear vegetable soup', category: 'Soup', caloriesKcal: 80,
    compatibleDietCodes: ['LIQ-CLR', 'LIQ-FULL', 'SOFT', 'GEN', 'DM-1800', 'HTN-NS', 'CARD'],
    allergenNames: [] },
  { name: 'Tomato soup (cream of)', category: 'Soup', caloriesKcal: 150,
    compatibleDietCodes: ['LIQ-FULL', 'SOFT', 'GEN', 'PAED'],
    allergenNames: ['Milk / Dairy', 'Lactose'] },
  { name: 'Dal water (clear)', category: 'Soup', caloriesKcal: 60,
    compatibleDietCodes: ['LIQ-CLR', 'LIQ-FULL', 'SOFT', 'CKD-LP'],
    allergenNames: [] },
  { name: 'Lassi (sweet)', category: 'Beverage', caloriesKcal: 180,
    compatibleDietCodes: ['LIQ-FULL', 'GEN', 'PAED'],
    allergenNames: ['Milk / Dairy', 'Lactose'] },
  { name: 'Buttermilk (salted)', category: 'Beverage', caloriesKcal: 60,
    compatibleDietCodes: ['LIQ-FULL', 'GEN', 'DM-1800', 'PAED'],
    allergenNames: ['Milk / Dairy', 'Lactose'] },
  { name: 'Electrolyte drink (ORS)', category: 'Beverage', caloriesKcal: 80,
    compatibleDietCodes: ['LIQ-CLR', 'LIQ-FULL', 'SOFT', 'GEN', 'PAED'],
    allergenNames: [] },
  { name: 'Weak tea (no sugar)', category: 'Beverage', caloriesKcal: 20,
    compatibleDietCodes: ['LIQ-CLR', 'LIQ-FULL', 'DM-1800', 'GEN', 'HTN-NS', 'CARD'],
    allergenNames: [] },
  { name: 'Apple juice (clear)', category: 'Beverage', caloriesKcal: 110,
    compatibleDietCodes: ['LIQ-CLR', 'LIQ-FULL', 'GEN', 'PAED'],
    allergenNames: [] },

  // Snacks / sides
  { name: 'Fruit bowl (apple/papaya/banana)', category: 'Side', caloriesKcal: 120,
    compatibleDietCodes: ['GEN', 'DM-1800', 'HTN-NS', 'CARD', 'PAED', 'GER'],
    allergenNames: [] },
  { name: 'Sprouts salad', category: 'Side', caloriesKcal: 130,
    compatibleDietCodes: ['GEN', 'DM-1800', 'DM-1500', 'HTN-NS', 'CARD'],
    allergenNames: [] },
  { name: 'Biscuits (cream-cracker, 4)', category: 'Snack', caloriesKcal: 160,
    compatibleDietCodes: ['GEN', 'GER', 'PAED'],
    allergenNames: ['Wheat / Gluten', 'Milk / Dairy'] },
  { name: 'Roasted chana (50g)', category: 'Snack', caloriesKcal: 180,
    compatibleDietCodes: ['GEN', 'DM-1800', 'DM-1500', 'HTN-NS', 'CARD'],
    allergenNames: [] },
  { name: 'Boiled egg (1) + toast', category: 'Side', caloriesKcal: 220,
    compatibleDietCodes: ['GEN', 'CARD', 'PAED'],
    allergenNames: ['Egg', 'Wheat / Gluten'] },
  { name: 'Paneer bhurji + roti', category: 'Main', caloriesKcal: 420,
    compatibleDietCodes: ['GEN', 'DM-1800', 'CARD'],
    allergenNames: ['Milk / Dairy', 'Wheat / Gluten'] },
  { name: 'Sugar-free kheer', category: 'Dessert', caloriesKcal: 150,
    compatibleDietCodes: ['DM-1800', 'GEN', 'PAED', 'GER'],
    allergenNames: ['Milk / Dairy', 'Lactose', 'Tree nut'] },
];

// ─── Menu plans ─────────────────────────────────────────────────────
// dayOfWeek: 0 = Sunday … 6 = Saturday
// For each diet × slot × day, name the meal to use.
// Slot codes referenced: BFAST, LUNCH, SNACK, DINNER (EARLY only for LIQ-CLR).

interface MenuEntry {
  dietCode: string; slotCode: string; dayOfWeek: number; mealName: string;
}

function makeWeeklyMenu(dietCode: string, slotCode: string, mealsByDay: string[]): MenuEntry[] {
  return mealsByDay.map((mealName, dayOfWeek) => ({ dietCode, slotCode, dayOfWeek, mealName }));
}

const MENU_ENTRIES: MenuEntry[] = [
  // GENERAL DIET — full week × 4 slots
  ...makeWeeklyMenu('GEN', 'BFAST', [
    'Idli (3 pcs) + sambar + chutney', 'Wheat upma', 'Plain dosa + sambar',
    'Vegetable poha', 'Paratha (2) + curd', 'Masala dosa + chutney', 'Oats porridge (low salt)',
  ]),
  ...makeWeeklyMenu('GEN', 'LUNCH', [
    'Chapati (2) + dal + sabzi', 'Steamed rice + dal + sabzi', 'Vegetable pulao',
    'Sambar rice', 'Chapati (2) + dal + sabzi', 'Khichdi (moong dal)', 'Steamed rice + dal + sabzi',
  ]),
  ...makeWeeklyMenu('GEN', 'SNACK', [
    'Fruit bowl (apple/papaya/banana)', 'Biscuits (cream-cracker, 4)', 'Buttermilk (salted)',
    'Roasted chana (50g)', 'Fruit bowl (apple/papaya/banana)', 'Biscuits (cream-cracker, 4)', 'Buttermilk (salted)',
  ]),
  ...makeWeeklyMenu('GEN', 'DINNER', [
    'Chapati (2) + dal + sabzi', 'Khichdi (moong dal)', 'Steamed rice + dal + sabzi',
    'Chapati (2) + dal + sabzi', 'Curd rice', 'Steamed rice + dal + sabzi', 'Khichdi (moong dal)',
  ]),

  // DIABETIC 1800 — same structure, sugar-free options
  ...makeWeeklyMenu('DM-1800', 'BFAST', [
    'Idli (3 pcs) + sambar + chutney', 'Wheat upma', 'Plain dosa + sambar',
    'Vegetable poha', 'Oats porridge (low salt)', 'Wheat upma', 'Oats porridge (low salt)',
  ]),
  ...makeWeeklyMenu('DM-1800', 'LUNCH', [
    'Chapati (2) + dal + sabzi', 'Steamed rice + dal + sabzi', 'Khichdi (moong dal)',
    'Chapati (2) + dal + sabzi', 'Steamed rice + dal + sabzi', 'Khichdi (moong dal)', 'Chapati (2) + dal + sabzi',
  ]),
  ...makeWeeklyMenu('DM-1800', 'SNACK', [
    'Sprouts salad', 'Roasted chana (50g)', 'Buttermilk (salted)',
    'Fruit bowl (apple/papaya/banana)', 'Sprouts salad', 'Roasted chana (50g)', 'Buttermilk (salted)',
  ]),
  ...makeWeeklyMenu('DM-1800', 'DINNER', [
    'Chapati (2) + dal + sabzi', 'Khichdi (moong dal)', 'Chapati (2) + dal + sabzi',
    'Khichdi (moong dal)', 'Chapati (2) + dal + sabzi', 'Khichdi (moong dal)', 'Chapati (2) + dal + sabzi',
  ]),

  // SOFT DIET — same easy items every day (kitchen doesn't rotate)
  ...makeWeeklyMenu('SOFT', 'BFAST', new Array(7).fill('Oats porridge (low salt)')),
  ...makeWeeklyMenu('SOFT', 'LUNCH', new Array(7).fill('Khichdi (moong dal)')),
  ...makeWeeklyMenu('SOFT', 'SNACK', new Array(7).fill('Tomato soup (cream of)')),
  ...makeWeeklyMenu('SOFT', 'DINNER', new Array(7).fill('Curd rice')),

  // FULL LIQUIDS — every day same minimal rotation
  ...makeWeeklyMenu('LIQ-FULL', 'EARLY', new Array(7).fill('Weak tea (no sugar)')),
  ...makeWeeklyMenu('LIQ-FULL', 'BFAST', new Array(7).fill('Ragi malt (sugar-free)')),
  ...makeWeeklyMenu('LIQ-FULL', 'LUNCH', new Array(7).fill('Tomato soup (cream of)')),
  ...makeWeeklyMenu('LIQ-FULL', 'SNACK', new Array(7).fill('Buttermilk (salted)')),
  ...makeWeeklyMenu('LIQ-FULL', 'DINNER', new Array(7).fill('Dal water (clear)')),

  // CLEAR LIQUIDS — minimal, on-demand
  ...makeWeeklyMenu('LIQ-CLR', 'EARLY',  new Array(7).fill('Weak tea (no sugar)')),
  ...makeWeeklyMenu('LIQ-CLR', 'BFAST',  new Array(7).fill('Apple juice (clear)')),
  ...makeWeeklyMenu('LIQ-CLR', 'LUNCH',  new Array(7).fill('Clear vegetable soup')),
  ...makeWeeklyMenu('LIQ-CLR', 'SNACK',  new Array(7).fill('Electrolyte drink (ORS)')),
  ...makeWeeklyMenu('LIQ-CLR', 'DINNER', new Array(7).fill('Clear vegetable soup')),
];

// ─── Drug-food interactions ─────────────────────────────────────────
interface InteractionSeed {
  match: string;
  severity: 'info' | 'warning' | 'critical';
  foodGuidance: string;
}

const INTERACTIONS: InteractionSeed[] = [
  { match: 'warfarin', severity: 'critical',
    foodGuidance: 'Avoid sudden changes in vitamin-K intake — keep leafy greens (spinach, methi, kale) consistent. Avoid cranberry juice and large amounts of garlic/ginger.' },
  { match: 'linezolid', severity: 'critical',
    foodGuidance: 'Avoid tyramine-rich foods: aged cheese, cured meats, fermented soy, wine, beer, draught beverages.' },
  { match: 'simvastatin', severity: 'warning',
    foodGuidance: 'Avoid grapefruit and grapefruit juice — increases statin levels and rhabdomyolysis risk.' },
  { match: 'atorvastatin', severity: 'warning',
    foodGuidance: 'Limit grapefruit and grapefruit juice to small amounts; large quantities increase statin exposure.' },
  { match: 'tetracycline', severity: 'warning',
    foodGuidance: 'Take 1h before / 2h after dairy, antacids, iron, or calcium supplements (chelation reduces absorption).' },
  { match: 'doxycycline', severity: 'warning',
    foodGuidance: 'Avoid dairy and antacids within 2h of dose. Take with water, upright posture.' },
  { match: 'levothyroxine', severity: 'warning',
    foodGuidance: 'Take on empty stomach 30-60 min before breakfast. Avoid coffee, soy, calcium, iron, and high-fibre foods at the same time.' },
  { match: 'ciprofloxacin', severity: 'warning',
    foodGuidance: 'Separate by 2h from dairy, calcium-fortified juices, iron, antacids. Avoid caffeine excess.' },
  { match: 'lisinopril', severity: 'info',
    foodGuidance: 'Watch for hyperkalaemia — moderate intake of bananas, oranges, tomatoes, coconut water. Avoid salt substitutes (KCl).' },
  { match: 'enalapril', severity: 'info',
    foodGuidance: 'Watch for hyperkalaemia — moderate intake of bananas, oranges, tomatoes. Avoid salt substitutes (KCl).' },
  { match: 'furosemide', severity: 'info',
    foodGuidance: 'May deplete potassium — include bananas, oranges, dates unless on potassium-sparing co-therapy.' },
  { match: 'digoxin', severity: 'warning',
    foodGuidance: 'Avoid high-fibre meals (bran, oat bran) at the same time as the dose — reduces absorption.' },
  { match: 'methotrexate', severity: 'warning',
    foodGuidance: 'Avoid alcohol completely. Limit caffeine. Folate-rich foods are encouraged (spinach, lentils).' },
  { match: 'metformin', severity: 'info',
    foodGuidance: 'Take with meals to reduce GI upset. Avoid heavy alcohol intake (lactic acidosis risk).' },
  { match: 'insulin', severity: 'info',
    foodGuidance: 'Coordinate meal timing with dose. Carbohydrate-counted meals; avoid skipping meals after rapid-acting doses.' },
];

// ─── Canteen channel ────────────────────────────────────────────────
const DEFAULT_CHANNEL = { name: 'Main canteen' };

// ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Seeding dietetics catalogue…\n');

  // Slots
  const slotIdByCode = new Map<string, string>();
  for (const s of SLOTS) {
    const row = await prisma.mealTimeSlot.upsert({
      where: { code: s.code },
      update: { name: s.name, startTime: s.startTime, endTime: s.endTime, sequence: s.sequence, isActive: true },
      create: { ...s, isActive: true },
    });
    slotIdByCode.set(s.code, row.id);
    console.log(`  slot  ${row.code.padEnd(7)} ${row.startTime}-${row.endTime}`);
  }

  // Allergens
  const allergenIdByName = new Map<string, string>();
  for (const name of ALLERGENS) {
    const row = await prisma.allergenMaster.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
    allergenIdByName.set(name, row.id);
  }
  console.log(`  allergens: ${ALLERGENS.length}`);

  // Diets
  const dietIdByCode = new Map<string, string>();
  for (const d of DIETS) {
    const row = await prisma.dietMaster.upsert({
      where: { code: d.code },
      update: {
        name: d.name, description: d.description,
        caloriesKcal: d.caloriesKcal ?? null, proteinG: d.proteinG ?? null,
        carbsG: d.carbsG ?? null, fatG: d.fatG ?? null,
        sodiumMg: d.sodiumMg ?? null, potassiumMg: d.potassiumMg ?? null, fluidMl: d.fluidMl ?? null,
        restrictions: d.restrictions ?? null, targetConditions: d.targetConditions ?? null,
        isVeg: d.isVeg ?? false, isJain: d.isJain ?? false, isHalal: d.isHalal ?? false,
        isKosher: d.isKosher ?? false, isNoOnionGarlic: d.isNoOnionGarlic ?? false,
        isActive: true,
      },
      create: {
        code: d.code, name: d.name, description: d.description,
        caloriesKcal: d.caloriesKcal ?? null, proteinG: d.proteinG ?? null,
        carbsG: d.carbsG ?? null, fatG: d.fatG ?? null,
        sodiumMg: d.sodiumMg ?? null, potassiumMg: d.potassiumMg ?? null, fluidMl: d.fluidMl ?? null,
        restrictions: d.restrictions ?? null, targetConditions: d.targetConditions ?? null,
        isVeg: d.isVeg ?? false, isJain: d.isJain ?? false, isHalal: d.isHalal ?? false,
        isKosher: d.isKosher ?? false, isNoOnionGarlic: d.isNoOnionGarlic ?? false,
        isActive: true, createdBy: 'system-seed',
      },
    });
    dietIdByCode.set(d.code, row.id);
    console.log(`  diet  ${row.code.padEnd(8)} ${row.name}`);
  }

  // Meals + their compat / allergen joins.
  const mealIdByName = new Map<string, string>();
  for (const m of MEALS) {
    const row = await prisma.mealMaster.upsert({
      where: { name: m.name },
      update: {
        description: m.description ?? null, category: m.category,
        caloriesKcal: m.caloriesKcal ?? null, isVeg: m.isVeg ?? true, isActive: true,
      },
      create: {
        name: m.name, description: m.description ?? null, category: m.category,
        caloriesKcal: m.caloriesKcal ?? null, isVeg: m.isVeg ?? true, isActive: true,
      },
    });
    mealIdByName.set(m.name, row.id);

    // Replace compat joins for this meal — keeps it simple and idempotent.
    await prisma.dietMealCompat.deleteMany({ where: { mealMasterId: row.id } });
    for (const code of m.compatibleDietCodes) {
      const dietId = dietIdByCode.get(code);
      if (!dietId) {
        console.warn(`  ! meal "${m.name}" references unknown diet "${code}"`);
        continue;
      }
      await prisma.dietMealCompat.create({ data: { dietMasterId: dietId, mealMasterId: row.id } });
    }
    await prisma.mealAllergen.deleteMany({ where: { mealMasterId: row.id } });
    for (const name of m.allergenNames) {
      const allergenId = allergenIdByName.get(name);
      if (!allergenId) {
        console.warn(`  ! meal "${m.name}" references unknown allergen "${name}"`);
        continue;
      }
      await prisma.mealAllergen.create({ data: { mealMasterId: row.id, allergenId } });
    }
  }
  console.log(`  meals: ${MEALS.length}`);

  // Menu plan
  let menuCount = 0;
  for (const e of MENU_ENTRIES) {
    const dietId = dietIdByCode.get(e.dietCode);
    const slotId = slotIdByCode.get(e.slotCode);
    const mealId = mealIdByName.get(e.mealName);
    if (!dietId || !slotId || !mealId) {
      console.warn(`  ! menu entry skipped: diet=${e.dietCode} slot=${e.slotCode} meal=${e.mealName}`);
      continue;
    }
    await prisma.menuPlan.upsert({
      where: {
        dietMasterId_mealTimeSlotId_dayOfWeek: {
          dietMasterId: dietId, mealTimeSlotId: slotId, dayOfWeek: e.dayOfWeek,
        },
      },
      update: { mealMasterId: mealId },
      create: { dietMasterId: dietId, mealTimeSlotId: slotId, mealMasterId: mealId, dayOfWeek: e.dayOfWeek },
    });
    menuCount += 1;
  }
  console.log(`  menu cells: ${menuCount}`);

  // Drug-food interactions — no unique on match, so we do findFirst-then-write.
  for (const i of INTERACTIONS) {
    const existing = await prisma.drugFoodInteraction.findFirst({ where: { match: i.match } });
    if (existing) {
      await prisma.drugFoodInteraction.update({
        where: { id: existing.id },
        data: { severity: i.severity, foodGuidance: i.foodGuidance, isActive: true },
      });
    } else {
      await prisma.drugFoodInteraction.create({
        data: { match: i.match, severity: i.severity, foodGuidance: i.foodGuidance, isActive: true },
      });
    }
  }
  console.log(`  drug-food interactions: ${INTERACTIONS.length}`);

  // Default canteen channel.
  await prisma.canteenChannel.upsert({
    where: { name: DEFAULT_CHANNEL.name },
    update: { isActive: true },
    create: { name: DEFAULT_CHANNEL.name, isActive: true },
  });
  console.log(`  canteen channel: "${DEFAULT_CHANNEL.name}"`);

  console.log('\nDone.');
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
