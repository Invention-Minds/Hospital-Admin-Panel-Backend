/**
 * Dietetics — demo data for TODAY so the canteen TV / kitchen screens have
 * something to show. Safe to re-run; it only ADDS what is missing and never
 * overwrites what the hospital configured.
 *
 *   1. Tidy duplicates: older issued sheets for the same window and older
 *      unacknowledged census for the same ward + day → REPLACED.
 *   2. Canteen TV channel "Main kitchen TV" (if no active channel exists).
 *   3. A few meal items (only if the meal master is empty).
 *   4. Weekly menu cells for up to 3 oral diets × every active meal × 7 days
 *      (only empty cells are filled).
 *   5. Demo ACTIVE diet plans for up to 12 admitted patients who have no
 *      diet yet — marked "Demo data" in remarks and signed by "seed-demo".
 *   6. Meal orders for every meal of today + tomorrow, then a realistic mix
 *      of Prepared / Served for the current (or next) meal.
 *
 * Run:  npx ts-node prisma/seed-dietetics-demo.ts
 *       (or: npm run seed:dietetics-demo)
 *
 * Requires the dietary migration and the base masters (meal times + diets)
 * to exist — run `npm run seed:dietetics` / Dietetics → Setup first.
 */

import prisma from '../src/service/prisma-client';
import { generateOrdersForDate } from '../src/api/dietetics/meal-order.cron';

