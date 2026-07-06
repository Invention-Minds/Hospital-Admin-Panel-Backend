import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { NURSE, NURSE_SUBTYPES, isNurse } from '../_shared/nursing-roles';

// Phase 9.10 — Nurse / clinical-staff admin.
//
// Backs the /staff/nurses admin page. A "nurse" here is a User row with
// role='sub_admin' + subAdminType='nurse', plus the profile fields added
// to the User model in Phase 9.10 (fullName, designation, qualification,
// phoneNumber, primaryWardId, joiningDate, dateOfBirth).
//
// Why piggy-back on User instead of a separate Nurse table:
//   * Nurses log in via the existing /login flow and need a User row anyway.
//   * Wards already pull staff names from User for shift assignments and
//     duty acks (StaffShiftAssignment, DutyAcknowledgement) — a parallel
//     table would force every consumer to UNION two sources.
//   * The OT module wants nurses to appear in OtStaffMaster too (so they
//     can be picked for surgeries). The optional userId FK on
//     OtStaffMaster lets us mirror one User into one OT-staff row, without
//     forcing every nurse to have an OT presence.

const VALID_DESIGNATIONS = [
  'Staff Nurse', 'Senior Sister', 'Charge Nurse', 'Nurse Manager',
  'ICU Nurse', 'OT Nurse', 'Scrub Nurse', 'Floor Nurse',
  'Anaesthesia Technician', 'OT Technician', 'Runner', 'Other',
];

// OT designations that should mirror into OtStaffMaster when sync runs.
const OT_DESIGNATION_TO_OT_ROLE: Record<string, string> = {
  'OT Nurse': 'floor-nurse',
  'Scrub Nurse': 'scrub-nurse',
  'Floor Nurse': 'floor-nurse',
  'OT Technician': 'ot-technician',
  'Anaesthesia Technician': 'anaesthesia-technician',
  'Runner': 'runner',
};

interface NurseBody {
  username?: string;
  password?: string;
  employeeId?: string | null;
  fullName?: string | null;
  designation?: string | null;
  qualification?: string | null;
  phoneNumber?: string | null;
  primaryWardId?: string | null;
  joiningDate?: string | null;
  dateOfBirth?: string | null;
  isActive?: boolean;
}

const parseDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ─── List ──────────────────────────────────────────────────────────────

export const listNurses = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const search = (req.query.search as string | undefined)?.trim();
    const designation = req.query.designation as string | undefined;
    const wardId = req.query.wardId as string | undefined;

    const rows = await prisma.user.findMany({
      where: {
        // Accept the canonical 'Nurse' plus legacy nurse subtypes until all
        // accounts are migrated (NS — one-time data update).
        subAdminType: { in: [...NURSE_SUBTYPES] },
        ...(includeInactive ? {} : { isActive: true }),
        ...(designation && { designation }),
        ...(wardId && { primaryWardId: wardId }),
        ...(search && {
          OR: [
            { username: { contains: search } },
            { fullName: { contains: search } },
            { employeeId: { contains: search } },
            { phoneNumber: { contains: search } },
          ],
        }),
      },
      select: {
        id: true,
        username: true,
        employeeId: true,
        fullName: true,
        designation: true,
        qualification: true,
        phoneNumber: true,
        primaryWardId: true,
        primaryWard: { select: { id: true, wardName: true, wardCode: true } },
        joiningDate: true,
        dateOfBirth: true,
        isActive: true,
        createdAt: true,
        otStaffMasters: { select: { id: true, role: true, isActive: true } },
      },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }, { username: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[nurse-staff] list failed:', error);
    res.status(500).json({ message: 'Failed to list nurses' });
  }
};

// ─── Create ────────────────────────────────────────────────────────────

