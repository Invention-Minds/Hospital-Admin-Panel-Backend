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
  // No meal left today still runs: RT feed doses keep going after the last meal.
  const openSlotIds = new Set(openSlots.map((s) => s.id));

  const admissionFilter = opts.admissionId ? { admissionId: opts.admissionId } : {};

  // Current plan per admission: newest ACTIVE wins over the census INTERIM.
  const plans = await prisma.dietPlan.findMany({
    where: { status: { in: ['ACTIVE', 'INTERIM'] }, ...admissionFilter },
    select: {
      id: true, admissionId: true, dietMasterId: true, status: true,
      npoFrom: true, npoUntil: true, endDate: true,
      feedVolumeMl: true, feedIntervalHours: true, feedStartTime: true, feedWindowFrom: true, feedWindowUntil: true,
      feedNotes: true,
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
      kitchenNotes: true, wardId: true, bedId: true, choiceTakenAt: true,
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
          where: {
            id: { in: admissionIds }, status: 'admitted',
            dischargeClearances: { none: { department: 'NURSING', status: 'cleared' } },
          },
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
          // A dish the patient chose ("Take order") stays; otherwise the menu default.
          const mealMasterId = existing.choiceTakenAt && existing.dietPlanId === plan.id
            ? existing.mealMasterId
            : menu?.mealMasterId ?? null;
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

  const feeds = await generateFeedDoses(day, notBefore, planByAdmission, admMap, holdsByAdmission, opts.admissionId);
  result.created += feeds.created;
  result.cancelled += feeds.cancelled;

  return result;
}

// ─── RT / tube feed doses ─────────────────────────────────────────────

type FeedPlan = {
  id: string; admissionId: string; npoFrom: Date | null; npoUntil: Date | null; endDate: Date | null;
  feedVolumeMl: number | null; feedIntervalHours: number | null;
  feedStartTime: string | null; feedWindowFrom: string | null; feedWindowUntil: string | null;
  feedNotes?: string | null; diet?: { kind: string };
};

/** Default RT feed schedule when the doctor's order is incomplete. */
export const DEFAULT_FEED_INTERVAL_HOURS = 2;
export const DEFAULT_FEED_START = '06:00';

/**
 * Read volume / interval out of free text the ward writes ("200ml Q2h",
 * "150 ml every 2 hrs", "100ml hourly"). Unknown parts come back null.
 */
export function parseFeedText(text: string | null | undefined): { volumeMl: number | null; intervalHours: number | null } {
  const t = (text ?? '').toLowerCase();
  const vol = t.match(/(\d{2,4})\s*(ml|cc)\b/) ?? t.match(/^\s*(\d{2,4})\s*$/);
  let interval: number | null = null;
  const q = t.match(/q\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hourly)?\b/)
    ?? t.match(/every\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/)
    ?? t.match(/(\d+(?:\.\d+)?)\s*(hrly|hourly|-hourly|th hourly)\b/);
  if (q) interval = Number(q[1]);
  else if (/\bhourly\b|\bq\s*1\s*h\b/.test(t)) interval = 1;
  return {
    volumeMl: vol ? Number(vol[1]) : null,
    intervalHours: interval && interval >= 0.5 && interval <= 24 ? interval : null,
  };
}

/**
 * The schedule actually used for a plan. An RT-feed diet always gets doses:
 * a missing interval / first-feed time falls back to the ward's text, else
 * Q2H from 06:00 (`defaulted` = true so screens ask the dietitian to confirm).
 * Other diets get doses only when a full feed order was entered.
 */
export function effectiveFeedOrder(plan: FeedPlan): {
  feedIntervalHours: number | null; feedStartTime: string | null; feedVolumeMl: number | null;
  feedWindowFrom: string | null; feedWindowUntil: string | null; defaulted: boolean;
} {
  const isFeedDiet = plan.diet?.kind === 'FEED';
  const parsed = parseFeedText(plan.feedNotes);
  const interval = plan.feedIntervalHours ?? (isFeedDiet ? parsed.intervalHours ?? DEFAULT_FEED_INTERVAL_HOURS : null);
  const start = plan.feedStartTime ?? (isFeedDiet ? DEFAULT_FEED_START : null);
  return {
    feedIntervalHours: interval,
    feedStartTime: start,
    feedVolumeMl: plan.feedVolumeMl ?? parsed.volumeMl,
    feedWindowFrom: plan.feedWindowFrom,
    feedWindowUntil: plan.feedWindowUntil,
    defaulted: isFeedDiet && (!plan.feedIntervalHours || !plan.feedStartTime),
  };
}

const minutesOf = (hhmm: string | null): number | null => {
  const m = (hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Inside the feed window? A window like 22:00 → 06:00 wraps midnight. No window = all day. */
function inFeedWindow(minute: number, from: number | null, until: number | null): boolean {
  if (from === null || until === null) return true;
  return from <= until ? minute >= from && minute <= until : minute >= from || minute <= until;
}

/** Clock minutes (0-1439) of every feed on a day: start time, then every N hours, in the window. */
export function feedMinutes(plan: Pick<FeedPlan, 'feedIntervalHours' | 'feedStartTime' | 'feedWindowFrom' | 'feedWindowUntil'>): number[] {
  const step = plan.feedIntervalHours ? Math.round(plan.feedIntervalHours * 60) : 0;
  const start = minutesOf(plan.feedStartTime);
  if (!step || step < 30 || start === null) return [];
  const from = minutesOf(plan.feedWindowFrom);
  const until = minutesOf(plan.feedWindowUntil);
  const out = new Set<number>();
  // The schedule repeats every day from the start time; walk one full day both ways.
  for (let m = start % step; m < 24 * 60; m += step) {
    if (inFeedWindow(m, from, until)) out.add(m);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Reconcile FeedDose rows for one day: one dose per feed time from the
 * doctor's order (start time + every N hours inside the window), none while
 * NPO / on hold. ORDERED doses that are no longer wanted are SKIPPED;
 * prepared / given doses are left alone. Doses before `notBefore` untouched.
 */
async function generateFeedDoses(
  day: Date,
  notBefore: Date,
  planByAdmission: Map<string, FeedPlan & { status: string }>,
  admMap: Map<string, { id: string }>,
  holdsByAdmission: Map<string, Array<{ fromAt: Date; untilAt: Date | null; reason: string }>>,
  admissionId?: string,
): Promise<{ created: number; cancelled: number }> {
  const out = { created: 0, cancelled: 0 };
  const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
  const existing = await prisma.feedDose.findMany({
    where: { scheduledFor: { gte: day, lte: dayEnd }, ...(admissionId ? { admissionId } : {}) },
    select: { id: true, admissionId: true, scheduledFor: true, status: true, dietPlanId: true, volumeMl: true },
  });
  const key = (a: string, t: Date) => `${a}|${t.getTime()}`;
  const existingByKey = new Map(existing.map((d) => [key(d.admissionId, d.scheduledFor), d]));
  const wanted = new Set<string>();

  for (const plan of planByAdmission.values()) {
    if (!admMap.has(plan.admissionId)) continue;
    if (plan.endDate && plan.endDate < day) continue;
    const order = effectiveFeedOrder(plan);
    for (const m of feedMinutes(order)) {
      const at = new Date(day); at.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (at < notBefore) continue;
      const npo = (plan.npoFrom || plan.npoUntil)
        && (!plan.npoFrom || plan.npoFrom <= at) && (!plan.npoUntil || plan.npoUntil > at);
      const hold = (holdsByAdmission.get(plan.admissionId) ?? []).some((h) => h.fromAt <= at && (!h.untilAt || h.untilAt > at));
      if (npo || hold) continue;
      const k = key(plan.admissionId, at);
      wanted.add(k);
      const cur = existingByKey.get(k);
      if (cur) {
        if (cur.status === 'ORDERED' && (cur.dietPlanId !== plan.id || cur.volumeMl !== order.feedVolumeMl)) {
          await prisma.feedDose.update({ where: { id: cur.id }, data: { dietPlanId: plan.id, volumeMl: order.feedVolumeMl } });
        }
        continue;
      }
      try {
        await prisma.feedDose.create({
          data: { admissionId: plan.admissionId, dietPlanId: plan.id, scheduledFor: at, volumeMl: order.feedVolumeMl },
        });
        out.created++;
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== 'P2002') console.error('[meal-order-cron] feed dose create failed:', err);
      }
    }
  }

  for (const d of existing) {
    if (d.status !== 'ORDERED' || d.scheduledFor < notBefore || wanted.has(key(d.admissionId, d.scheduledFor))) continue;
    const plan = planByAdmission.get(d.admissionId);
    const reason = !admMap.has(d.admissionId) ? 'Patient no longer admitted'
      : !plan ? 'Diet plan ended'
      : 'Feed order changed / NPO / on hold';
    await prisma.feedDose.update({ where: { id: d.id }, data: { status: 'SKIPPED', skipReason: reason } });
    out.cancelled++;
  }
  return out;
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
