import cron from 'node-cron';
import prisma from '../../service/prisma-client';

/**
 * Dietetics — MealOrder generator (nightly at 22:00 for "tomorrow", and on
 * demand whenever a plan, sheet cell, hold or admission changes).
 *
 * What a patient gets for a slot, in order of precedence:
 *   1. Not admitted / no current plan          → nothing
 *   2. Diet kind NO_TRAY (home / mother food)  → nothing
 *   3. NPO — dietitian's window (npoFrom … npoUntil) or an active MealHold
 *      (e.g. "NPO from 6 AM" relayed in the nursing census) → nothing
 *   4. Sheet cell says "NO" (instruction.skip)  → nothing
 *   5. Otherwise a tray when there is something to serve:
 *        ORAL → weekly-menu meal for (diet × weekday × slot) and/or the cell's
 *               instruction / supplement
 *        FEED → only slots with an instruction / supplement (feed volumes)
 *      The cell's instruction + supplement become the tray's kitchen notes.
 *
 * "Current plan" = newest ACTIVE (dietitian-signed), else the INTERIM plan
 * created from the nursing census for a patient not yet assessed.
 *
 * Reconciliation, not just insert. For every (admission × slot) on the day:
 *   • no order yet          → create it if wanted
 *   • order still ORDERED   → bring it in line (plan, meal, notes, bed) or
 *                             SKIP it with the reason it is no longer wanted
 *   • order PLATED or later → left alone; the tray is already moving
 * Slots whose end time is before `notBefore` (default: now) are never touched.
 *
 * Idempotency: MealOrder is unique on (admissionId, mealTimeSlotId,
 * scheduledFor), so concurrent runs can't duplicate a row.
 */

export interface GenerateOptions {
  /** Restrict the run to one admission (plan sign / end, sheet edit, transfer). */
  admissionId?: string;
  /** Slots that end before this instant are skipped. Defaults to now. */
  notBefore?: Date;
}

export interface GenerateResult {
  created: number;
  reassigned: number;
  cancelled: number;
}

