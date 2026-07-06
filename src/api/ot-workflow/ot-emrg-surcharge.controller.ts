import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.5a — Emergency Surgery Charges (Emrg Surgery Charges in reference HMIS).
//
// CRUD over EmrgSurgerySurcharge rows for an OT schedule. Surcharge total is
// computed server-side as (baseAmount * percent / 100) + flatAmount so the
// UI cannot send a tampered totalAmount. "Apply to estimation" posts a
// matching EstimationSurgeryLine with role='other' and ties the two rows
// via estimationLineId.

const VALID_TYPES = [
  'after-hours',
  'weekend',
  'holiday',
  'staff-callback',
  'equipment-setup',
  'custom',
];

interface UpsertBody {
  surchargeType?: string;
  reason?: string | null;
  baseAmount?: number;
  percent?: number;
  flatAmount?: number;
}

function computeTotal(baseAmount: number, percent: number, flatAmount: number): number {
  const pct = isFinite(percent) ? percent : 0;
  const flat = isFinite(flatAmount) ? flatAmount : 0;
  const base = isFinite(baseAmount) ? baseAmount : 0;
  return Math.round(((base * pct) / 100 + flat) * 100) / 100;
}

export const listEmrgSurcharges = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const rows = await prisma.emrgSurgerySurcharge.findMany({
      where: { scheduleId },
      orderBy: { createdAt: 'asc' },
    });
    const grandTotal = rows.reduce((a, b) => a + (b.totalAmount || 0), 0);
    res.status(200).json({ data: rows, meta: { grandTotal, count: rows.length } });
  } catch (error) {
    console.error('[ot-emrg-surcharge] list failed:', error);
    res.status(500).json({ message: 'Failed to load emergency surcharges' });
  }
};

export const addEmrgSurcharge = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const body = req.body as UpsertBody;
    if (!body.surchargeType || !VALID_TYPES.includes(body.surchargeType)) {
      res.status(400).json({ message: `surchargeType must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    const schedule = await prisma.otSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) { res.status(404).json({ message: 'OT schedule not found' }); return; }

    const baseAmount = Number(body.baseAmount ?? 0);
    const percent = Number(body.percent ?? 0);
    const flatAmount = Number(body.flatAmount ?? 0);
    const totalAmount = computeTotal(baseAmount, percent, flatAmount);

    const row = await prisma.emrgSurgerySurcharge.create({
      data: {
        scheduleId,
        surchargeType: body.surchargeType,
        reason: body.reason ?? null,
        baseAmount,
        percent,
        flatAmount,
        totalAmount,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'ot',
      action: 'CREATE',
      entityType: 'EmrgSurgerySurcharge',
      entityId: row.id,
      payload: { scheduleId, surchargeType: row.surchargeType, totalAmount: row.totalAmount },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-emrg-surcharge] add failed:', error);
    res.status(500).json({ message: 'Failed to add emergency surcharge' });
  }
};

export const updateEmrgSurcharge = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.emrgSurgerySurcharge.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Surcharge row not found' }); return; }
    if (existing.appliedToEstimation) {
      res.status(409).json({ message: 'Surcharge already applied to estimation — remove the line first' });
      return;
    }
    const body = req.body as UpsertBody;
    if (body.surchargeType && !VALID_TYPES.includes(body.surchargeType)) {
      res.status(400).json({ message: `surchargeType must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    const baseAmount = Number(body.baseAmount ?? existing.baseAmount);
    const percent = Number(body.percent ?? existing.percent);
    const flatAmount = Number(body.flatAmount ?? existing.flatAmount);
    const totalAmount = computeTotal(baseAmount, percent, flatAmount);

    const row = await prisma.emrgSurgerySurcharge.update({
      where: { id },
      data: {
        ...(body.surchargeType !== undefined && { surchargeType: body.surchargeType }),
        ...(body.reason !== undefined && { reason: body.reason }),
        baseAmount,
        percent,
        flatAmount,
        totalAmount,
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-emrg-surcharge] update failed:', error);
    res.status(500).json({ message: 'Failed to update emergency surcharge' });
  }
};

export const removeEmrgSurcharge = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.emrgSurgerySurcharge.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Surcharge row not found' }); return; }
    if (existing.appliedToEstimation && existing.estimationLineId) {
      await prisma.estimationSurgeryLine.delete({ where: { id: existing.estimationLineId } }).catch(() => null);
    }
    await prisma.emrgSurgerySurcharge.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    console.error('[ot-emrg-surcharge] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove emergency surcharge' });
  }
};

// Posts the surcharge as an EstimationSurgeryLine so it shows up on the
// final bill. Idempotent — re-calling on an already-applied row no-ops.
export const applyEmrgSurchargeToEstimation = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const row = await prisma.emrgSurgerySurcharge.findUnique({ where: { id } });
    if (!row) { res.status(404).json({ message: 'Surcharge row not found' }); return; }
    if (row.appliedToEstimation) { res.status(200).json({ data: row, message: 'Already applied' }); return; }

    const schedule = await prisma.otSchedule.findUnique({ where: { id: row.scheduleId } });
    if (!schedule?.estimationId) {
      res.status(409).json({ message: 'OT schedule has no linked estimation — cannot post surcharge line' });
      return;
    }

    const line = await prisma.estimationSurgeryLine.create({
      data: {
        estimationId: schedule.estimationId,
        surgeryName: schedule.procedureName,
        departmentName: null,
        categoryCode: null,
        role: 'other',
        serviceCode: `EMRG-${row.surchargeType.toUpperCase()}`,
        serviceName: `Emergency Surcharge — ${row.surchargeType.replace(/-/g, ' ')}`,
        renderedBy: null,
        rate: row.totalAmount,
        quantity: 1,
        discountPercent: 0,
        discountReason: row.reason ?? null,
        adjustmentAmount: 0,
        adjustmentReason: null,
        createdBy: req.user?.username ?? null,
      },
    });

    const updated = await prisma.emrgSurgerySurcharge.update({
      where: { id },
      data: { appliedToEstimation: true, estimationLineId: line.id },
    });
    await auditLog(req, {
      module: 'ot',
      action: 'UPDATE',
      entityType: 'EmrgSurgerySurcharge',
      entityId: id,
      payload: { action: 'apply-to-estimation', estimationLineId: line.id, totalAmount: row.totalAmount },
    });
    res.status(200).json({ data: updated, estimationLine: line });
  } catch (error) {
    console.error('[ot-emrg-surcharge] apply failed:', error);
    res.status(500).json({ message: 'Failed to apply surcharge to estimation' });
  }
};
