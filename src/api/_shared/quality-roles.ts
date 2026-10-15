import type { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import { requireRole } from '../../middleware/require-role';
import { NURSING_SUPERINTENDENT } from './nursing-roles';

/**
 * Single source of truth for who may do what in the Incident + Quality modules.
 *
 * `User.role` is coarse (super_admin | admin | sub_admin | doctor); admins carry
 * a job title in `User.adminType`, sub-admins in `User.subAdminType`.
 * super_admin always passes.
 *
 *   Incidents
 *     raise / view own + assigned ..... any authenticated staff
 *     view their department ........... DEPARTMENT_VIEWER (other admins +
 *                                       Nursing Superintendent) — read-only,
 *                                       matched on User.department; the
 *                                       superintendent also sees every ward incident
 *     view all + every action ......... INCIDENT_MANAGER (Quality Manager admin)
 *
 *   Complaints
 *     raise / view own-raised + assigned ... any authenticated staff
 *     view their department ................ DEPARTMENT_VIEWER (as incidents;
 *                                            superintendent sees IPD complaints)
 *     view all + every action .............. COMPLAINT_HANDLER (Quality Manager
 *                                            admin + Patient Relations sub-admin)
 *
 *   Feedback (surveys / NPS)
 *     inbox, tokens, sweeps ................ COMPLAINT_HANDLER
 *     create a survey (QR at the desk) ..... COMPLAINT_HANDLER + Front Desk
 *     aggregate NPS only ................... FEEDBACK_VIEWER (+ senior management)
 *
 *   Quality (NABH QI)
 *     view dashboards / indicators .... QUALITY_VIEWER (Quality Manager +
 *                                       Manager / Senior Manager / Management)
 *     capture / configure / RCA ....... QUALITY_TEAM (Quality Manager)
 *     infection-control capture ....... QUALITY_TEAM + Infection Control Nurse
 */

export const QUALITY_MANAGER = 'Quality Manager';
export const INFECTION_CONTROL_NURSE = 'Infection Control Nurse';
export const PATIENT_RELATIONS = 'Patient Relations';
export const FRONT_DESK = 'Front Desk';
export const SENIOR_MANAGEMENT = ['Manager', 'Senior Manager', 'Management'];

export const QUALITY_TEAM = { adminTypes: [QUALITY_MANAGER] };
export const QUALITY_VIEWER = { adminTypes: [QUALITY_MANAGER, ...SENIOR_MANAGEMENT] };
export const INCIDENT_MANAGER = { adminTypes: [QUALITY_MANAGER] };
export const INFECTION_CONTROL = { adminTypes: [QUALITY_MANAGER], subAdminTypes: [INFECTION_CONTROL_NURSE] };
export const INFECTION_CONTROL_VIEWER = { adminTypes: QUALITY_VIEWER.adminTypes, subAdminTypes: [INFECTION_CONTROL_NURSE] };

export const COMPLAINT_HANDLER = { adminTypes: [QUALITY_MANAGER], subAdminTypes: [PATIENT_RELATIONS] };
export const FEEDBACK_COLLECTOR = { adminTypes: [QUALITY_MANAGER], subAdminTypes: [PATIENT_RELATIONS, FRONT_DESK] };
export const FEEDBACK_VIEWER = { adminTypes: [QUALITY_MANAGER, ...SENIOR_MANAGEMENT], subAdminTypes: [PATIENT_RELATIONS] };

export const requireComplaintHandler = requireRole(COMPLAINT_HANDLER);
export const requireFeedbackCollector = requireRole(FEEDBACK_COLLECTOR);
export const requireFeedbackViewer = requireRole(FEEDBACK_VIEWER);

export const requireQualityTeam = requireRole(QUALITY_TEAM);
export const requireQualityViewer = requireRole(QUALITY_VIEWER);
export const requireIncidentManager = requireRole(INCIDENT_MANAGER);
export const requireInfectionControl = requireRole(INFECTION_CONTROL);
export const requireInfectionControlViewer = requireRole(INFECTION_CONTROL_VIEWER);

type Actor = { role: string; adminType: string | null; subAdminType: string | null; department: string | null };

const loadActor = async (userId: number | undefined): Promise<Actor | null> => {
  if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, adminType: true, subAdminType: true, department: true },
  });
};

const isManagerActor = (u: Actor): boolean =>
  u.role === 'super_admin' || (u.role === 'admin' && u.adminType === QUALITY_MANAGER);

/** Controller-side check for incident actions (mirrors requireIncidentManager). */
export const isIncidentManager = async (userId: number | undefined): Promise<boolean> => {
  const u = await loadActor(userId);
  return !!u && isManagerActor(u);
};

/**
 * Prisma `where` limiting which incidents the caller may read.
 * null → unrestricted (incident manager).
 */
export const incidentReadScope = async (userId: number | undefined): Promise<Prisma.IncidentWhereInput | null> => {
  const u = await loadActor(userId);
  if (!u || typeof userId !== 'number') return { id: '__none__' };
  if (isManagerActor(u)) return null;

  const or: Prisma.IncidentWhereInput[] = [{ reportedById: userId }, { assignedToId: userId }];
  const isDeptViewer = u.role === 'admin' || u.subAdminType === NURSING_SUPERINTENDENT;
  if (isDeptViewer && u.department?.trim()) or.push({ department: u.department.trim() });
  if (u.subAdminType === NURSING_SUPERINTENDENT) or.push({ ward: { not: null } });
  return { OR: or };
};

const isComplaintHandlerActor = (u: Actor): boolean =>
  u.role === 'super_admin' ||
  (u.role === 'admin' && u.adminType === QUALITY_MANAGER) ||
  u.subAdminType === PATIENT_RELATIONS;

/** Controller-side check for complaint actions (mirrors requireComplaintHandler). */
export const isComplaintHandler = async (userId: number | undefined): Promise<boolean> => {
  const u = await loadActor(userId);
  return !!u && isComplaintHandlerActor(u);
};

/**
 * Prisma `where` limiting which complaints the caller may read.
 * null → unrestricted (complaint handler).
 */
export const complaintReadScope = async (userId: number | undefined): Promise<Prisma.ComplaintWhereInput | null> => {
  const u = await loadActor(userId);
  if (!u || typeof userId !== 'number') return { id: '__none__' };
  if (isComplaintHandlerActor(u)) return null;

  const or: Prisma.ComplaintWhereInput[] = [{ raisedById: userId }, { assignedToId: userId }];
  const isDeptViewer = u.role === 'admin' || u.subAdminType === NURSING_SUPERINTENDENT;
  if (isDeptViewer && u.department?.trim()) or.push({ department: u.department.trim() });
  if (u.subAdminType === NURSING_SUPERINTENDENT) or.push({ admissionId: { not: null } });
  return { OR: or };
};
