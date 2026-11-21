import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { isAutoSkip } from './meal-order.cron';

/**
 * Dietary reports — how many patients were served.
 *
 *   GET /reports/served?from=YYYY-MM-DD&to=YYYY-MM-DD&wardId=
 *
 * Served = tray marked Served (DELIVERED) or with intake recorded (CONSUMED).
 * "Not served" = staff marked it not served (with a reason). "No tray" = the
 * system skipped it (NPO, sheet NO, empty menu cell, plan ended…) — not a
 * service failure, reported separately. Range is capped at 92 days.
 */

const MAX_DAYS = 92;
const SERVED = new Set(['DELIVERED', 'CONSUMED']);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function parseDay(s: unknown, fallback: Date): Date {
  const d = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(fallback);
  if (Number.isNaN(d.getTime())) return new Date(fallback);
  d.setHours(0, 0, 0, 0);
  return d;
}

type Bucket = { patients: Set<string>; trays: number };
const bucket = (): Bucket => ({ patients: new Set(), trays: 0 });

export const getServedReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date();
    const from = parseDay(req.query.from, today);
    const to = parseDay(req.query.to, today);
    if (to < from) { res.status(400).json({ error: '"To" date is before "From" date' }); return; }
    if ((to.getTime() - from.getTime()) / 86400000 + 1 > MAX_DAYS) {
      res.status(400).json({ error: `Choose at most ${MAX_DAYS} days` }); return;
    }
    const end = new Date(to); end.setHours(23, 59, 59, 999);
    const wardId = (req.query.wardId as string) || undefined;

    const [orders, slots, extras] = await Promise.all([
      prisma.mealOrder.findMany({
        where: { scheduledFor: { gte: from, lte: end }, ...(wardId && { wardId }) },
        select: {
          admissionId: true, scheduledFor: true, mealTimeSlotId: true, status: true, skipReason: true,
          wardId: true, delayReason: true, receivedAt: true,
          dietPlan: { select: { diet: { select: { code: true, name: true } } } },
          intake: { select: { percentConsumed: true } },
        },
      }),
      prisma.mealTimeSlot.findMany({ orderBy: [{ startTime: 'asc' }], select: { id: true, name: true, startTime: true } }),
      prisma.extraFoodOrder.findMany({
        where: { requestedFor: { gte: from, lte: end }, status: 'SERVED' },
        select: { admissionId: true, forWhom: true },
      }),
    ]);
    const wardIds = Array.from(new Set(orders.map((o) => o.wardId).filter((x): x is string => !!x)));
    const wards = wardIds.length
      ? await prisma.ipdWard.findMany({ where: { id: { in: wardIds } }, select: { id: true, wardName: true } })
      : [];
    const wardName = new Map(wards.map((w) => [w.id, w.wardName]));
    // Extra food is per admission; keep it to the ward filter via the trays' admissions.
    const admissionsInScope = new Set(orders.map((o) => o.admissionId));
    const extrasInScope = wardId ? extras.filter((e) => admissionsInScope.has(e.admissionId)) : extras;

    const served = bucket();
    let notServed = 0, noTray = 0, pending = 0, late = 0, received = 0, intakeCount = 0, intakeSum = 0, lowIntake = 0;
    const byDay = new Map<string, Bucket & { slots: Map<string, number>; notServed: number }>();
    const bySlot = new Map<string, Bucket>();
    const byDiet = new Map<string, Bucket & { name: string }>();
    const byWard = new Map<string, Bucket>();
    const reasons = new Map<string, number>();
    const noTrayReasons = new Map<string, number>();

    for (const o of orders) {
      const day = ymd(o.scheduledFor);
      const d = byDay.get(day) ?? { ...bucket(), slots: new Map(), notServed: 0 };
      byDay.set(day, d);
      if (SERVED.has(o.status)) {
        served.patients.add(o.admissionId); served.trays++;
        d.patients.add(o.admissionId); d.trays++;
        d.slots.set(o.mealTimeSlotId, (d.slots.get(o.mealTimeSlotId) ?? 0) + 1);
        const s = bySlot.get(o.mealTimeSlotId) ?? bucket(); s.patients.add(o.admissionId); s.trays++; bySlot.set(o.mealTimeSlotId, s);
        const code = o.dietPlan.diet.code;
        const di = byDiet.get(code) ?? { ...bucket(), name: o.dietPlan.diet.name }; di.patients.add(o.admissionId); di.trays++; byDiet.set(code, di);
        const wk = o.wardId ? wardName.get(o.wardId) ?? 'Unknown ward' : 'No ward';
        const w = byWard.get(wk) ?? bucket(); w.patients.add(o.admissionId); w.trays++; byWard.set(wk, w);
        if (o.delayReason) late++;
        if (o.receivedAt) received++;
        if (o.intake) {
          intakeCount++; intakeSum += o.intake.percentConsumed;
          if (o.intake.percentConsumed < 50) lowIntake++;
        }
      } else if (o.status === 'SKIPPED') {
        // NPO / fasting (also when relayed by the ward census) is not a service failure.
        if (isAutoSkip(o.skipReason) || /^(Patient no longer admitted|NPO\b)/i.test(o.skipReason ?? '')) {
          noTray++;
          const k = (o.skipReason ?? '').split(' — ')[0].replace(/^NPO until .*/, 'NPO');
          noTrayReasons.set(k, (noTrayReasons.get(k) ?? 0) + 1);
        } else {
          notServed++; d.notServed++;
          const k = (o.skipReason ?? 'No reason').trim();
          reasons.set(k, (reasons.get(k) ?? 0) + 1);
        }
      } else {
        pending++;
      }
    }

    const slotName = new Map(slots.map((s) => [s.id, s.name]));
    const top = (m: Map<string, number>, n = 10) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([reason, count]) => ({ reason, count }));
    const days: string[] = [];
    for (let t = new Date(from); t <= to; t.setDate(t.getDate() + 1)) days.push(ymd(t));

    res.status(200).json({
      from: ymd(from), to: ymd(to),
      slots: slots.filter((s) => bySlot.has(s.id) || Array.from(byDay.values()).some((d) => d.slots.has(s.id))),
      totals: {
        patientsServed: served.patients.size,
        traysServed: served.trays,
        notServed, noTray, pending,
        servedLate: late,
        receivedOnWard: received,
        intakeRecorded: intakeCount,
        avgIntakePct: intakeCount ? Math.round(intakeSum / intakeCount) : null,
        lowIntake,
        extraFoodServed: extrasInScope.length,
        attendantMeals: extrasInScope.filter((e) => e.forWhom === 'ATTENDANT').length,
      },
      byDay: days.map((date) => {
        const d = byDay.get(date);
        return {
          date,
          patients: d?.patients.size ?? 0,
          trays: d?.trays ?? 0,
          notServed: d?.notServed ?? 0,
          perSlot: Object.fromEntries(d ? Array.from(d.slots.entries()) : []),
        };
      }),
      bySlot: Array.from(bySlot.entries()).map(([id, b]) => ({ id, name: slotName.get(id) ?? '—', patients: b.patients.size, trays: b.trays }))
        .sort((a, b) => (slots.findIndex((s) => s.id === a.id)) - (slots.findIndex((s) => s.id === b.id))),
      byDiet: Array.from(byDiet.entries()).map(([code, b]) => ({ code, name: b.name, patients: b.patients.size, trays: b.trays }))
        .sort((a, b) => b.trays - a.trays),
      byWard: Array.from(byWard.entries()).map(([name, b]) => ({ name, patients: b.patients.size, trays: b.trays }))
        .sort((a, b) => b.trays - a.trays),
      notServedReasons: top(reasons),
      noTrayReasons: top(noTrayReasons),
    });
  } catch (error) {
    console.error('[dietetics] getServedReport failed:', error);
    res.status(500).json({ error: 'Failed to build the report' });
  }
};
