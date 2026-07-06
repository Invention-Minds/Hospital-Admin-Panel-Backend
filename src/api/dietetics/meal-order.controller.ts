import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * MealOrder controller — ops surface for the canteen and ward nurses.
 *
 * One MealOrder row = (admission × meal-time × scheduled-date), populated nightly
 * by the cron in `meal-order.cron.ts` from each active DietPlan × MenuPlan.
 *
 * Lifecycle:
 *   ORDERED → PLATED → DELIVERED → CONSUMED | SKIPPED
 *
 *   • PLATED — kitchen has the tray on the trolley, used for canteen TV
 *   • DELIVERED — nurse has handed the tray to the patient (2-ID verified,
 *     tray temps recorded for HIC.4)
 *   • CONSUMED — intake recorded (% + complaint). Drives PSQ.5 KPIs.
 *   • SKIPPED — patient refused / NPO order / discharged. Reason mandatory.
 */

interface PlateBody {
  ids: string[];
}

interface DeliverBody {
  signatureId?: string;
  twoIdVerified?: boolean;
  trayHotTempC?: number;
  trayColdTempC?: number;
  notes?: string;
}

interface IntakeBody {
  percentConsumed: number; // 0 | 25 | 50 | 75 | 100
  complaint?: string;
  notes?: string;
}

interface SkipBody {
  reason: string;
}

// ─── Reads ──────────────────────────────────────────────────────────

/**
 * GET /api/dietetics/meal-orders/kitchen?date=YYYY-MM-DD&mealTimeSlotId=...
 *
 * Canteen workspace view — all MealOrders for a given calendar day, optionally
 * narrowed to one meal slot. Each row carries patient + ward + bed + meal so
 * the canteen can print labels / load the trolley.
 */
