import prisma from '../../service/prisma-client';

/**
 * Tray dish lists.
 *
 * A meal (MealMaster) is built from dishes (MealDish). Every tray that is still
 * ORDERED carries one MealOrderItem per dish of its meal. Reconciling keeps the
 * patient's swaps / "no" for dishes still on the meal, adds dishes the meal
 * gained and drops dishes it lost — so it is safe to run as often as needed
 * (after order generation, a choice of a different meal, or a meal edit).
 * Trays already prepared are never touched.
 */
export async function syncTrayDishes(where: { orderIds?: string[]; mealMasterId?: string; from?: Date; to?: Date; admissionId?: string }): Promise<void> {
  const orders = await prisma.mealOrder.findMany({
    where: {
      status: 'ORDERED',
      ...(where.orderIds && { id: { in: where.orderIds } }),
      ...(where.mealMasterId && { mealMasterId: where.mealMasterId }),
      ...(where.admissionId && { admissionId: where.admissionId }),
      ...((where.from || where.to) && { scheduledFor: { ...(where.from && { gte: where.from }), ...(where.to && { lte: where.to }) } }),
    },
    select: { id: true, mealMasterId: true, items: { select: { id: true, defaultDishId: true } } },
  });
  if (!orders.length) return;

  const mealIds = Array.from(new Set(orders.map((o) => o.mealMasterId).filter((x): x is string => !!x)));
  const links = mealIds.length
    ? await prisma.mealDish.findMany({ where: { mealMasterId: { in: mealIds } }, orderBy: { sortOrder: 'asc' } })
    : [];
  const dishesByMeal = new Map<string, Array<{ dishId: string; sortOrder: number }>>();
  for (const l of links) {
    const list = dishesByMeal.get(l.mealMasterId) ?? [];
    list.push({ dishId: l.dishId, sortOrder: l.sortOrder });
    dishesByMeal.set(l.mealMasterId, list);
  }

  const toDelete: string[] = [];
  const toCreate: Array<{ mealOrderId: string; defaultDishId: string; dishId: string; sortOrder: number }> = [];
  for (const o of orders) {
    const want = o.mealMasterId ? dishesByMeal.get(o.mealMasterId) ?? [] : [];
    const wantIds = new Set(want.map((w) => w.dishId));
    const have = new Set(o.items.map((i) => i.defaultDishId));
    for (const i of o.items) if (!wantIds.has(i.defaultDishId)) toDelete.push(i.id);
    for (const w of want) {
      if (!have.has(w.dishId)) toCreate.push({ mealOrderId: o.id, defaultDishId: w.dishId, dishId: w.dishId, sortOrder: w.sortOrder });
    }
  }
  if (toDelete.length) await prisma.mealOrderItem.deleteMany({ where: { id: { in: toDelete } } });
  // skipDuplicates: a concurrent sync may have added the same (order, dish).
  if (toCreate.length) await prisma.mealOrderItem.createMany({ data: toCreate, skipDuplicates: true });
}

/** Kitchen count with the buffer: 34 dishes at +5 % → 36. */
export function withBuffer(count: number, bufferPct: number): number {
  if (count <= 0) return 0;
  const pct = Number.isFinite(bufferPct) && bufferPct > 0 ? bufferPct : 0;
  return Math.ceil(count * (1 + pct / 100));
}

/**
 * True once the meal's order cut-off has passed. `scheduledFor` is the meal's
 * start; a cut-off later in the day than the start (breakfast 07:30, cut-off
 * 21:00) means the evening before.
 */
export function pastCutoff(scheduledFor: Date, orderCutoff: string | null, now = new Date()): boolean {
  if (!orderCutoff) return false;
  const [h, m] = orderCutoff.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const cut = new Date(scheduledFor);
  cut.setHours(h, m, 0, 0);
  if (cut > scheduledFor) cut.setDate(cut.getDate() - 1);
  return now > cut;
}

/** A dish suits a diet when it lists no diets at all, or lists this one. */
export function dishSuitsDiet(dish: { diets: Array<{ dietMasterId: string }> }, dietMasterId: string): boolean {
  return dish.diets.length === 0 || dish.diets.some((d) => d.dietMasterId === dietMasterId);
}
