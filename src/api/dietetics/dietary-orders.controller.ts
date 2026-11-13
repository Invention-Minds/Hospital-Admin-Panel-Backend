import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { loadPatientContext, loadCurrentPlans } from './patient-context';

/**
 * Patient choice and RT feeds.
 *
 *   • Menu options — besides the weekly-menu default, a diet × meal × weekday
 *     can offer extra dishes. Canteen staff go round and "take the order":
 *     the tray then carries the patient's chosen dish.
 *   • RT feed doses — generated from the doctor's feed order on the diet plan
 *     (start time + every N hours inside the feed window). Kitchen prepares
 *     each dose with a label; the nurse records it given.
 */

const actorOf = (req: Request) => req.user?.username ?? null;
const dayBounds = (date?: string): { start: Date; end: Date } => {
  const start = date ? new Date(`${date}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) return dayBounds();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setHours(23, 59, 59, 999);
  return { start, end };
};

// ─── Menu options (setup) ─────────────────────────────────────────────

/** GET /menu-options?dietMasterId= */
export const listMenuOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const dietMasterId = req.query.dietMasterId as string;
    if (!dietMasterId) { res.status(400).json({ error: 'dietMasterId is required' }); return; }
    const rows = await prisma.menuOption.findMany({
      where: { dietMasterId },
      include: { meal: { select: { id: true, name: true, isVeg: true, caloriesKcal: true } } },
      orderBy: [{ mealTimeSlotId: 'asc' }, { dayOfWeek: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listMenuOptions failed:', error);
    res.status(500).json({ error: 'Failed to load menu options' });
  }
};

/** POST /menu-options { dietMasterId, mealTimeSlotId, dayOfWeek, mealMasterId } */
export const addMenuOption = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = (req.body ?? {}) as { dietMasterId?: string; mealTimeSlotId?: string; dayOfWeek?: number; mealMasterId?: string };
    const day = Number(b.dayOfWeek);
    if (!b.dietMasterId || !b.mealTimeSlotId || !b.mealMasterId || !Number.isInteger(day) || day < 0 || day > 6) {
      res.status(400).json({ error: 'dietMasterId, mealTimeSlotId, dayOfWeek (0-6) and mealMasterId are required' });
      return;
    }
    const isDefault = await prisma.menuPlan.findFirst({
      where: { dietMasterId: b.dietMasterId, mealTimeSlotId: b.mealTimeSlotId, dayOfWeek: day, mealMasterId: b.mealMasterId },
      select: { id: true },
    });
    if (isDefault) { res.status(409).json({ error: 'That dish is already the default for this meal' }); return; }
    const row = await prisma.menuOption.upsert({
      where: {
        dietMasterId_mealTimeSlotId_dayOfWeek_mealMasterId: {
          dietMasterId: b.dietMasterId, mealTimeSlotId: b.mealTimeSlotId, dayOfWeek: day, mealMasterId: b.mealMasterId,
        },
      },
      update: {},
      create: { dietMasterId: b.dietMasterId, mealTimeSlotId: b.mealTimeSlotId, dayOfWeek: day, mealMasterId: b.mealMasterId },
      include: { meal: { select: { id: true, name: true, isVeg: true, caloriesKcal: true } } },
    });
    await auditLog(req, { module: 'dietetics', action: 'CREATE', entityType: 'MenuOption', entityId: row.id, payload: b });
    res.status(201).json(row);
  } catch (error) {
    console.error('[dietetics] addMenuOption failed:', error);
    res.status(500).json({ error: 'Failed to add menu option' });
  }
};

/** DELETE /menu-options/:id */
export const removeMenuOption = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.menuOption.delete({ where: { id: req.params.id } });
    await auditLog(req, { module: 'dietetics', action: 'DELETE', entityType: 'MenuOption', entityId: req.params.id });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[dietetics] removeMenuOption failed:', error);
    res.status(500).json({ error: 'Failed to remove menu option' });
  }
};

// ─── Take order (canteen) ─────────────────────────────────────────────

type MealLite = { id: string; name: string; isVeg: boolean; caloriesKcal: number | null };

/** Dishes a tray may carry: weekly-menu default + configured options. */
async function choicesFor(dietMasterId: string, mealTimeSlotId: string, dayOfWeek: number) {
  const [def, opts] = await Promise.all([
    prisma.menuPlan.findUnique({
      where: { dietMasterId_mealTimeSlotId_dayOfWeek: { dietMasterId, mealTimeSlotId, dayOfWeek } },
      include: { meal: { select: { id: true, name: true, isVeg: true, caloriesKcal: true } } },
    }),
    prisma.menuOption.findMany({
      where: { dietMasterId, mealTimeSlotId, dayOfWeek },
      include: { meal: { select: { id: true, name: true, isVeg: true, caloriesKcal: true } } },
    }),
  ]);
  const out: Array<MealLite & { isDefault: boolean }> = [];
  if (def) out.push({ ...def.meal, isDefault: true });
  for (const o of opts) if (!out.some((m) => m.id === o.meal.id)) out.push({ ...o.meal, isDefault: false });
  return out;
}

/**
 * GET /take-order?date&mealTimeSlotId&wardId
 * Trays still ORDERED for the meal, each with the dishes the patient may pick.
 */
export const getTakeOrderList = async (req: Request, res: Response): Promise<void> => {
  try {
    const mealTimeSlotId = req.query.mealTimeSlotId as string;
    if (!mealTimeSlotId) { res.status(400).json({ error: 'mealTimeSlotId is required' }); return; }
    const { start, end } = dayBounds(req.query.date as string);
    const orders = await prisma.mealOrder.findMany({
      where: {
        mealTimeSlotId, scheduledFor: { gte: start, lte: end }, status: 'ORDERED',
        ...(req.query.wardId ? { wardId: req.query.wardId as string } : {}),
      },
      include: { meal: { select: { id: true, name: true } }, dietPlan: { include: { diet: { select: { id: true, code: true, name: true } } } } },
    });
    const patients = await loadPatientContext({ admissionIds: Array.from(new Set(orders.map((o) => o.admissionId))) });
    const pMap = new Map(patients.map((p) => [p.admissionId, p]));
    const plans = await loadCurrentPlans(patients.map((p) => p.admissionId));
    const dow = start.getDay();
    const cache = new Map<string, Awaited<ReturnType<typeof choicesFor>>>();
    const rows = [];
    for (const o of orders) {
      const p = pMap.get(o.admissionId);
      if (!p) continue;
      const k = o.dietPlan.diet.id;
      if (!cache.has(k)) cache.set(k, await choicesFor(k, mealTimeSlotId, dow));
      const plan = plans.get(o.admissionId);
      rows.push({
        id: o.id,
        admissionId: o.admissionId,
        bedNumber: p.bedNumber, wardName: p.wardName, patientName: p.patientName, prn: p.prn,
        dietCode: plan?.displayCode ?? o.dietPlan.diet.code,
        foodAvoid: plan?.foodAvoid ?? null,
        kitchenNotes: o.kitchenNotes,
        currentMeal: o.meal,
        choiceTakenAt: o.choiceTakenAt, choiceTakenBy: o.choiceTakenBy,
        choices: cache.get(k) ?? [],
      });
    }
    rows.sort((a, b) => (a.bedNumber ?? '').localeCompare(b.bedNumber ?? '', undefined, { numeric: true }));
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] getTakeOrderList failed:', error);
    res.status(500).json({ error: 'Failed to load the order list' });
  }
};

/** POST /meal-orders/:id/choice { mealMasterId } — only dishes offered for this diet + meal + day. */
export const setTrayChoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mealMasterId } = (req.body ?? {}) as { mealMasterId?: string };
    if (!mealMasterId) { res.status(400).json({ error: 'mealMasterId is required' }); return; }
    const order = await prisma.mealOrder.findUnique({ where: { id: req.params.id }, include: { dietPlan: true } });
    if (!order) { res.status(404).json({ error: 'Tray not found' }); return; }
    if (order.status !== 'ORDERED') { res.status(409).json({ error: 'The kitchen has already started this tray' }); return; }
    const allowed = await choicesFor(order.dietPlan.dietMasterId, order.mealTimeSlotId, order.scheduledFor.getDay());
    if (!allowed.some((m) => m.id === mealMasterId)) {
      res.status(400).json({ error: 'That dish is not on the menu for this diet and meal' });
      return;
    }
    const row = await prisma.mealOrder.update({
      where: { id: order.id },
      data: { mealMasterId, choiceTakenAt: new Date(), choiceTakenBy: actorOf(req) },
      include: { meal: { select: { id: true, name: true } } },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'UPDATE', entityType: 'MealOrderChoice', entityId: row.id,
      payload: { from: order.mealMasterId, to: mealMasterId },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] setTrayChoice failed:', error);
    res.status(500).json({ error: 'Failed to save the choice' });
  }
};

// ─── RT feed doses ─────────────────────────────────────────────────────

/** GET /feeds?date&wardId — doses for the day with patient + plan details. */
export const listFeeds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = dayBounds(req.query.date as string);
    const doses = await prisma.feedDose.findMany({
      where: { scheduledFor: { gte: start, lte: end } },
      include: { dietPlan: { include: { diet: { select: { code: true, name: true } } } } },
      orderBy: { scheduledFor: 'asc' },
    });
    const patients = await loadPatientContext({ admissionIds: Array.from(new Set(doses.map((d) => d.admissionId))), admittedOnly: false });
    const pMap = new Map(patients.map((p) => [p.admissionId, p]));
    const wardId = req.query.wardId as string | undefined;
    res.status(200).json(doses.flatMap((d) => {
      const p = pMap.get(d.admissionId);
      if (wardId && p?.wardId !== wardId) return [];
      return [{
        id: d.id,
        admissionId: d.admissionId,
        scheduledFor: d.scheduledFor,
        volumeMl: d.volumeMl,
        status: d.status,
        preparedAt: d.preparedAt, preparedBy: d.preparedBy,
        givenAt: d.givenAt, givenByName: d.givenByName ?? d.givenBy,
        skipReason: d.skipReason,
        intervalHours: d.dietPlan.feedIntervalHours,
        feedNotes: d.dietPlan.feedNotes,
        dietCode: d.dietPlan.diet.code, dietName: d.dietPlan.diet.name,
        foodAvoid: d.dietPlan.foodAvoid,
        patientName: p?.patientName ?? null, prn: p?.prn ?? null, admissionNo: p?.admissionNo ?? null,
        wardName: p?.wardName ?? null, bedNumber: p?.bedNumber ?? null,
      }];
    }));
  } catch (error) {
    console.error('[dietetics] listFeeds failed:', error);
    res.status(500).json({ error: 'Failed to load feeds' });
  }
};

/** POST /feeds/:id/:action  action = prepare | give | skip   body { givenByName?, reason? } */
export const updateFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, action } = req.params;
    const body = (req.body ?? {}) as { givenByName?: string; reason?: string };
    const d = await prisma.feedDose.findUnique({ where: { id } });
    if (!d) { res.status(404).json({ error: 'Feed not found' }); return; }
    const actor = actorOf(req);
    let data: Record<string, unknown>;
    if (action === 'prepare') {
      if (d.status !== 'ORDERED') { res.status(409).json({ error: `Feed is ${d.status}` }); return; }
      data = { status: 'PREPARED', preparedAt: new Date(), preparedBy: actor };
    } else if (action === 'give') {
      if (d.status !== 'PREPARED') { res.status(409).json({ error: 'The kitchen must prepare the feed first' }); return; }
      data = { status: 'GIVEN', givenAt: new Date(), givenBy: actor, givenByName: body.givenByName?.trim() || actor };
    } else if (action === 'skip') {
      if (d.status === 'GIVEN') { res.status(409).json({ error: 'Feed already given' }); return; }
      if (!body.reason?.trim()) { res.status(400).json({ error: 'reason is required' }); return; }
      data = { status: 'SKIPPED', skipReason: body.reason.trim() };
    } else {
      res.status(400).json({ error: 'action must be prepare, give or skip' });
      return;
    }
    const row = await prisma.feedDose.update({ where: { id }, data });
    await auditLog(req, {
      module: 'dietetics', action: 'STATUS_CHANGE', entityType: 'FeedDose', entityId: id,
      payload: { from: d.status, to: row.status },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] updateFeed failed:', error);
    res.status(500).json({ error: 'Failed to update feed' });
  }
};
