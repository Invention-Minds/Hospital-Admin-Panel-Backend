import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.1b — OT Equipment usage + Consumables management.
//
// Two parallel resources hanging off /api/ot/schedules/:scheduleId:
//   * equipment usage (with usedMinutes — drives Equipment Utilization)
//   * consumable issues (issue / return ledger from pharmacy → OT)
//
// Plus consumable-set master CRUD (department-scoped kits like
// "Ortho TKR kit", "Inguinal Hernia Mesh Repair kit").

// ─── OtEquipmentUsage ──────────────────────────────────────────────────

interface EquipmentBody {
  surgeryId?: number | null;
  equipmentName: string;
  equipmentCode?: string | null;
  usedMinutes?: number;
  notes?: string | null;
}

export const listEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.otEquipmentUsage.findMany({
      where: { scheduleId: req.params.scheduleId },
      orderBy: { id: 'asc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-equipment] list failed:', error);
    res.status(500).json({ message: 'Failed to list equipment usage' });
  }
};

export const addEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as EquipmentBody;
    if (!body.equipmentName?.trim()) {
      res.status(400).json({ message: 'equipmentName is required' });
      return;
    }
    const row = await prisma.otEquipmentUsage.create({
      data: {
        scheduleId: req.params.scheduleId,
        surgeryId: body.surgeryId ?? null,
        equipmentName: body.equipmentName.trim(),
        equipmentCode: body.equipmentCode ?? null,
        usedMinutes: body.usedMinutes ?? 0,
        notes: body.notes ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-equipment] add failed:', error);
    res.status(500).json({ message: 'Failed to add equipment usage' });
  }
};

export const updateEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    const body = req.body as Partial<EquipmentBody>;
    const row = await prisma.otEquipmentUsage.update({
      where: { id: rowId },
      data: {
        ...(body.surgeryId !== undefined && { surgeryId: body.surgeryId }),
        ...(body.equipmentName && { equipmentName: body.equipmentName }),
        ...(body.equipmentCode !== undefined && { equipmentCode: body.equipmentCode }),
        ...(body.usedMinutes !== undefined && { usedMinutes: body.usedMinutes }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-equipment] update failed:', error);
    res.status(500).json({ message: 'Failed to update equipment usage' });
  }
};

export const removeEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.otEquipmentUsage.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[ot-equipment] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove equipment usage' });
  }
};

// ─── OtConsumableSet (master) ──────────────────────────────────────────

interface ConsumableSetBody {
  name: string;
  departmentId?: number | null;
  description?: string | null;
  isActive?: boolean;
}

interface ConsumableSetItemBody {
  tabletMasterId?: number | null;
  itemName: string;
  defaultQuantity?: number;
  uom?: string | null;
}

export const listConsumableSets = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeItems = req.query.includeItems === '1' || req.query.includeItems === 'true';
    const departmentId = req.query.departmentId ? parseInt(String(req.query.departmentId), 10) : undefined;
    const rows = await prisma.otConsumableSet.findMany({
      where: {
        ...(departmentId !== undefined && !Number.isNaN(departmentId) && { departmentId }),
      },
      orderBy: { name: 'asc' },
      include: includeItems ? { items: true } : undefined,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-consumable-set] list failed:', error);
    res.status(500).json({ message: 'Failed to list consumable sets' });
  }
};

export const getConsumableSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const row = await prisma.otConsumableSet.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!row) { res.status(404).json({ message: 'Set not found' }); return; }
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-consumable-set] get failed:', error);
    res.status(500).json({ message: 'Failed to load consumable set' });
  }
};

export const createConsumableSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as ConsumableSetBody & { items?: ConsumableSetItemBody[] };
    if (!body.name?.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    const row = await prisma.otConsumableSet.create({
      data: {
        name: body.name.trim(),
        departmentId: body.departmentId ?? null,
        description: body.description ?? null,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
        items: body.items?.length ? {
          create: body.items.map((it) => ({
            tabletMasterId: it.tabletMasterId ?? null,
            itemName: it.itemName,
            defaultQuantity: it.defaultQuantity ?? 1,
            uom: it.uom ?? null,
          })),
        } : undefined,
      },
      include: { items: true },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-consumable-set] create failed:', error);
    res.status(500).json({ message: 'Failed to create consumable set' });
  }
};

export const updateConsumableSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const body = req.body as Partial<ConsumableSetBody>;
    const row = await prisma.otConsumableSet.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-consumable-set] update failed:', error);
    res.status(500).json({ message: 'Failed to update consumable set' });
  }
};

