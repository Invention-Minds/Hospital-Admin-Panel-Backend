import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * IPD Non-Drug Doctor Orders (Phase 7).
 *
 * Tracks orders that aren't drugs: diet, mobility, investigations,
 * procedures, consults, other. Three-state lifecycle:
 *   ORDERED (doctor signs) → ACKNOWLEDGED (nurse signs) → COMPLETED
 *
 * Each transition stamps actor + signature so the printed Doctors / Non
 * Drug Orders page has the full audit chain.
 */

const VALID_CATEGORIES = ['diet', 'mobility', 'investigation', 'procedure', 'consult', 'other'];
const VALID_STATUSES = ['ORDERED', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED'];

export const list = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const status = req.query.status as string | undefined;
    const where: Record<string, unknown> = { admissionId };
    if (status) where.status = status;
    const rows = await prisma.ipdNonDrugOrder.findMany({
      where,
      orderBy: { orderedAt: 'desc' },
      take: 500,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[non-drug-order] list failed:', error);
    res.status(500).json({ error: 'Failed to list non-drug orders' });
  }
};

interface CreateBody {
  orderText: string;
  category?: string | null;
  doctorName?: string;
  doctorSignatureId?: string | null;
}

export const create = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as CreateBody;
    if (!body.orderText?.trim()) {
      res.status(400).json({ error: 'orderText is required' });
      return;
    }
    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
      res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }

    const row = await prisma.ipdNonDrugOrder.create({
      data: {
        admissionId,
        orderText: body.orderText.trim(),
        category: body.category ?? null,
        doctorName: body.doctorName ?? req.user?.username ?? 'Unknown',
        doctorId: typeof req.user?.id === 'number' ? req.user.id : null,
        doctorSignatureId: body.doctorSignatureId ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'CREATE',
      entityType: 'IpdNonDrugOrder',
      entityId: row.id,
      payload: { admissionId, category: row.category, orderText: row.orderText.slice(0, 80) },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[non-drug-order] create failed:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

interface AcknowledgeBody {
  signatureId?: string | null;
  nurseName?: string;
}

export const acknowledge = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AcknowledgeBody;
    const existing = await prisma.ipdNonDrugOrder.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }
    if (existing.status !== 'ORDERED') {
      res.status(409).json({ error: `Order is ${existing.status}, can't acknowledge` });
      return;
    }
    const row = await prisma.ipdNonDrugOrder.update({
      where: { id },
      data: {
        acknowledgedByName: body.nurseName ?? req.user?.username ?? null,
        acknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
        acknowledgedSignatureId: body.signatureId ?? null,
        acknowledgedAt: new Date(),
        status: 'ACKNOWLEDGED',
      },
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdNonDrugOrder',
      entityId: id,
      payload: { from: 'ORDERED', to: 'ACKNOWLEDGED' },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[non-drug-order] acknowledge failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge order' });
  }
};

interface CompleteBody {
  completionNotes?: string | null;
  completedByName?: string;
}

export const complete = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as CompleteBody;
    const existing = await prisma.ipdNonDrugOrder.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      res.status(409).json({ error: `Order is ${existing.status}, can't complete` });
      return;
    }
    const row = await prisma.ipdNonDrugOrder.update({
      where: { id },
      data: {
        completedByName: body.completedByName ?? req.user?.username ?? null,
        completedById: typeof req.user?.id === 'number' ? req.user.id : null,
        completedAt: new Date(),
        completionNotes: body.completionNotes ?? null,
        status: 'COMPLETED',
      },
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdNonDrugOrder',
      entityId: id,
      payload: { from: existing.status, to: 'COMPLETED' },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[non-drug-order] complete failed:', error);
    res.status(500).json({ error: 'Failed to complete order' });
  }
};

export const cancel = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.ipdNonDrugOrder.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }
    if (existing.status === 'COMPLETED') {
      res.status(409).json({ error: 'Completed orders cannot be cancelled' });
      return;
    }
    const row = await prisma.ipdNonDrugOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdNonDrugOrder',
      entityId: id,
      payload: { from: existing.status, to: 'CANCELLED' },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[non-drug-order] cancel failed:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
};
