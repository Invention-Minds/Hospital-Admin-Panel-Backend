import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { readSettings } from './masters.controller';
import { syncTrayDishes, withBuffer, pastCutoff, dishSuitsDiet } from './tray-dishes';
import { atClock } from './meal-order.cron';

/**
 * Dishes, meals built from dishes, swaps on a tray and the kitchen prep count.
 *
 *   GET  /dishes                       list (with diet ids + meals using it)
 *   POST /dishes · PUT /dishes/:id     create / edit
 *   PUT  /meals/:id/dishes             { dishIds[] } — the meal's dishes, in order
 *   POST /meal-orders/:id/items/:itemId { action: swap|omit|restore, dishId? }
 *   GET  /prep-count?date&mealTimeSlotId   dishes to cook per meal, with buffer
 */

const actorOf = (req: Request) => req.user?.username ?? null;
const clean = (s: unknown): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

const dayBounds = (date?: string): { start: Date; end: Date } => {
  const start = date ? new Date(`${date}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) return dayBounds();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setHours(23, 59, 59, 999);
  return { start, end };
};

// ─── Dish master ──────────────────────────────────────────────────────

export const listDishes = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.dish.findMany({
      where: req.query.active === 'true' ? { isActive: true } : {},
      include: { diets: { select: { dietMasterId: true } }, _count: { select: { mealLinks: true } } },
      orderBy: [{ swapGroup: 'asc' }, { name: 'asc' }],
    });
    res.status(200).json(rows.map(({ diets, _count, ...d }) => ({
      ...d, dietIds: diets.map((x) => x.dietMasterId), mealCount: _count.mealLinks,
    })));
  } catch (error) {
    console.error('[dietetics] listDishes failed:', error);
    res.status(500).json({ error: 'Failed to list dishes' });
  }
};

export const upsertDish = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const b = (req.body ?? {}) as {
      name?: string; swapGroup?: string | null; portion?: string | null; isVeg?: boolean;
      caloriesKcal?: number | null; isActive?: boolean; dietIds?: string[];
    };
    const name = clean(b.name);
    if (!name) { res.status(400).json({ error: 'Dish name is required' }); return; }
    const kcal = b.caloriesKcal == null || (b.caloriesKcal as unknown) === '' ? null : Math.round(Number(b.caloriesKcal));
    if (kcal != null && (!Number.isFinite(kcal) || kcal < 0 || kcal > 5000)) {
      res.status(400).json({ error: 'Calories must be between 0 and 5000' }); return;
    }
    const data = {
      name,
      // Normalise the group so "staple" and "Staple " are the same group.
      swapGroup: clean(b.swapGroup) ? clean(b.swapGroup)!.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null,
      portion: clean(b.portion),
      isVeg: b.isVeg ?? true,
      caloriesKcal: kcal,
      isActive: b.isActive ?? true,
    };
    const row = await prisma.$transaction(async (tx) => {
      const saved = id ? await tx.dish.update({ where: { id }, data }) : await tx.dish.create({ data });
      if (Array.isArray(b.dietIds)) {
        await tx.dishDiet.deleteMany({ where: { dishId: saved.id } });
        if (b.dietIds.length) {
          await tx.dishDiet.createMany({ data: b.dietIds.map((dietMasterId) => ({ dishId: saved.id, dietMasterId })), skipDuplicates: true });
        }
      }
      return saved;
    });
    await auditLog(req, { module: 'dietetics', action: id ? 'UPDATE' : 'CREATE', entityType: 'Dish', entityId: row.id, payload: data });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') { res.status(409).json({ error: 'A dish with this name already exists' }); return; }
    console.error('[dietetics] upsertDish failed:', error);
    res.status(500).json({ error: 'Failed to save dish' });
  }
};

/** PUT /meals/:id/dishes { dishIds[] } — replaces the meal's dish list (order = serving order). */
export const setMealDishes = async (req: Request, res: Response): Promise<void> => {
  try {
    const mealMasterId = req.params.id;
    const dishIds = (req.body?.dishIds ?? []) as unknown;
    if (!Array.isArray(dishIds) || dishIds.some((x) => typeof x !== 'string')) {
      res.status(400).json({ error: 'dishIds must be a list of dish ids' }); return;
    }
    const unique = Array.from(new Set(dishIds as string[]));
    const meal = await prisma.mealMaster.findUnique({ where: { id: mealMasterId }, select: { id: true } });
    if (!meal) { res.status(404).json({ error: 'Meal not found' }); return; }
    const found = await prisma.dish.count({ where: { id: { in: unique } } });
    if (found !== unique.length) { res.status(400).json({ error: 'One or more dishes were not found' }); return; }

    await prisma.$transaction([
      prisma.mealDish.deleteMany({ where: { mealMasterId } }),
      prisma.mealDish.createMany({ data: unique.map((dishId, i) => ({ mealMasterId, dishId, sortOrder: i })) }),
    ]);
    // Trays not yet prepared from today on pick up the new dish list.
    const { start } = dayBounds();
    await syncTrayDishes({ mealMasterId, from: start });
    await auditLog(req, { module: 'dietetics', action: 'UPDATE', entityType: 'MealDish', entityId: mealMasterId, payload: { dishIds: unique } });
    res.status(200).json({ mealMasterId, dishIds: unique });
  } catch (error) {
    console.error('[dietetics] setMealDishes failed:', error);
    res.status(500).json({ error: 'Failed to save the meal dishes' });
  }
};

// ─── Swaps on a tray ──────────────────────────────────────────────────

const DISH_WITH_DIETS = { include: { diets: { select: { dietMasterId: true } } } } as const;

/** Dishes that may replace `dish` for a patient on `dietMasterId`. */
export async function swapCandidates(dietMasterId: string, swapGroup: string | null) {
  if (!swapGroup) return [];
  const rows = await prisma.dish.findMany({ where: { swapGroup, isActive: true }, ...DISH_WITH_DIETS, orderBy: { name: 'asc' } });
  return rows.filter((d) => dishSuitsDiet(d, dietMasterId));
}

/** POST /meal-orders/:id/items/:itemId { action: 'swap' | 'omit' | 'restore', dishId? } */
export const updateTrayItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const { action, dishId } = (req.body ?? {}) as { action?: string; dishId?: string };
    if (!['swap', 'omit', 'restore'].includes(action ?? '')) {
      res.status(400).json({ error: 'action must be swap, omit or restore' }); return;
    }
    const item = await prisma.mealOrderItem.findUnique({
      where: { id: req.params.itemId },
      include: {
        mealOrder: { include: { dietPlan: { select: { dietMasterId: true } }, mealTimeSlot: { select: { orderCutoff: true } } } },
      },
    });
    if (!item || item.mealOrderId !== req.params.id) { res.status(404).json({ error: 'Dish not found on this tray' }); return; }
    const order = item.mealOrder;
    if (order.status !== 'ORDERED') { res.status(409).json({ error: 'The kitchen has already prepared this tray' }); return; }

    let nextDishId = item.dishId;
    let omitted = item.omitted;
    if (action === 'swap') {
      if (!dishId) { res.status(400).json({ error: 'Choose the dish to swap to' }); return; }
      const base = await prisma.dish.findUnique({ where: { id: item.defaultDishId }, select: { swapGroup: true } });
      const allowed = await swapCandidates(order.dietPlan.dietMasterId, base?.swapGroup ?? null);
      if (dishId !== item.defaultDishId && !allowed.some((d) => d.id === dishId)) {
        res.status(400).json({ error: 'That dish can’t replace this one for the patient’s diet' }); return;
      }
      nextDishId = dishId;
      omitted = false;
    } else if (action === 'omit') {
      omitted = true;
    } else {
      nextDishId = item.defaultDishId;
      omitted = false;
    }

    const late = pastCutoff(order.scheduledFor, order.mealTimeSlot.orderCutoff);
    const row = await prisma.mealOrderItem.update({
      where: { id: item.id },
      data: { dishId: nextDishId, omitted, changedAt: new Date(), changedBy: actorOf(req), changedLate: late },
      include: { dish: { select: { id: true, name: true, portion: true, isVeg: true } } },
    });
    await prisma.mealOrder.update({ where: { id: order.id }, data: { choiceTakenAt: new Date(), choiceTakenBy: actorOf(req) } });
    await auditLog(req, {
      module: 'dietetics', action: 'UPDATE', entityType: 'MealOrderItem', entityId: item.id,
      payload: { action, from: item.dishId, to: nextDishId, omitted, late },
    });
    res.status(200).json({ ...row, late });
  } catch (error) {
    console.error('[dietetics] updateTrayItem failed:', error);
    res.status(500).json({ error: 'Failed to change the dish' });
  }
};

// ─── Kitchen prep count ───────────────────────────────────────────────

/**
 * GET /prep-count?date&mealTimeSlotId
 * Per meal time: how many of each dish to cook (trays not skipped, dishes not
 * omitted), the count with the buffer, plus trays whose meal has no dish list
 * (counted as whole plates) and how many dishes were changed after the cut-off.
 */
export const getPrepCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = dayBounds(req.query.date as string);
    const slotId = req.query.mealTimeSlotId as string | undefined;
    const [orders, slots, settings] = await Promise.all([
      prisma.mealOrder.findMany({
        where: { scheduledFor: { gte: start, lte: end }, status: { not: 'SKIPPED' }, ...(slotId && { mealTimeSlotId: slotId }) },
        select: {
          mealTimeSlotId: true, mealMasterId: true,
          meal: { select: { name: true } },
          items: { select: { dishId: true, defaultDishId: true, omitted: true, changedLate: true, dish: { select: { name: true, portion: true, swapGroup: true } } } },
        },
      }),
      prisma.mealTimeSlot.findMany({ where: { isActive: true }, orderBy: [{ startTime: 'asc' }] }),
      readSettings(),
    ]);
    const bufferPct = Number(settings.prepBufferPct ?? 0) || 0;

    type DishCount = { dishId: string; name: string; portion: string | null; group: string | null; count: number; withBuffer: number };
    const bySlot = new Map<string, {
      trays: number; dishes: Map<string, DishCount>; plates: Map<string, number>;
      instructionOnly: number; swapped: number; omitted: number; late: number;
    }>();
    for (const o of orders) {
      const s = bySlot.get(o.mealTimeSlotId) ?? { trays: 0, dishes: new Map(), plates: new Map(), instructionOnly: 0, swapped: 0, omitted: 0, late: 0 };
      s.trays++;
      if (o.items.length) {
        for (const i of o.items) {
          if (i.changedLate) s.late++;
          if (i.omitted) { s.omitted++; continue; }
          if (i.dishId !== i.defaultDishId) s.swapped++;
          const d = s.dishes.get(i.dishId) ?? { dishId: i.dishId, name: i.dish.name, portion: i.dish.portion, group: i.dish.swapGroup, count: 0, withBuffer: 0 };
          d.count++;
          s.dishes.set(i.dishId, d);
        }
      } else if (o.meal) {
        s.plates.set(o.meal.name, (s.plates.get(o.meal.name) ?? 0) + 1);
      } else {
        s.instructionOnly++;
      }
      bySlot.set(o.mealTimeSlotId, s);
    }

    const out = slots.filter((sl) => bySlot.has(sl.id)).map((sl) => {
      const s = bySlot.get(sl.id)!;
      const dishes = Array.from(s.dishes.values())
        .map((d) => ({ ...d, withBuffer: withBuffer(d.count, bufferPct) }))
        .sort((a, b) => (a.group ?? '~').localeCompare(b.group ?? '~') || b.count - a.count || a.name.localeCompare(b.name));
      const plates = Array.from(s.plates.entries())
        .map(([name, count]) => ({ name, count, withBuffer: withBuffer(count, bufferPct) }))
        .sort((a, b) => b.count - a.count);
      return {
        mealTimeSlotId: sl.id, name: sl.name, startTime: sl.startTime, orderCutoff: sl.orderCutoff,
        cutoffPassed: pastCutoff(atClock(start, sl.startTime) ?? start, sl.orderCutoff),
        trays: s.trays, dishes, plates, instructionOnly: s.instructionOnly,
        swapped: s.swapped, omitted: s.omitted, lateChanges: s.late,
      };
    });
    res.status(200).json({ bufferPct, slots: out });
  } catch (error) {
    console.error('[dietetics] getPrepCount failed:', error);
    res.status(500).json({ error: 'Failed to build the prep count' });
  }
};