export const getKitchenList = async (req: Request, res: Response): Promise<void> => {
  try {
    const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const mealTimeSlotId = req.query.mealTimeSlotId as string | undefined;

    const dayStart = new Date(`${dateParam}T00:00:00`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999`);

    const where: Record<string, unknown> = {
      scheduledFor: { gte: dayStart, lte: dayEnd },
    };
    if (mealTimeSlotId) where.mealTimeSlotId = mealTimeSlotId;

    const orders = await prisma.mealOrder.findMany({
      where,
      include: {
        meal: true,
        mealTimeSlot: true,
        dietPlan: { include: { diet: true } },
        delivery: true,
        intake: true,
      },
      orderBy: [{ mealTimeSlot: { sequence: 'asc' } }, { wardId: 'asc' }],
    });

    // Hydrate patient + bed names — IpdAdmission isn't FK-related to MealOrder so
    // we join in-memory rather than adding another schema relation.
    const admissionIds = Array.from(new Set(orders.map((o) => o.admissionId)));
    const admissions = admissionIds.length
      ? await prisma.ipdAdmission.findMany({
          where: { id: { in: admissionIds } },
          select: {
            id: true, admissionNo: true, prn: true, department: true,
            ward: { select: { id: true, wardName: true } },
            bed: { select: { id: true, bedNumber: true } },
          },
        })
      : [];
    const admissionMap = new Map(admissions.map((a) => [a.id, a]));

    // PRN → patient name lookup. IpdAdmission.prn is a string but
    // PatientDetails.prn is Int; existing IPD code parses on the way in.
    const prnInts = Array.from(
      new Set(
        admissions
          .map((a) => Number.parseInt(a.prn ?? '', 10))
          .filter((n) => !Number.isNaN(n)),
      ),
    );
    const patients = prnInts.length
      ? await prisma.patientDetails.findMany({
          where: { prn: { in: prnInts } },
          select: { prn: true, name: true },
        })
      : [];
    const patientMap = new Map(patients.map((p) => [String(p.prn), p.name]));

    const hydrated = orders.map((o) => {
      const adm = admissionMap.get(o.admissionId);
      return {
        ...o,
        admissionNo: adm?.admissionNo ?? null,
        patientName: adm?.prn ? (patientMap.get(adm.prn) ?? null) : null,
        wardName: adm?.ward?.wardName ?? null,
        bedNumber: adm?.bed?.bedNumber ?? null,
        department: adm?.department ?? null,
      };
    });

    res.status(200).json(hydrated);
  } catch (error) {
    console.error('[dietetics] getKitchenList failed:', error);
    res.status(500).json({ error: 'Failed to load kitchen list' });
  }
};

/**
 * GET /api/dietetics/meal-orders/admission/:admissionId?date=YYYY-MM-DD
 *
 * Bedside view for the nurse — today's tray schedule for one admission.
 */
export const getForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateParam}T00:00:00`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999`);

    const orders = await prisma.mealOrder.findMany({
      where: { admissionId, scheduledFor: { gte: dayStart, lte: dayEnd } },
      include: { meal: true, mealTimeSlot: true, delivery: true, intake: true },
      orderBy: { mealTimeSlot: { sequence: 'asc' } },
    });
    res.status(200).json(orders);
  } catch (error) {
    console.error('[dietetics] getForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to load admission meal orders' });
  }
};

/**
 * GET /api/dietetics/meal-orders/tv/:channelId
 *
 * Canteen TV feed. Right now the channel record is just a name/isActive — view
 * selection is derived from time-of-day (closest upcoming or active meal slot).
 * Output is shaped for the TV component: grouped by ward, with bed + diet name.
 */
export const getTvSnapshot = async (req: Request, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId;
    const channel = await prisma.canteenChannel.findUnique({ where: { id: channelId } });
    if (!channel || !channel.isActive) {
      res.status(404).json({ error: 'Channel not found or inactive' });
      return;
    }

    // Pick the meal slot whose endTime hasn't passed yet today (or the next
    // upcoming one). Falls back to the first slot.
    const slots = await prisma.mealTimeSlot.findMany({
      where: { isActive: true },
      orderBy: { sequence: 'asc' },
    });
    if (slots.length === 0) {
      res.status(200).json({ channel, slot: null, groups: [] });
      return;
    }
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const active = slots.find((s) => s.startTime <= hhmm && s.endTime >= hhmm)
      ?? slots.find((s) => s.startTime >= hhmm)
      ?? slots[0];

    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);

    const orders = await prisma.mealOrder.findMany({
      where: {
        mealTimeSlotId: active.id,
        scheduledFor: { gte: dayStart, lte: dayEnd },
        status: { in: ['ORDERED', 'PLATED', 'DELIVERED'] },
      },
      include: { meal: true, dietPlan: { include: { diet: true } } },
    });

    const admissionIds = Array.from(new Set(orders.map((o) => o.admissionId)));
    const admissions = admissionIds.length
      ? await prisma.ipdAdmission.findMany({
          where: { id: { in: admissionIds } },
          select: {
            id: true, admissionNo: true, prn: true,
            ward: { select: { id: true, wardName: true } },
            bed: { select: { bedNumber: true } },
          },
        })
      : [];
    const admMap = new Map(admissions.map((a) => [a.id, a]));

    // Group by ward for the TV layout.
    const byWard: Record<string, { wardName: string; rows: unknown[] }> = {};
    for (const o of orders) {
      const adm = admMap.get(o.admissionId);
      if (!adm) continue;
      const key = adm.ward?.id ?? 'UNASSIGNED';
      const name = adm.ward?.wardName ?? 'Unassigned';
      if (!byWard[key]) byWard[key] = { wardName: name, rows: [] };
      byWard[key].rows.push({
        admissionNo: adm.admissionNo,
        bedNumber: adm.bed?.bedNumber ?? null,
        mealName: o.meal?.name ?? '—',
        dietName: o.dietPlan?.diet?.name ?? '—',
        status: o.status,
      });
    }

    res.status(200).json({ channel, slot: active, groups: Object.values(byWard) });
  } catch (error) {
    console.error('[dietetics] getTvSnapshot failed:', error);
    res.status(500).json({ error: 'Failed to load TV snapshot' });
  }
};

// ─── State transitions ──────────────────────────────────────────────

/**
 * POST /api/dietetics/meal-orders/plate
 * body: { ids: string[] }
 *
 * Bulk-plate from the canteen workspace. Idempotent — won't downgrade a row
 * already past PLATED.
 */
export const markPlated = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as PlateBody;
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      res.status(400).json({ error: 'ids array is required' });
      return;
    }
    const result = await prisma.mealOrder.updateMany({
      where: { id: { in: body.ids }, status: 'ORDERED' },
      data: {
        status: 'PLATED',
        platedAt: new Date(),
        platedBy: req.user?.username ?? null,
      },
    });
    res.status(200).json({ updated: result.count });
  } catch (error) {
    console.error('[dietetics] markPlated failed:', error);
    res.status(500).json({ error: 'Failed to mark plated' });
  }
};

/**
 * POST /api/dietetics/meal-orders/:id/deliver
 *
 * Creates the MealDelivery row + flips status to DELIVERED. Tray temps and
 * 2-ID verification are captured for HIC.4 evidence.
 */
export const markDelivered = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as DeliverBody;

    const existing = await prisma.mealOrder.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Meal order not found' }); return; }
    if (existing.status === 'DELIVERED' || existing.status === 'CONSUMED') {
      res.status(409).json({ error: `Already ${existing.status}` });
      return;
    }
    if (existing.status === 'SKIPPED') {
      res.status(409).json({ error: 'Cannot deliver a skipped order' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.mealDelivery.upsert({
        where: { mealOrderId: id },
        create: {
          mealOrderId: id,
          deliveredBy: req.user?.username ?? null,
          deliveredById: typeof req.user?.id === 'number' ? req.user.id : null,
          signatureId: body.signatureId ?? null,
          twoIdVerified: body.twoIdVerified ?? false,
          trayHotTempC: body.trayHotTempC ?? null,
          trayColdTempC: body.trayColdTempC ?? null,
          notes: body.notes ?? null,
        },
        update: {
          deliveredAt: new Date(),
          deliveredBy: req.user?.username ?? null,
          deliveredById: typeof req.user?.id === 'number' ? req.user.id : null,
          signatureId: body.signatureId ?? null,
          twoIdVerified: body.twoIdVerified ?? false,
          trayHotTempC: body.trayHotTempC ?? null,
          trayColdTempC: body.trayColdTempC ?? null,
          notes: body.notes ?? null,
        },
      });
      return tx.mealOrder.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          deliveredBy: req.user?.username ?? null,
        },
      });
    });

    await auditLog(req, {
      module: 'dietetics',
      action: 'STATUS_CHANGE',
      entityType: 'MealOrder',
      entityId: id,
      payload: { from: existing.status, to: 'DELIVERED', twoIdVerified: body.twoIdVerified ?? false },
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[dietetics] markDelivered failed:', error);
    res.status(500).json({ error: 'Failed to mark delivered' });
  }
};

/**
 * POST /api/dietetics/meal-orders/:id/intake
 *
 * Records % consumed and flips status to CONSUMED. Auto-sets negativeFlag if
 * < 50% — the dietetics queue picks this up as "needs reassessment".
 */
export const recordIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as IntakeBody;

    if (body.percentConsumed === undefined || body.percentConsumed === null) {
      res.status(400).json({ error: 'percentConsumed is required' });
      return;
    }
    const allowed = [0, 25, 50, 75, 100];
    if (!allowed.includes(body.percentConsumed)) {
      res.status(400).json({ error: `percentConsumed must be one of ${allowed.join(', ')}` });
      return;
    }

    const existing = await prisma.mealOrder.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Meal order not found' }); return; }
    if (existing.status === 'SKIPPED') {
      res.status(409).json({ error: 'Cannot record intake on a skipped order' });
      return;
    }

    const negativeFlag = body.percentConsumed < 50;

    const result = await prisma.$transaction(async (tx) => {
      await tx.mealIntake.upsert({
        where: { mealOrderId: id },
        create: {
          mealOrderId: id,
          percentConsumed: body.percentConsumed,
          complaint: body.complaint ?? null,
          notes: body.notes ?? null,
          negativeFlag,
          recordedBy: req.user?.username ?? null,
          recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
        update: {
          percentConsumed: body.percentConsumed,
          complaint: body.complaint ?? null,
          notes: body.notes ?? null,
          negativeFlag,
          recordedAt: new Date(),
          recordedBy: req.user?.username ?? null,
          recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
      });
      return tx.mealOrder.update({
        where: { id },
        data: { status: 'CONSUMED' },
      });
    });

    if (negativeFlag) {
      await auditLog(req, {
        module: 'dietetics',
        action: 'NEGATIVE_INTAKE',
        entityType: 'MealOrder',
        entityId: id,
        payload: { admissionId: existing.admissionId, percent: body.percentConsumed, complaint: body.complaint ?? null },
      });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('[dietetics] recordIntake failed:', error);
    res.status(500).json({ error: 'Failed to record intake' });
  }
};

/**
 * POST /api/dietetics/meal-orders/:id/skip
 *
 * Patient refused, transferred, NPO order issued, etc. Reason mandatory so
 * the dietician can read it in the queue and react.
 */
export const skipMeal = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as SkipBody;
    if (!body.reason?.trim()) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    const existing = await prisma.mealOrder.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Meal order not found' }); return; }
    if (existing.status === 'CONSUMED') {
      res.status(409).json({ error: 'Cannot skip a consumed order' });
      return;
    }

    const updated = await prisma.mealOrder.update({
      where: { id },
      data: { status: 'SKIPPED', skipReason: body.reason.trim() },
    });

    await auditLog(req, {
      module: 'dietetics',
      action: 'STATUS_CHANGE',
      entityType: 'MealOrder',
      entityId: id,
      payload: { from: existing.status, to: 'SKIPPED', reason: body.reason.trim() },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[dietetics] skipMeal failed:', error);
    res.status(500).json({ error: 'Failed to skip meal' });
  }
};

// ─── Canteen TV channel CRUD ────────────────────────────────────────

export const listCanteenChannels = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.canteenChannel.findMany({ orderBy: { createdAt: 'asc' } });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listCanteenChannels failed:', error);
    res.status(500).json({ error: 'Failed to list channels' });
  }
};

export const upsertCanteenChannel = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { name, isActive, viewSpec } = req.body ?? {};
    if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
    const data = {
      name: name.trim(),
      isActive: isActive ?? true,
      viewSpec: viewSpec ?? null,
    };
    const row = id
      ? await prisma.canteenChannel.update({ where: { id }, data })
      : await prisma.canteenChannel.create({ data });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertCanteenChannel failed:', error);
    res.status(500).json({ error: 'Failed to save channel' });
  }
};

// ─── Manual regenerate (admin tool) ─────────────────────────────────

/**
 * POST /api/dietetics/meal-orders/regenerate?date=YYYY-MM-DD
 *
 * Recomputes MealOrder rows for the given calendar date. Useful when the
 * dietician edits a plan after the nightly cron has run. Idempotent — uses
 * the (admission, mealTimeSlot, scheduledFor) unique key and skips dupes.
 *
 * The actual generation logic lives in `meal-order.cron.ts` so cron + manual
 * regenerate share the same code path.
 */
export const regenerateForDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const target = new Date(`${dateParam}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      res.status(400).json({ error: 'Invalid date — expected YYYY-MM-DD' });
      return;
    }
    const { generateOrdersForDate } = await import('./meal-order.cron');
    const count = await generateOrdersForDate(target);
    res.status(200).json({ generated: count, date: dateParam });
  } catch (error) {
    console.error('[dietetics] regenerateForDate failed:', error);
    res.status(500).json({
      error: 'Failed to regenerate',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