const DEMO_TAG = 'seed-demo';
const DEMO_MEALS = [
  { name: 'Idli (2) with sambar', category: 'Breakfast', caloriesKcal: 220 },
  { name: 'Broken wheat upma', category: 'Breakfast', caloriesKcal: 240 },
  { name: 'Dhaliya rice + dal + palya', category: 'Main', caloriesKcal: 480 },
  { name: 'Chapati (3) + palya + salad', category: 'Main', caloriesKcal: 450 },
  { name: 'Vegetable soup', category: 'Snack', caloriesKcal: 90 },
  { name: 'Sprouts salad', category: 'Snack', caloriesKcal: 120 },
  { name: 'Methi water (warm)', category: 'Beverage', caloriesKcal: 5 },
  { name: 'Buttermilk', category: 'Beverage', caloriesKcal: 60 },
];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const log: string[] = [];

  // ── 1. Tidy duplicates ───────────────────────────────────────────────
  const sheets = await prisma.dietSheet.findMany({
    where: { status: { in: ['ISSUED', 'ACKNOWLEDGED'] } },
    orderBy: { issuedAt: 'desc' },
    select: { id: true, serviceDate: true },
  });
  const seenWindow = new Set<string>();
  const oldSheets: string[] = [];
  for (const s of sheets) {
    const key = s.serviceDate.toISOString();
    if (seenWindow.has(key)) oldSheets.push(s.id); else seenWindow.add(key);
  }
  if (oldSheets.length) {
    await prisma.dietSheet.updateMany({ where: { id: { in: oldSheets } }, data: { status: 'REPLACED' } });
  }
  log.push(`Duplicate issued sheets marked replaced: ${oldSheets.length}`);

  const census = await prisma.dietCensus.findMany({
    where: { status: { in: ['SUBMITTED', 'RECEIVED'] } },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, wardId: true, censusDate: true },
  });
  const seenWard = new Set<string>();
  const oldCensus: string[] = [];
  for (const c of census) {
    const key = `${c.wardId}|${c.censusDate.toISOString()}`;
    if (seenWard.has(key)) oldCensus.push(c.id); else seenWard.add(key);
  }
  if (oldCensus.length) {
    await prisma.dietCensus.updateMany({ where: { id: { in: oldCensus } }, data: { status: 'REPLACED' } });
  }
  log.push(`Duplicate open census marked replaced: ${oldCensus.length}`);

  // ── 2. TV channel ────────────────────────────────────────────────────
  let channel = await prisma.canteenChannel.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!channel) {
    channel = await prisma.canteenChannel.create({ data: { name: 'Main kitchen TV', isActive: true } });
    log.push('TV channel created: Main kitchen TV');
  }

  // ── 3. Meals ─────────────────────────────────────────────────────────
  let meals = await prisma.mealMaster.findMany({ where: { isActive: true } });
  if (meals.length === 0) {
    for (const m of DEMO_MEALS) await prisma.mealMaster.create({ data: { ...m, isVeg: true, isActive: true } });
    meals = await prisma.mealMaster.findMany({ where: { isActive: true } });
    log.push(`Meal items created: ${meals.length}`);
  }

  // ── 4. Weekly menu for up to 3 oral diets ────────────────────────────
  const slots = await prisma.mealTimeSlot.findMany({ where: { isActive: true }, orderBy: [{ sequence: 'asc' }, { startTime: 'asc' }] });
  const diets = await prisma.dietMaster.findMany({ where: { isActive: true, kind: 'ORAL' }, orderBy: { name: 'asc' }, take: 3 });
  if (!slots.length || !diets.length) {
    throw new Error('Need active meal times and at least one active ORAL diet — set them up in Dietetics → Setup first.');
  }
  let menuAdded = 0;
  for (const [di, diet] of diets.entries()) {
    for (const [si, slot] of slots.entries()) {
      for (let day = 0; day < 7; day++) {
        const exists = await prisma.menuPlan.findUnique({
          where: { dietMasterId_mealTimeSlotId_dayOfWeek: { dietMasterId: diet.id, mealTimeSlotId: slot.id, dayOfWeek: day } },
          select: { id: true },
        });
        if (exists) continue;
        const meal = meals[(si + day + di) % meals.length];
        await prisma.menuPlan.create({
          data: { dietMasterId: diet.id, mealTimeSlotId: slot.id, mealMasterId: meal.id, dayOfWeek: day, notes: DEMO_TAG },
        });
        menuAdded++;
      }
    }
  }
  log.push(`Weekly-menu cells added: ${menuAdded} (for ${diets.map((d) => d.code).join(', ')})`);

  // ── 5. Demo diet plans for patients with no diet ─────────────────────
  const admitted = await prisma.ipdAdmission.findMany({ where: { status: 'admitted' }, select: { id: true }, orderBy: { admissionDate: 'asc' } });
  const withPlan = new Set(
    (await prisma.dietPlan.findMany({
      where: { admissionId: { in: admitted.map((a) => a.id) }, status: { in: ['ACTIVE', 'INTERIM'] } },
      select: { admissionId: true },
    })).map((p) => p.admissionId),
  );
  const needPlan = admitted.filter((a) => !withPlan.has(a.id)).slice(0, 12);
  for (const [i, a] of needPlan.entries()) {
    await prisma.dietPlan.create({
      data: {
        admissionId: a.id,
        dietMasterId: diets[i % diets.length].id,
        status: 'ACTIVE',
        source: 'DIETITIAN',
        signedAt: new Date(),
        signedBy: DEMO_TAG,
        disposablePlate: i % 4 === 0,
        remarks: 'Demo data (seed-dietetics-demo)',
        createdBy: DEMO_TAG,
      },
    });
  }
  log.push(`Demo diet plans created: ${needPlan.length}`);

  // ── 6. Trays for every meal today + tomorrow ─────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  // notBefore = start of today so today's earlier meals also exist for the demo.
  const rToday = await generateOrdersForDate(today, { notBefore: today });
  const rTomorrow = await generateOrdersForDate(tomorrow, { notBefore: today });
  log.push(`Trays today: +${rToday.created} (updated ${rToday.reassigned}) · tomorrow: +${rTomorrow.created}`);

  // Realistic progress on the meal the TV shows (current, else next, else tomorrow's first).
  const now = hhmm(new Date());
  const current = slots.find((s) => s.startTime <= now && s.endTime >= now) ?? slots.find((s) => s.startTime >= now);
  const tvSlot = current ?? slots[0];
  const tvDay = current ? today : tomorrow;
  const tvEnd = new Date(tvDay); tvEnd.setHours(23, 59, 59, 999);
  const tvOrders = await prisma.mealOrder.findMany({
    where: { mealTimeSlotId: tvSlot.id, scheduledFor: { gte: tvDay, lte: tvEnd }, status: 'ORDERED' },
    select: { id: true },
  });
  const toPlate = tvOrders.filter((_, i) => i % 3 !== 2).map((o) => o.id);      // ~2/3 prepared
  const toServe = tvOrders.filter((_, i) => i % 3 === 0).map((o) => o.id);      // ~1/3 of all served
  if (toPlate.length) {
    await prisma.mealOrder.updateMany({ where: { id: { in: toPlate } }, data: { status: 'PLATED', platedAt: new Date(), platedBy: DEMO_TAG } });
  }
  if (toServe.length) {
    await prisma.mealOrder.updateMany({
      where: { id: { in: toServe } },
      data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredBy: DEMO_TAG, servedByName: 'Demo ward boy' },
    });
  }
  log.push(`TV meal "${tvSlot.name}" ${current ? 'today' : 'tomorrow'}: ${tvOrders.length} trays — ${toPlate.length - toServe.length} prepared, ${toServe.length} served, ${tvOrders.length - toPlate.length} still to prepare`);

  for (const l of log) console.log(`• ${l}`);
  console.log(`\nOpen the TV page:  /canteen-channel/${channel.id}`);
}

main()
  .catch((e) => { console.error('Dietetics demo seed failed:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