/** Date on `day` at an `HH:mm` clock time, or null if the string is malformed. */
export function atClock(day: Date, hhmm: string): Date | null {
  const [hh, mm] = hhmm.split(':').map((s) => Number.parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const d = new Date(day);
  d.setHours(hh, mm, 0, 0);
  return d;
}

const fmtTime = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.toLocaleDateString('en-IN')}`;

/** Kitchen note for a sheet cell: free-text instruction + supplement / dose. */
export function composeKitchenNote(cell: {
  instruction: string | null;
  supplementDose: string | null;
  supplement: { name: string } | null;
} | undefined): string | null {
  if (!cell) return null;
  const parts: string[] = [];
  if (cell.supplement) {
    parts.push(cell.supplementDose ? `${cell.supplement.name} — ${cell.supplementDose}` : cell.supplement.name);
  }
  if (cell.instruction?.trim()) parts.push(cell.instruction.trim());
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Reconcile MealOrder rows for the calendar date represented by `target`.
 * Time component of `target` is ignored.
 */
export async function generateOrdersForDate(
  target: Date,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const result: GenerateResult = { created: 0, reassigned: 0, cancelled: 0 };
  const notBefore = opts.notBefore ?? new Date();

  const day = new Date(target);
  day.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  const dayOfWeek = day.getDay(); // 0=Sun .. 6=Sat

  // Only active slots that haven't finished yet are in play.
  const slots = await prisma.mealTimeSlot.findMany({ where: { isActive: true } });
  const openSlots = slots.filter((s) => {
    const end = atClock(day, s.endTime);
    return end !== null && end > notBefore;
  });
  if (openSlots.length === 0) return result;
  const openSlotIds = new Set(openSlots.map((s) => s.id));

  const admissionFilter = opts.admissionId ? { admissionId: opts.admissionId } : {};

  // Current plan per admission: newest ACTIVE wins over the census INTERIM.
  const plans = await prisma.dietPlan.findMany({
    where: { status: { in: ['ACTIVE', 'INTERIM'] }, ...admissionFilter },
    select: {
      id: true, admissionId: true, dietMasterId: true, status: true,
      npoFrom: true, npoUntil: true, endDate: true,
      diet: { select: { kind: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const planByAdmission = new Map<string, (typeof plans)[number]>();
  for (const p of plans) {
    const cur = planByAdmission.get(p.admissionId);
    if (!cur || (cur.status === 'INTERIM' && p.status === 'ACTIVE')) planByAdmission.set(p.admissionId, p);
  }

  const existingOrders = await prisma.mealOrder.findMany({
    where: { scheduledFor: { gte: day, lte: dayEnd }, ...admissionFilter },
    select: {
      id: true, admissionId: true, mealTimeSlotId: true,
      dietPlanId: true, mealMasterId: true, status: true,
      kitchenNotes: true, wardId: true, bedId: true,
    },
  });
  const orderKey = (admissionId: string, slotId: string): string => `${admissionId}|${slotId}`;
  const existingByKey = new Map(existingOrders.map((o) => [orderKey(o.admissionId, o.mealTimeSlotId), o]));
  const handled = new Set<string>();

  const admissionIds = Array.from(new Set([
    ...planByAdmission.keys(),
    ...existingOrders.map((o) => o.admissionId),
  ]));
  const [admissions, holds, cells] = admissionIds.length
    ? await Promise.all([
        prisma.ipdAdmission.findMany({
          where: { id: { in: admissionIds }, status: 'admitted' },
          select: { id: true, wardId: true, bedId: true },
        }),
        prisma.mealHold.findMany({
          where: { admissionId: { in: admissionIds }, liftedAt: null, fromAt: { lte: dayEnd } },
        }),
        prisma.patientMealInstruction.findMany({
          where: { admissionId: { in: admissionIds } },
          include: { supplement: { select: { name: true } } },
        }),
      ])
    : [[], [], []];
  const admMap = new Map(admissions.map((a) => [a.id, a]));
  const cellByKey = new Map(cells.map((c) => [orderKey(c.admissionId, c.mealTimeSlotId), c]));
  const holdsByAdmission = new Map<string, typeof holds>();
  for (const h of holds) {
    const list = holdsByAdmission.get(h.admissionId) ?? [];
    list.push(h);
    holdsByAdmission.set(h.admissionId, list);
  }

  // All menu rows for the current diets × this weekday in one go.
  const dietIds = Array.from(new Set(Array.from(planByAdmission.values()).map((p) => p.dietMasterId)));
  const menuRows = dietIds.length
    ? await prisma.menuPlan.findMany({ where: { dietMasterId: { in: dietIds }, dayOfWeek } })
    : [];
  const menuByKey = new Map(menuRows.map((m) => [`${m.dietMasterId}|${m.mealTimeSlotId}`, m]));

  const skip = async (id: string, reason: string): Promise<void> => {
    await prisma.mealOrder.update({ where: { id }, data: { status: 'SKIPPED', skipReason: reason } });
    result.cancelled++;
  };

  // ─── Pass 1: what the current plans want ──────────────────────────
  for (const plan of planByAdmission.values()) {
    const adm = admMap.get(plan.admissionId);
    if (!adm) continue; // not admitted — pass 2 cancels any leftovers
    if (plan.endDate && plan.endDate < day) continue;

    for (const slot of openSlots) {
      const scheduledFor = atClock(day, slot.startTime);
      if (!scheduledFor) continue;
      const key = orderKey(plan.admissionId, slot.id);
      const cell = cellByKey.get(key);
      const menu = menuByKey.get(`${plan.dietMasterId}|${slot.id}`);
      const note = composeKitchenNote(cell);

      // Why this slot gets nothing (null = it gets a tray).
      let noTrayReason: string | null = null;
      const kind = plan.diet.kind;
      const npoPlan = plan.npoFrom || plan.npoUntil
        ? (!plan.npoFrom || plan.npoFrom <= scheduledFor) && (!plan.npoUntil || plan.npoUntil > scheduledFor)
        : false;
      const hold = (holdsByAdmission.get(plan.admissionId) ?? [])
        .find((h) => h.fromAt <= scheduledFor && (!h.untilAt || h.untilAt > scheduledFor));
      if (kind === 'NO_TRAY') noTrayReason = 'Diet is home / mother food — no tray';
      else if (npoPlan) noTrayReason = plan.npoUntil ? `NPO until ${fmtTime(plan.npoUntil)}` : 'NPO till further orders';
      else if (hold) noTrayReason = `${hold.reason}${hold.untilAt ? ` (until ${fmtTime(hold.untilAt)})` : ''}`;
      else if (cell?.skip) noTrayReason = 'Not required (diet sheet: NO)';
      else if (kind === 'FEED' && !note) noTrayReason = 'Feed — no instruction for this slot';
      else if (kind !== 'FEED' && !menu && !note) noTrayReason = 'Slot not on the current diet menu';

      const existing = existingByKey.get(key);
      if (existing) {
        handled.add(key);
        if (existing.status !== 'ORDERED') continue; // tray already moving
        if (noTrayReason) {
          await skip(existing.id, noTrayReason);
        } else {
          const mealMasterId = menu?.mealMasterId ?? null;
          if (
            existing.dietPlanId !== plan.id || existing.mealMasterId !== mealMasterId
            || existing.kitchenNotes !== note || existing.wardId !== adm.wardId || existing.bedId !== adm.bedId
          ) {
            await prisma.mealOrder.update({
              where: { id: existing.id },
              data: {
                dietPlanId: plan.id, mealMasterId, kitchenNotes: note,
                wardId: adm.wardId, bedId: adm.bedId,
              },
            });
            result.reassigned++;
          }
        }
        continue;
      }

      if (noTrayReason) continue;
      try {
        await prisma.mealOrder.create({
          data: {
            admissionId: plan.admissionId,
            dietPlanId: plan.id,
            mealTimeSlotId: slot.id,
            mealMasterId: menu?.mealMasterId ?? null,
            kitchenNotes: note,
            scheduledFor,
            wardId: adm.wardId,
            bedId: adm.bedId,
            status: 'ORDERED',
          },
        });
        result.created++;
      } catch (err: unknown) {
        // P2002 — a concurrent run created the same (admission, slot, date)
        // row first. Expected; ignore.
        const code = (err as { code?: string }).code;
        if (code !== 'P2002') {
          console.error(`[meal-order-cron] create failed for plan ${plan.id} slot ${slot.id}:`, err);
        }
      }
    }
  }

  // ─── Pass 2: ORDERED rows no current plan wants any more ──────────
  for (const o of existingOrders) {
    const key = orderKey(o.admissionId, o.mealTimeSlotId);
    if (handled.has(key) || o.status !== 'ORDERED' || !openSlotIds.has(o.mealTimeSlotId)) continue;

    const plan = planByAdmission.get(o.admissionId);
    let reason: string;
    if (!admMap.has(o.admissionId)) reason = 'Patient no longer admitted';
    else if (!plan || (plan.endDate && plan.endDate < day)) reason = 'Diet plan ended';
    else reason = 'Slot not on the current diet menu';
    await skip(o.id, reason);
  }

  return result;
}

/**
 * Bring one admission's orders for today (remaining slots) and tomorrow in
 * line with its current plan, sheet cells and holds. Called after any change
 * so the kitchen sees it without waiting for the nightly run.
 */
export async function syncOrdersForAdmission(admissionId: string): Promise<GenerateResult> {
  const total: GenerateResult = { created: 0, reassigned: 0, cancelled: 0 };
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (const d of [today, tomorrow]) {
    const r = await generateOrdersForDate(d, { admissionId });
    total.created += r.created;
    total.reassigned += r.reassigned;
    total.cancelled += r.cancelled;
  }
  return total;
}

/** Same as syncOrdersForAdmission but never throws — for side-effect callers. */
export async function syncOrdersQuietly(admissionId: string): Promise<void> {
  try {
    await syncOrdersForAdmission(admissionId);
  } catch (err) {
    console.error(`[dietetics] meal-order sync failed for admission ${admissionId}:`, err);
  }
}

export function registerMealOrderCron(): void {
  // 22:00 local. We generate "tomorrow" so kitchens have the prep list
  // before the breakfast shift starts.
  cron.schedule('0 22 * * *', async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const r = await generateOrdersForDate(tomorrow);
      console.log(
        `[meal-order-cron] ${tomorrow.toISOString().slice(0, 10)}: created ${r.created}, reassigned ${r.reassigned}, cancelled ${r.cancelled}`,
      );
    } catch (err) {
      console.error('[meal-order-cron] failed:', err);
    }
  });

  console.log('[meal-order-cron] scheduled at 22:00 daily');
}