export const createNurse = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as NurseBody;

    if (!body.username?.trim()) {
      res.status(400).json({ message: 'username is required' });
      return;
    }
    if (!body.password || body.password.length < 6) {
      res.status(400).json({ message: 'password must be at least 6 characters' });
      return;
    }
    if (!body.fullName?.trim()) {
      res.status(400).json({ message: 'fullName is required' });
      return;
    }
    if (!body.designation || !VALID_DESIGNATIONS.includes(body.designation)) {
      res.status(400).json({ message: `designation must be one of: ${VALID_DESIGNATIONS.join(', ')}` });
      return;
    }

    // Reject duplicate username (User.username is not @unique in this schema,
    // but operationally must be — the login resolver assumes uniqueness).
    const existingByUsername = await prisma.user.findFirst({
      where: { username: body.username.trim() },
      select: { id: true },
    });
    if (existingByUsername) {
      res.status(409).json({ message: 'Username already exists' });
      return;
    }
    if (body.employeeId?.trim()) {
      const existingByEmp = await prisma.user.findUnique({
        where: { employeeId: body.employeeId.trim() },
        select: { id: true },
      });
      if (existingByEmp) {
        res.status(409).json({ message: 'Employee ID already exists' });
        return;
      }
    }

    if (body.primaryWardId) {
      const ward = await prisma.ipdWard.findUnique({
        where: { id: body.primaryWardId },
        select: { id: true },
      });
      if (!ward) {
        res.status(400).json({ message: 'primaryWardId does not match any ward' });
        return;
      }
    }

    const hashedPassword = bcrypt.hashSync(body.password, 10);
    const row = await prisma.user.create({
      data: {
        username: body.username.trim(),
        password: hashedPassword,
        role: 'sub_admin',
        subAdminType: NURSE,
        adminType: null,
        employeeId: body.employeeId?.trim() || null,
        fullName: body.fullName.trim(),
        designation: body.designation,
        qualification: body.qualification?.trim() || null,
        phoneNumber: body.phoneNumber?.trim() || null,
        primaryWardId: body.primaryWardId || null,
        joiningDate: parseDate(body.joiningDate),
        dateOfBirth: parseDate(body.dateOfBirth),
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
      select: {
        id: true, username: true, employeeId: true, fullName: true,
        designation: true, qualification: true, phoneNumber: true,
        primaryWardId: true, joiningDate: true, dateOfBirth: true,
        isActive: true, createdAt: true,
      },
    });

    await auditLog(req, {
      module: 'staff',
      action: 'CREATE',
      entityType: 'NurseUser',
      entityId: String(row.id),
      payload: { username: row.username, fullName: row.fullName, designation: row.designation },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    const msg = (error as Error).message ?? '';
    if (msg.includes('Unique constraint')) {
      res.status(409).json({ message: 'Username or employee ID already exists' });
      return;
    }
    console.error('[nurse-staff] create failed:', error);
    res.status(500).json({ message: 'Failed to create nurse' });
  }
};

// ─── Update profile (no password change here) ──────────────────────────

export const updateNurse = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, subAdminType: true } });
    if (!existing || !isNurse(existing.subAdminType)) {
      res.status(404).json({ message: 'Nurse not found' });
      return;
    }

    const body = req.body as NurseBody;
    if (body.designation && !VALID_DESIGNATIONS.includes(body.designation)) {
      res.status(400).json({ message: `designation must be one of: ${VALID_DESIGNATIONS.join(', ')}` });
      return;
    }
    if (body.primaryWardId) {
      const ward = await prisma.ipdWard.findUnique({
        where: { id: body.primaryWardId },
        select: { id: true },
      });
      if (!ward) {
        res.status(400).json({ message: 'primaryWardId does not match any ward' });
        return;
      }
    }

    const row = await prisma.user.update({
      where: { id },
      data: {
        ...(body.employeeId !== undefined && { employeeId: body.employeeId?.trim() || null }),
        ...(body.fullName !== undefined && { fullName: body.fullName?.trim() || null }),
        ...(body.designation !== undefined && { designation: body.designation }),
        ...(body.qualification !== undefined && { qualification: body.qualification?.trim() || null }),
        ...(body.phoneNumber !== undefined && { phoneNumber: body.phoneNumber?.trim() || null }),
        ...(body.primaryWardId !== undefined && { primaryWardId: body.primaryWardId || null }),
        ...(body.joiningDate !== undefined && { joiningDate: parseDate(body.joiningDate) }),
        ...(body.dateOfBirth !== undefined && { dateOfBirth: parseDate(body.dateOfBirth) }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedBy: req.user?.username ?? null,
      },
      select: {
        id: true, username: true, employeeId: true, fullName: true,
        designation: true, qualification: true, phoneNumber: true,
        primaryWardId: true, joiningDate: true, dateOfBirth: true,
        isActive: true,
      },
    });

    await auditLog(req, {
      module: 'staff', action: 'UPDATE', entityType: 'NurseUser',
      entityId: String(row.id), payload: { designation: row.designation, isActive: row.isActive },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[nurse-staff] update failed:', error);
    res.status(500).json({ message: 'Failed to update nurse' });
  }
};

// ─── Deactivate (soft delete) ──────────────────────────────────────────

export const deactivateNurse = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, subAdminType: true } });
    if (!existing || !isNurse(existing.subAdminType)) {
      res.status(404).json({ message: 'Nurse not found' });
      return;
    }
    const row = await prisma.user.update({
      where: { id },
      data: { isActive: false, updatedBy: req.user?.username ?? null },
      select: { id: true, isActive: true },
    });
    // Also deactivate any mirrored OT-staff rows so the OT pickers stop
    // showing this person.
    await prisma.otStaffMaster.updateMany({
      where: { userId: id },
      data: { isActive: false },
    });
    await auditLog(req, {
      module: 'staff', action: 'DEACTIVATE', entityType: 'NurseUser',
      entityId: String(row.id), payload: null,
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[nurse-staff] deactivate failed:', error);
    res.status(500).json({ message: 'Failed to deactivate nurse' });
  }
};

