import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.5e — OT Setup admin controllers.
//
// Two masters:
//   * OtEquipmentMaster — admin-curated equipment list
//   * FixedSurgicalNote — pre-set fixed surgical note categories
//
// Standard CRUD; soft delete via isActive.

// ─── Equipment Master ──────────────────────────────────────────────────

export const listEquipmentMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const category = req.query.category as string | undefined;
    const rows = await prisma.otEquipmentMaster.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(category && { category }),
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-setup] listEquipmentMaster failed:', error);
    res.status(500).json({ message: 'Failed to list equipment master' });
  }
};

interface EquipmentBody {
  name?: string;
  code?: string | null;
  category?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export const createEquipmentMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as EquipmentBody;
    if (!body.name?.trim()) { res.status(400).json({ message: 'name is required' }); return; }
    const row = await prisma.otEquipmentMaster.create({
      data: {
        name: body.name.trim(),
        code: body.code?.trim() || null,
        category: body.category?.trim() || null,
        description: body.description ?? null,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, { module: 'ot', action: 'CREATE', entityType: 'OtEquipmentMaster', entityId: String(row.id), payload: { name: row.name } });
    res.status(201).json({ data: row });
  } catch (error) {
    const msg = (error as Error).message ?? '';
    if (msg.includes('Unique constraint')) { res.status(409).json({ message: 'Equipment with this name or code already exists' }); return; }
    console.error('[ot-setup] createEquipmentMaster failed:', error);
    res.status(500).json({ message: 'Failed to create equipment' });
  }
};

export const updateEquipmentMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const body = req.body as EquipmentBody;
    const row = await prisma.otEquipmentMaster.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.code !== undefined && { code: body.code?.trim() || null }),
        ...(body.category !== undefined && { category: body.category?.trim() || null }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup] updateEquipmentMaster failed:', error);
    res.status(500).json({ message: 'Failed to update equipment' });
  }
};

export const removeEquipmentMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    // Soft delete — flip isActive=false so historical usages keep referencing
    // a name that still exists in the master.
    const row = await prisma.otEquipmentMaster.update({
      where: { id },
      data: { isActive: false },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup] removeEquipmentMaster failed:', error);
    res.status(500).json({ message: 'Failed to remove equipment' });
  }
};

// ─── Fixed Surgical Note Master ────────────────────────────────────────

export const listFixedSurgicalNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
    const rows = await prisma.fixedSurgicalNote.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(departmentId !== undefined && { departmentId }),
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-setup] listFixedSurgicalNotes failed:', error);
    res.status(500).json({ message: 'Failed to list fixed surgical notes' });
  }
};

interface FixedNoteBody {
  code?: string;
  name?: string;
  departmentId?: number | null;
  body?: string;
  isActive?: boolean;
}

export const createFixedSurgicalNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as FixedNoteBody;
    if (!body.code?.trim() || !body.name?.trim() || !body.body?.trim()) {
      res.status(400).json({ message: 'code, name and body are required' });
      return;
    }
    const row = await prisma.fixedSurgicalNote.create({
      data: {
        code: body.code.trim(),
        name: body.name.trim(),
        departmentId: body.departmentId ?? null,
        body: body.body,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    const msg = (error as Error).message ?? '';
    if (msg.includes('Unique constraint')) { res.status(409).json({ message: 'A fixed note with this code already exists' }); return; }
    console.error('[ot-setup] createFixedSurgicalNote failed:', error);
    res.status(500).json({ message: 'Failed to create fixed surgical note' });
  }
};

export const updateFixedSurgicalNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const body = req.body as FixedNoteBody;
    const row = await prisma.fixedSurgicalNote.update({
      where: { id },
      data: {
        ...(body.code !== undefined && { code: body.code.trim() }),
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.body !== undefined && { body: body.body }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup] updateFixedSurgicalNote failed:', error);
    res.status(500).json({ message: 'Failed to update fixed surgical note' });
  }
};

export const removeFixedSurgicalNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.fixedSurgicalNote.update({
      where: { id },
      data: { isActive: false },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup] removeFixedSurgicalNote failed:', error);
    res.status(500).json({ message: 'Failed to remove fixed surgical note' });
  }
};
