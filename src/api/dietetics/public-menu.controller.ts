import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

/**
 * Public weekly menu — opened from the "Scan to see today's menu" QR poster.
 * No login. Read-only, no patient data: only diets, meal times and dishes from
 * the weekly menu (Dietetics → Setup → Menu) and the extra dish options.
 *
 *   GET /api/dietetics/public/menu
 *   → { today, slots[], diets[{ id, name, code, description, isVeg, cells[] }] }
 *
 * cells: one per (weekday × meal time) that has a dish — the default dish plus
 * any options the patient may choose instead. Diets with nothing on the menu
 * (RT feed, home food) are left out.
 */

interface PublicDish { name: string; description: string | null; isVeg: boolean; caloriesKcal: number | null; items: string[] }
interface PublicCell { day: number; slotId: string; dish: PublicDish; notes: string | null; options: PublicDish[] }

type MealRow = {
  name: string; description: string | null; isVeg: boolean; caloriesKcal: number | null;
  dishes: Array<{ dish: { name: string; isActive: boolean } }>;
};
const dishOf = (m: MealRow): PublicDish => ({
  name: m.name, description: m.description, isVeg: m.isVeg, caloriesKcal: m.caloriesKcal,
  // The plate's dishes (meals built from dishes in Setup).
  items: m.dishes.filter((d) => d.dish.isActive).map((d) => d.dish.name),
});

const MEAL_SELECT = {
  name: true, description: true, isVeg: true, caloriesKcal: true, isActive: true,
  dishes: { select: { dish: { select: { name: true, isActive: true } } }, orderBy: { sortOrder: 'asc' } },
} as const;

export const getPublicMenu = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [slots, diets, rows, options] = await Promise.all([
      prisma.mealTimeSlot.findMany({
        where: { isActive: true },
        // Clock order (HH:mm sorts as text) — what a patient expects to read.
        orderBy: [{ startTime: 'asc' }, { sequence: 'asc' }],
        select: { id: true, name: true, startTime: true, endTime: true },
      }),
      prisma.dietMaster.findMany({
        where: { isActive: true, kind: 'ORAL' },
        orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, code: true, description: true, isVeg: true },
      }),
      prisma.menuPlan.findMany({
        select: { dietMasterId: true, mealTimeSlotId: true, dayOfWeek: true, notes: true, meal: { select: MEAL_SELECT } },
      }),
      prisma.menuOption.findMany({
        select: { dietMasterId: true, mealTimeSlotId: true, dayOfWeek: true, meal: { select: MEAL_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const slotIds = new Set(slots.map((s) => s.id));
    const key = (d: string, s: string, w: number) => `${d}|${s}|${w}`;
    const optionsByCell = new Map<string, PublicDish[]>();
    for (const o of options) {
      if (!o.meal.isActive) continue;
      const k = key(o.dietMasterId, o.mealTimeSlotId, o.dayOfWeek);
      const list = optionsByCell.get(k) ?? [];
      list.push(dishOf(o.meal));
      optionsByCell.set(k, list);
    }

    const cellsByDiet = new Map<string, PublicCell[]>();
    for (const r of rows) {
      if (!r.meal.isActive || !slotIds.has(r.mealTimeSlotId)) continue;
      const list = cellsByDiet.get(r.dietMasterId) ?? [];
      list.push({
        day: r.dayOfWeek,
        slotId: r.mealTimeSlotId,
        dish: dishOf(r.meal),
        notes: r.notes,
        options: optionsByCell.get(key(r.dietMasterId, r.mealTimeSlotId, r.dayOfWeek)) ?? [],
      });
      cellsByDiet.set(r.dietMasterId, list);
    }

    const out = diets
      .map((d) => ({ ...d, cells: cellsByDiet.get(d.id) ?? [] }))
      .filter((d) => d.cells.length > 0);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ today: new Date().getDay(), slots, diets: out });
  } catch (error) {
    console.error('[dietetics] getPublicMenu failed:', error);
    res.status(500).json({ error: 'Could not load the menu' });
  }
};
