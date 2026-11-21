import prisma from './prisma-client';
import { NURSE_SUBTYPES, NURSING_SUPERINTENDENT } from '../api/_shared/nursing-roles';
import type { DischargeDepartment } from './discharge-clearance';

/**
 * Who may clear / reject each discharge-clearance department.
 *
 * Until now any signed-in user could clear any department (web board and API).
 * Each department is now limited to its own staff, plus the people who
 * coordinate discharges for everyone: super admins, managers (role 'admin')
 * and the Discharge Coordinator. Edit this table if the hospital's roles
 * differ — it is the single source for the web board and the app.
 */
const COORDINATORS = ['Discharge Coordinator'];

export const DEPT_CLEARERS: Record<DischargeDepartment, readonly string[]> = {
  NURSING: [...NURSE_SUBTYPES, NURSING_SUPERINTENDENT],
  DIET: ['Dietician', 'Diet', 'Canteen Staff'],
  PHARMACY: ['Pharmacy Coordinator', 'Pharmacist', 'Pharmacy'],
  BILLING: ['Billing Coordinator', 'Front Desk'],
  OT: ['OT Coordinator'],
  LAB_RAD: ['Lab Technician', 'Lab', 'Radiology', 'Radiology Technician'],
  MLC: [],
};

type Actor = { role: string; subAdminType: string | null };

async function actor(userId: number | undefined): Promise<Actor | null> {
  if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) return null;
  return prisma.user.findUnique({ where: { id: userId }, select: { role: true, subAdminType: true } });
}

/** Coordinates every department (super admin, managers, Discharge Coordinator). */
const isCoordinator = (u: Actor) => u.role === 'super_admin' || u.role === 'admin' || (!!u.subAdminType && COORDINATORS.includes(u.subAdminType));

export async function canClearDepartment(userId: number | undefined, dept: DischargeDepartment): Promise<boolean> {
  const u = await actor(userId);
  if (!u) return false;
  return isCoordinator(u) || (!!u.subAdminType && DEPT_CLEARERS[dept].includes(u.subAdminType));
}

/**
 * Departments this user clears as their own job (not as a coordinator) — the
 * app's "Discharge clearances" work list. Coordinators use the web board.
 */
export async function ownDepartments(userId: number | undefined): Promise<DischargeDepartment[]> {
  const u = await actor(userId);
  if (!u?.subAdminType) return [];
  return (Object.keys(DEPT_CLEARERS) as DischargeDepartment[]).filter((d) => DEPT_CLEARERS[d].includes(u.subAdminType!));
}

/** Every department the user may act on (for the board's buttons). */
export async function clearableDepartments(userId: number | undefined, depts: readonly DischargeDepartment[]): Promise<DischargeDepartment[]> {
  const u = await actor(userId);
  if (!u) return [];
  if (isCoordinator(u)) return [...depts];
  return depts.filter((d) => !!u.subAdminType && DEPT_CLEARERS[d].includes(u.subAdminType));
}
