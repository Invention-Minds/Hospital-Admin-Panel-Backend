import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.4c — per-role surgery billing lines on an estimation.
//
// Mirrors the reference HMIS "Order Surgeries" screen. Lines hang off
// EstimationDetails.estimationId via a soft FK (no formal Prisma
// relation — same pattern OtSchedule.estimationId already uses).

const VALID_ROLES = [
  'surgeon', 'co-surgeon', 'assistant-surgeon', 'anaesthetist',
  'ot-rent', 'other',
];

interface LineBody {
  surgeryName: string;
  departmentName?: string | null;
  categoryCode?: string | null;
  role: string;
  serviceCode?: string | null;
  serviceName: string;
  renderedBy?: string | null;
  rate?: number;
  quantity?: number;
  discountPercent?: number;
  discountReason?: string | null;
  adjustmentAmount?: number;
  adjustmentReason?: string | null;
}

export const listSurgeryLines = async (req: Request, res: Response): Promise<void> => {
  try {
    const estimationId = req.params.estimationId;
    const rows = await prisma.estimationSurgeryLine.findMany({
      where: { estimationId },
      orderBy: [{ surgeryName: 'asc' }, { role: 'asc' }, { id: 'asc' }],
    });
    // Compute the line subtotal client-side too, but include a server roll-up.
    const subtotal = rows.reduce((sum, r) => {
      const gross = (r.rate || 0) * (r.quantity || 1);
      const afterDiscount = gross - gross * ((r.discountPercent || 0) / 100);
      return sum + afterDiscount + (r.adjustmentAmount || 0);
    }, 0);
    res.status(200).json({ data: rows, subtotal: Math.round(subtotal * 100) / 100 });
  } catch (error) {
    console.error('[estimation-surgery-line] list failed:', error);
    res.status(500).json({ message: 'Failed to list surgery lines' });
  }
};

export const addSurgeryLine = async (req: Request, res: Response): Promise<void> => {
  try {
    const estimationId = req.params.estimationId;
    const body = req.body as LineBody;
    if (!body.surgeryName?.trim() || !body.role || !body.serviceName?.trim()) {
      res.status(400).json({ message: 'surgeryName, role and serviceName are required' });
      return;
    }
    if (!VALID_ROLES.includes(body.role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    const row = await prisma.estimationSurgeryLine.create({
      data: {
        estimationId,
        surgeryName: body.surgeryName.trim(),
        departmentName: body.departmentName ?? null,
        categoryCode: body.categoryCode ?? null,
        role: body.role,
        serviceCode: body.serviceCode ?? null,
        serviceName: body.serviceName.trim(),
        renderedBy: body.renderedBy ?? null,
        rate: body.rate ?? 0,
        quantity: body.quantity ?? 1,
        discountPercent: body.discountPercent ?? 0,
        discountReason: body.discountReason ?? null,
        adjustmentAmount: body.adjustmentAmount ?? 0,
        adjustmentReason: body.adjustmentReason ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[estimation-surgery-line] add failed:', error);
    res.status(500).json({ message: 'Failed to add surgery line' });
  }
};

export const updateSurgeryLine = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const body = req.body as Partial<LineBody>;
    if (body.role && !VALID_ROLES.includes(body.role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    const row = await prisma.estimationSurgeryLine.update({
      where: { id },
      data: {
        ...(body.surgeryName && { surgeryName: body.surgeryName }),
        ...(body.departmentName !== undefined && { departmentName: body.departmentName }),
        ...(body.categoryCode !== undefined && { categoryCode: body.categoryCode }),
        ...(body.role && { role: body.role }),
        ...(body.serviceCode !== undefined && { serviceCode: body.serviceCode }),
        ...(body.serviceName && { serviceName: body.serviceName }),
        ...(body.renderedBy !== undefined && { renderedBy: body.renderedBy }),
        ...(body.rate !== undefined && { rate: body.rate }),
        ...(body.quantity !== undefined && { quantity: body.quantity }),
        ...(body.discountPercent !== undefined && { discountPercent: body.discountPercent }),
        ...(body.discountReason !== undefined && { discountReason: body.discountReason }),
        ...(body.adjustmentAmount !== undefined && { adjustmentAmount: body.adjustmentAmount }),
        ...(body.adjustmentReason !== undefined && { adjustmentReason: body.adjustmentReason }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[estimation-surgery-line] update failed:', error);
    res.status(500).json({ message: 'Failed to update surgery line' });
  }
};

export const removeSurgeryLine = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    await prisma.estimationSurgeryLine.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    console.error('[estimation-surgery-line] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove surgery line' });
  }
};
