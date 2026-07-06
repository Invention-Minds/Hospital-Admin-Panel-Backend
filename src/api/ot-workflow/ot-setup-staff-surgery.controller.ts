import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.5j — OT Staff + Surgery/Procedure master admin controllers.
//
// Both follow the same shape: list / create / update / soft-delete.
// Soft delete flips isActive=false so historical rows that snapshot the
// name keep referencing a row that still exists in the master.

// ─── Staff Master ──────────────────────────────────────────────────────

const VALID_STAFF_ROLES = [
  'scrub-nurse', 'floor-nurse', 'runner',
  'ot-technician', 'anaesthesia-technician',
  'cssd', 'biomedical', 'other',
];

export const listStaffMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const role = req.query.role as string | undefined;
    const rows = await prisma.otStaffMaster.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(role && { role }),
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-setup-staff] list failed:', error);
    res.status(500).json({ message: 'Failed to list staff master' });
  }
};

interface StaffBody {
  name?: string;
  employeeCode?: string | null;
  role?: string;
  designation?: string | null;
  departmentId?: number | null;
  isActive?: boolean;
}

export const createStaffMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as StaffBody;
    if (!body.name?.trim()) { res.status(400).json({ message: 'name is required' }); return; }
    if (!body.role || !VALID_STAFF_ROLES.includes(body.role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_STAFF_ROLES.join(', ')}` });
      return;
    }
    const row = await prisma.otStaffMaster.create({
      data: {
        name: body.name.trim(),
        employeeCode: body.employeeCode?.trim() || null,
        role: body.role,
        designation: body.designation?.trim() || null,
        departmentId: body.departmentId ?? null,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, { module: 'ot', action: 'CREATE', entityType: 'OtStaffMaster', entityId: String(row.id), payload: { name: row.name, role: row.role } });
    res.status(201).json({ data: row });
  } catch (error) {
    const msg = (error as Error).message ?? '';
    if (msg.includes('Unique constraint')) { res.status(409).json({ message: 'Employee code already exists' }); return; }
    console.error('[ot-setup-staff] create failed:', error);
    res.status(500).json({ message: 'Failed to create staff' });
  }
};

export const updateStaffMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const body = req.body as StaffBody;
    if (body.role && !VALID_STAFF_ROLES.includes(body.role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_STAFF_ROLES.join(', ')}` });
      return;
    }
    const row = await prisma.otStaffMaster.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.employeeCode !== undefined && { employeeCode: body.employeeCode?.trim() || null }),
        ...(body.role !== undefined && { role: body.role }),
        ...(body.designation !== undefined && { designation: body.designation?.trim() || null }),
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup-staff] update failed:', error);
    res.status(500).json({ message: 'Failed to update staff' });
  }
};

export const removeStaffMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.otStaffMaster.update({ where: { id }, data: { isActive: false } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup-staff] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove staff' });
  }
};

// ─── Surgery / Procedure Master ────────────────────────────────────────

export const listSurgeryMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
    const rows = await prisma.surgeryProcedureMaster.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(departmentId !== undefined && { departmentId }),
      },
      orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-setup-surgery] list failed:', error);
    res.status(500).json({ message: 'Failed to list surgery master' });
  }
};

interface SurgeryBody {
  name?: string;
  code?: string | null;
  departmentId?: number | null;
  categoryCode?: string | null;
  surgeryType?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export const createSurgeryMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as SurgeryBody;
    if (!body.name?.trim()) { res.status(400).json({ message: 'name is required' }); return; }
    const row = await prisma.surgeryProcedureMaster.create({
      data: {
        name: body.name.trim(),
        code: body.code?.trim() || null,
        departmentId: body.departmentId ?? null,
        categoryCode: body.categoryCode?.trim() || null,
        surgeryType: body.surgeryType?.trim() || null,
        description: body.description ?? null,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, { module: 'ot', action: 'CREATE', entityType: 'SurgeryProcedureMaster', entityId: String(row.id), payload: { name: row.name } });
    res.status(201).json({ data: row });
  } catch (error) {
    const msg = (error as Error).message ?? '';
    if (msg.includes('Unique constraint')) { res.status(409).json({ message: 'Surgery code already exists' }); return; }
    console.error('[ot-setup-surgery] create failed:', error);
    res.status(500).json({ message: 'Failed to create surgery' });
  }
};

export const updateSurgeryMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const body = req.body as SurgeryBody;
    const row = await prisma.surgeryProcedureMaster.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.code !== undefined && { code: body.code?.trim() || null }),
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.categoryCode !== undefined && { categoryCode: body.categoryCode?.trim() || null }),
        ...(body.surgeryType !== undefined && { surgeryType: body.surgeryType?.trim() || null }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup-surgery] update failed:', error);
    res.status(500).json({ message: 'Failed to update surgery' });
  }
};

export const removeSurgeryMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.surgeryProcedureMaster.update({ where: { id }, data: { isActive: false } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-setup-surgery] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove surgery' });
  }
};