// ─── Reset password ────────────────────────────────────────────────────

export const resetNursePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const body = req.body as { newPassword?: string };
    if (!body.newPassword || body.newPassword.length < 6) {
      res.status(400).json({ message: 'newPassword must be at least 6 characters' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, subAdminType: true } });
    if (!existing || !isNurse(existing.subAdminType)) {
      res.status(404).json({ message: 'Nurse not found' });
      return;
    }
    await prisma.user.update({
      where: { id },
      data: {
        password: bcrypt.hashSync(body.newPassword, 10),
        updatedBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, {
      module: 'staff', action: 'RESET_PASSWORD', entityType: 'NurseUser',
      entityId: String(id), payload: null,
    });
    res.status(200).json({ data: { id, ok: true } });
  } catch (error) {
    console.error('[nurse-staff] reset password failed:', error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
};

// ─── Mirror to OtStaffMaster ───────────────────────────────────────────

export const syncToOtStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const nurse = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, fullName: true, username: true, employeeId: true,
        designation: true, subAdminType: true, isActive: true,
      },
    });
    if (!nurse || !isNurse(nurse.subAdminType)) {
      res.status(404).json({ message: 'Nurse not found' });
      return;
    }
    const otRole = nurse.designation ? OT_DESIGNATION_TO_OT_ROLE[nurse.designation] : undefined;
    if (!otRole) {
      res.status(400).json({
        message: `Designation "${nurse.designation ?? ''}" is not an OT role. Eligible designations: ${Object.keys(OT_DESIGNATION_TO_OT_ROLE).join(', ')}`,
      });
      return;
    }
    const existing = await prisma.otStaffMaster.findFirst({
      where: { userId: id },
      select: { id: true },
    });
    const data = {
      name: nurse.fullName || nurse.username,
      employeeCode: nurse.employeeId || null,
      role: otRole,
      designation: nurse.designation,
      userId: nurse.id,
      isActive: nurse.isActive,
    };
    const row = existing
      ? await prisma.otStaffMaster.update({ where: { id: existing.id }, data })
      : await prisma.otStaffMaster.create({
          data: { ...data, createdBy: req.user?.username ?? null },
        });
    await auditLog(req, {
      module: 'staff', action: 'SYNC_OT', entityType: 'NurseUser',
      entityId: String(nurse.id), payload: { otStaffId: row.id, role: otRole },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[nurse-staff] sync-to-ot failed:', error);
    res.status(500).json({ message: 'Failed to sync to OT staff master' });
  }
};