export const addConsumableSetItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const setId = parseInt(req.params.id, 10);
    if (Number.isNaN(setId)) { res.status(400).json({ message: 'Invalid set id' }); return; }
    const body = req.body as ConsumableSetItemBody;
    if (!body.itemName?.trim()) {
      res.status(400).json({ message: 'itemName is required' });
      return;
    }
    const row = await prisma.otConsumableSetItem.create({
      data: {
        setId,
        tabletMasterId: body.tabletMasterId ?? null,
        itemName: body.itemName.trim(),
        defaultQuantity: body.defaultQuantity ?? 1,
        uom: body.uom ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-consumable-set-item] add failed:', error);
    res.status(500).json({ message: 'Failed to add item' });
  }
};

export const removeConsumableSetItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const itemId = parseInt(req.params.itemId, 10);
    if (Number.isNaN(itemId)) { res.status(400).json({ message: 'Invalid item id' }); return; }
    await prisma.otConsumableSetItem.delete({ where: { id: itemId } });
    res.status(204).end();
  } catch (error) {
    console.error('[ot-consumable-set-item] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove item' });
  }
};

// ─── OtConsumableIssue (per-schedule ledger) ───────────────────────────

interface ConsumableIssueBody {
  setId?: number | null;
  tabletMasterId?: number | null;
  itemName: string;
  quantity: number;
  uom?: string | null;
  itemRemarks?: string | null;
  pharmacyStore?: string | null;
  prescribedBy?: string | null;
}

export const listConsumableIssues = async (req: Request, res: Response): Promise<void> => {
  try {
    const direction = req.query.direction as string | undefined;
    const rows = await prisma.otConsumableIssue.findMany({
      where: {
        scheduleId: req.params.scheduleId,
        ...(direction && { direction }),
      },
      orderBy: { issuedAt: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-consumable-issue] list failed:', error);
    res.status(500).json({ message: 'Failed to list consumable ledger' });
  }
};

// Issue multiple items in one call (e.g. when a set is selected) — body
// is an array of items. Returns the created rows. Direction is fixed to
// 'issued' here; returns use the separate /return endpoint.
export const issueConsumables = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { items: ConsumableIssueBody[] };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ message: 'items array is required' });
      return;
    }
    const scheduleId = req.params.scheduleId;
    const created = await prisma.$transaction(
      body.items.map((it) =>
        prisma.otConsumableIssue.create({
          data: {
            scheduleId,
            setId: it.setId ?? null,
            tabletMasterId: it.tabletMasterId ?? null,
            itemName: it.itemName,
            quantity: it.quantity,
            uom: it.uom ?? null,
            itemRemarks: it.itemRemarks ?? null,
            pharmacyStore: it.pharmacyStore ?? null,
            prescribedBy: it.prescribedBy ?? req.user?.username ?? null,
            prescribedById: typeof req.user?.id === 'number' ? req.user.id : null,
            direction: 'issued',
            createdBy: req.user?.username ?? null,
          },
        })
      )
    );
    res.status(201).json({ data: created });
  } catch (error) {
    console.error('[ot-consumable-issue] issue failed:', error);
    res.status(500).json({ message: 'Failed to issue consumables' });
  }
};

// Mark items as returned (post-op leftover) — we don't deduct from the
// issue row, we add a separate 'returned' row so the audit chain stays
// intact. Reconciliation uses the SUM of issued - returned per item.
export const returnConsumables = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { items: ConsumableIssueBody[] };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ message: 'items array is required' });
      return;
    }
    const scheduleId = req.params.scheduleId;
    const created = await prisma.$transaction(
      body.items.map((it) =>
        prisma.otConsumableIssue.create({
          data: {
            scheduleId,
            setId: it.setId ?? null,
            tabletMasterId: it.tabletMasterId ?? null,
            itemName: it.itemName,
            quantity: it.quantity,
            uom: it.uom ?? null,
            itemRemarks: it.itemRemarks ?? null,
            pharmacyStore: it.pharmacyStore ?? null,
            prescribedBy: it.prescribedBy ?? req.user?.username ?? null,
            prescribedById: typeof req.user?.id === 'number' ? req.user.id : null,
            direction: 'returned',
            createdBy: req.user?.username ?? null,
          },
        })
      )
    );
    res.status(201).json({ data: created });
  } catch (error) {
    console.error('[ot-consumable-issue] return failed:', error);
    res.status(500).json({ message: 'Failed to return consumables' });
  }
};

export const removeConsumableIssue = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.otConsumableIssue.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[ot-consumable-issue] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove consumable issue' });
  }
};
