import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.1a — Multi-staff + multi-surgery per OtSchedule.
//
// Mirrors the reference HMIS dialogs:
//   * "Enter Surgeon" — role + primary flag (Surgeon / Co-Surgeon /
//     Assistant Surgeon / Anaesthetist / Scrub Nurse / Floor Nurse /
//     Technician / Runner)
//   * "Enter Surgery" — Department / Category / Surgery / Type + the
//     "Primary Surgery for Visit" checkbox
//
// Existing OtSchedule.surgeonId / anaesthesiologistId / scrubNurseId /
// runnerId columns stay as a denormalised snapshot of the primary
// person per role — readers can migrate to OtScheduleStaff over time.

const VALID_ROLES = [
  'surgeon', 'co-surgeon', 'assistant-surgeon',
  'anaesthetist', 'scrub-nurse', 'floor-nurse',
  'runner', 'technician',
];

// ─── OtScheduleStaff ────────────────────────────────────────────────────

interface AddStaffBody {
  staffId?: number | null;
  staffName: string;
  role: string;
  isPrimary?: boolean;
  surgeryId?: number | null;
}

export const listStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.otScheduleStaff.findMany({
      where: { scheduleId: req.params.scheduleId },
      orderBy: [{ role: 'asc' }, { isPrimary: 'desc' }, { id: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-staff] list failed:', error);
    res.status(500).json({ message: 'Failed to list staff' });
  }
};

export const addStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as AddStaffBody;
    if (!body.staffName?.trim() || !body.role) {
      res.status(400).json({ message: 'staffName and role are required' });
      return;
    }
    if (!VALID_ROLES.includes(body.role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    // If this row is being marked primary, demote any existing primary
    // in the same role for this schedule. Keeps "one primary per role"
    // as the de-facto invariant without enforcing it at the schema level.
    if (body.isPrimary) {
      await prisma.otScheduleStaff.updateMany({
        where: { scheduleId: req.params.scheduleId, role: body.role, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const row = await prisma.otScheduleStaff.create({
      data: {
        scheduleId: req.params.scheduleId,
        staffId: body.staffId ?? null,
        staffName: body.staffName.trim(),
        role: body.role,
        isPrimary: body.isPrimary ?? false,
        surgeryId: body.surgeryId ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-staff] add failed:', error);
    res.status(500).json({ message: 'Failed to add staff' });
  }
};

export const updateStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    const body = req.body as Partial<AddStaffBody>;
    if (body.role && !VALID_ROLES.includes(body.role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    if (body.isPrimary === true) {
      const existing = await prisma.otScheduleStaff.findUnique({ where: { id: rowId } });
      if (existing) {
        await prisma.otScheduleStaff.updateMany({
          where: { scheduleId: existing.scheduleId, role: body.role ?? existing.role, isPrimary: true, NOT: { id: rowId } },
          data: { isPrimary: false },
        });
      }
    }
    const row = await prisma.otScheduleStaff.update({
      where: { id: rowId },
      data: {
        ...(body.staffId !== undefined && { staffId: body.staffId }),
        ...(body.staffName && { staffName: body.staffName }),
        ...(body.role && { role: body.role }),
        ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary }),
        ...(body.surgeryId !== undefined && { surgeryId: body.surgeryId }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-staff] update failed:', error);
    res.status(500).json({ message: 'Failed to update staff' });
  }
};

export const removeStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.otScheduleStaff.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[ot-staff] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove staff' });
  }
};

// ─── OtScheduleSurgery ──────────────────────────────────────────────────

interface AddSurgeryBody {
  departmentId?: number | null;
  departmentName?: string | null;
  categoryCode?: string | null;
  surgeryName: string;
  surgeryCode?: string | null;
  surgeryType?: string | null;
  isPrimary?: boolean;
}

export const listSurgeries = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.otScheduleSurgery.findMany({
      where: { scheduleId: req.params.scheduleId },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-surgery] list failed:', error);
    res.status(500).json({ message: 'Failed to list surgeries' });
  }
};

export const addSurgery = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as AddSurgeryBody;
    if (!body.surgeryName?.trim()) {
      res.status(400).json({ message: 'surgeryName is required' });
      return;
    }
    if (body.isPrimary) {
      await prisma.otScheduleSurgery.updateMany({
        where: { scheduleId: req.params.scheduleId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const row = await prisma.otScheduleSurgery.create({
      data: {
        scheduleId: req.params.scheduleId,
        departmentId: body.departmentId ?? null,
        departmentName: body.departmentName ?? null,
        categoryCode: body.categoryCode ?? null,
        surgeryName: body.surgeryName.trim(),
        surgeryCode: body.surgeryCode ?? null,
        surgeryType: body.surgeryType ?? null,
        isPrimary: body.isPrimary ?? false,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-surgery] add failed:', error);
    res.status(500).json({ message: 'Failed to add surgery' });
  }
};

export const updateSurgery = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    const body = req.body as Partial<AddSurgeryBody>;
    if (body.isPrimary === true) {
      const existing = await prisma.otScheduleSurgery.findUnique({ where: { id: rowId } });
      if (existing) {
        await prisma.otScheduleSurgery.updateMany({
          where: { scheduleId: existing.scheduleId, isPrimary: true, NOT: { id: rowId } },
          data: { isPrimary: false },
        });
      }
    }
    const row = await prisma.otScheduleSurgery.update({
      where: { id: rowId },
      data: {
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.departmentName !== undefined && { departmentName: body.departmentName }),
        ...(body.categoryCode !== undefined && { categoryCode: body.categoryCode }),
        ...(body.surgeryName && { surgeryName: body.surgeryName }),
        ...(body.surgeryCode !== undefined && { surgeryCode: body.surgeryCode }),
        ...(body.surgeryType !== undefined && { surgeryType: body.surgeryType }),
        ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-surgery] update failed:', error);
    res.status(500).json({ message: 'Failed to update surgery' });
  }
};

export const removeSurgery = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.otScheduleSurgery.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[ot-surgery] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove surgery' });
  }
};
