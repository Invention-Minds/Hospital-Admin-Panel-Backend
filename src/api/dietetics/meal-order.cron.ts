import cron from 'node-cron';
import prisma from '../../service/prisma-client';

/**
 * Dietetics — nightly MealOrder generator.
 *
 * Runs at 22:00 local each day. For every currently-ACTIVE DietPlan whose
 * admission is still 'admitted', emits MealOrder rows for "tomorrow" from the
 * MenuPlan rows that match (dietMasterId × tomorrow's day-of-week).
 *
 * Idempotency: MealOrder has a unique constraint on
 *   (admissionId, mealTimeSlotId, scheduledFor)
 * so re-running the same day is safe — duplicates are silently skipped.
 *
 * NPO handling: if the plan has an `npoUntil` later than the scheduled time
 * for a slot, that slot is skipped. The dietician can lift the hold by editing
 * the plan and re-running `regenerateForDate`.
 *
 * Wire from src/index.ts:
 *   import { registerMealOrderCron } from './api/dietetics/meal-order.cron';
 *   registerMealOrderCron();
 */

/**
 * Generate MealOrder rows for the calendar date represented by `target`.
 * Time component of `target` is ignored.
 *
 * Returns the count of MealOrder rows actually created.
 */
export async function generateOrdersForDate(target: Date): Promise<number> {
  const day = new Date(target);
  day.setHours(0, 0, 0, 0);
  const dayOfWeek = day.getDay(); // 0=Sun .. 6=Sat

  // All ACTIVE diet plans whose admission is still 'admitted'. We pull a
  // generous-but-bounded slice; production hospitals run well under 1k
  // active admissions, so a single query is fine.
  const activePlans = await prisma.dietPlan.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, admissionId: true, dietMasterId: true,
      npoUntil: true, endDate: true,
    },
  });
  if (activePlans.length === 0) return 0;

  const admissionIds = Array.from(new Set(activePlans.map((p) => p.admissionId)));
  const admissions = await prisma.ipdAdmission.findMany({
    where: { id: { in: admissionIds }, status: 'admitted' },
    select: { id: true, wardId: true, bedId: true },
  });
  const admMap = new Map(admissions.map((a) => [a.id, a]));

  // Pull all menu rows that match any active diet × this dayOfWeek in one go.
  const dietIds = Array.from(new Set(activePlans.map((p) => p.dietMasterId)));
  const menuRows = await prisma.menuPlan.findMany({
    where: { dietMasterId: { in: dietIds }, dayOfWeek },
    include: { mealTimeSlot: true },
  });
  if (menuRows.length === 0) return 0;

  // Bucket menu rows by diet for fast lookup per plan.
  const menuByDiet = new Map<string, typeof menuRows>();
  for (const m of menuRows) {
    const list = menuByDiet.get(m.dietMasterId) ?? [];
    list.push(m);
    menuByDiet.set(m.dietMasterId, list);
  }

  let created = 0;
  for (const plan of activePlans) {
    const adm = admMap.get(plan.admissionId);
    if (!adm) continue; // admission no longer 'admitted' — skip
    if (plan.endDate && plan.endDate < day) continue;

    const planMenu = menuByDiet.get(plan.dietMasterId);
    if (!planMenu) continue;

    for (const m of planMenu) {
      // Schedule the meal at the slot's startTime on the target day.
      const [hh, mm] = m.mealTimeSlot.startTime.split(':').map((s) => Number.parseInt(s, 10));
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
      const scheduledFor = new Date(day);
      scheduledFor.setHours(hh, mm, 0, 0);

      if (plan.npoUntil && plan.npoUntil > scheduledFor) continue;

      try {
        await prisma.mealOrder.create({
          data: {
            admissionId: plan.admissionId,
            dietPlanId: plan.id,
            mealTimeSlotId: m.mealTimeSlotId,
            mealMasterId: m.mealMasterId,
            scheduledFor,
            wardId: adm.wardId,
            bedId: adm.bedId,
            status: 'ORDERED',
          },
        });
        created++;
      } catch (err: unknown) {
        // P2002 — unique constraint hit. Means a row already exists for this
        // (admission, slot, date). Expected on re-runs / overlapping
        // regenerate calls; ignore silently.
        const code = (err as { code?: string }).code;
        if (code !== 'P2002') {
          console.error(
            `[meal-order-cron] create failed for plan ${plan.id} slot ${m.mealTimeSlotId}:`,
            err,
          );
        }
      }
    }
  }

  return created;
}

export function registerMealOrderCron(): void {
  // 22:00 local. We generate "tomorrow" so kitchens have the prep list
  // before the breakfast shift starts.
  cron.schedule('0 22 * * *', async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const count = await generateOrdersForDate(tomorrow);
      console.log(
        `[meal-order-cron] generated ${count} meal orders for ${tomorrow.toISOString().slice(0, 10)}`,
      );
    } catch (err) {
      console.error('[meal-order-cron] failed:', err);
    }
  });

  console.log('[meal-order-cron] scheduled at 22:00 daily');
}
