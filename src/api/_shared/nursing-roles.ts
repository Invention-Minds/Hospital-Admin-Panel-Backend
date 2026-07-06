import prisma from '../../service/prisma-client';

/**
 * Phase NS-2 — single source of truth for nursing role identity + ward scoping.
 *
 * History: the codebase accumulated several incompatible `User.subAdminType`
 * strings for nurses ('Nursing', 'IPD Nurse', 'ICU Nurse', 'Ward Coordinator',
 * lowercase 'nurse'), so sidebar gates, dashboards and the superintendent
 * summary never agreed on who was a nurse. We now collapse all bedside nursing
 * roles into a single canonical value and give the management role its own:
 *
 *   NURSE                  = 'Nurse'                  (bedside / ward nurse, ward-scoped)
 *   NURSING_SUPERINTENDENT = 'Nursing Superintendent' (hospital-wide, owns assignments)
 *   ER_NURSE               = 'ER Nurse'               (Emergency module — kept separate)
 *
 * LEGACY_NURSE_SUBTYPES are still recognised on READ paths so accounts that
 * predate the one-time data update keep working until their subAdminType is
 * migrated to 'Nurse'.
 */

export const NURSE = 'Nurse';
export const NURSING_SUPERINTENDENT = 'Nursing Superintendent';
export const ER_NURSE = 'ER Nurse';

/** Old nurse subAdminType values, accepted on read until accounts are migrated. */
export const LEGACY_NURSE_SUBTYPES = [
  'Nursing',
  'IPD Nurse',
  'ICU Nurse',
  'Ward Coordinator',
  'nurse',
] as const;

/** Every value that should be treated as a ward-scoped bedside nurse. */
export const NURSE_SUBTYPES: readonly string[] = [NURSE, ...LEGACY_NURSE_SUBTYPES];

/** A bedside nurse — ward-scoped (sees only their station/ward patients). */
export const isNurse = (subAdminType?: string | null): boolean =>
  !!subAdminType && NURSE_SUBTYPES.includes(subAdminType);

/** The nursing management role — hospital-wide, bypasses ward scoping. */
export const isNursingSuperintendent = (subAdminType?: string | null): boolean =>
  subAdminType === NURSING_SUPERINTENDENT;

export interface WardScope {
  /** true → caller may see every ward (super_admin or Nursing Superintendent). */
  unrestricted: boolean;
  /** ward ids the caller is limited to; empty when a scoped nurse has no mapping. */
  wardIds: string[];
  /** whether the caller is a ward-scoped bedside nurse (drives "apply the filter?"). */
  isScopedNurse: boolean;
  role: string | null;
  subAdminType: string | null;
}

/**
 * Resolve the ward visibility for an actor. Single DB round-trip plus the
 * station/shift lookups for scoped nurses.
 *
 *   super_admin / Nursing Superintendent → unrestricted (all wards).
 *   bedside Nurse                        → union of:
 *        • wards across every station they're mapped to (NurseStationAssignment)
 *        • their primaryWardId (home ward)
 *        • today's rostered StaffShiftAssignment.wardId
 *   anyone else (doctor, admin, …)       → unrestricted here; this helper only
 *        imposes *nurse* scoping. Other scoping (e.g. doctor-by-name) lives in
 *        its own controllers.
 */
export const resolveWardScope = async (
  userId: number | undefined,
): Promise<WardScope> => {
  const empty: WardScope = {
    unrestricted: false,
    wardIds: [],
    isScopedNurse: false,
    role: null,
    subAdminType: null,
  };
  if (typeof userId !== 'number' || Number.isNaN(userId)) return empty;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, subAdminType: true, primaryWardId: true },
  });
  if (!user) return empty;

  const base = { role: user.role, subAdminType: user.subAdminType };

  if (user.role === 'super_admin' || isNursingSuperintendent(user.subAdminType)) {
    return { unrestricted: true, wardIds: [], isScopedNurse: false, ...base };
  }

  if (!isNurse(user.subAdminType)) {
    // Not a ward-scoped nurse — this helper imposes no restriction.
    return { unrestricted: true, wardIds: [], isScopedNurse: false, ...base };
  }

  // ─── Scoped bedside nurse: gather allowed wards from all sources ──────
  const wardIds = new Set<string>();
  if (user.primaryWardId) wardIds.add(user.primaryWardId);

  const stationWards = await prisma.nurseStationAssignment.findMany({
    where: { userId },
    select: { station: { select: { wardLinks: { select: { wardId: true } } } } },
  });
  for (const a of stationWards) {
    for (const link of a.station?.wardLinks ?? []) wardIds.add(link.wardId);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const shifts = await prisma.staffShiftAssignment.findMany({
    where: {
      userId,
      date: { gte: todayStart, lt: todayEnd },
      status: { in: ['SCHEDULED', 'ACKNOWLEDGED', 'COMPLETED'] },
      wardId: { not: null },
    },
    select: { wardId: true },
  });
  for (const s of shifts) if (s.wardId) wardIds.add(s.wardId);

  return {
    unrestricted: false,
    wardIds: Array.from(wardIds),
    isScopedNurse: true,
    ...base,
  };
};

/**
 * Convenience for list controllers: returns `null` when the caller should see
 * everything, or the (possibly empty) array of ward ids a scoped nurse is
 * limited to. Callers do: `if (wardIds) where.wardId = { in: wardIds }`.
 */
export const getNurseAllowedWardIds = async (
  userId: number | undefined,
): Promise<string[] | null> => {
  const scope = await resolveWardScope(userId);
  return scope.isScopedNurse ? scope.wardIds : null;
};

/**
 * True when the user is assigned to at least one active OPD-type NursingStation.
 * Drives OPD appointment visibility — only OPD-station nurses see the OPD
 * appointments view. Stamped into the login response so the sidebar can gate
 * the OPD link without an extra round-trip.
 */
export const isOpdStationNurse = async (
  userId: number | undefined,
): Promise<boolean> => {
  if (typeof userId !== 'number' || Number.isNaN(userId)) return false;
  const count = await prisma.nurseStationAssignment.count({
    where: { userId, station: { type: 'OPD', isActive: true } },
  });
  return count > 0;
};

/**
 * True when the user has IPD/ward scope — assigned to an active IPD-type
 * station OR has a home ward (`primaryWardId`). Drives the IPD/clinical sidebar
 * menus, so a pure OPD nurse (OPD station only) doesn't see ward menus.
 */
export const isIpdScopedNurse = async (
  userId: number | undefined,
): Promise<boolean> => {
  if (typeof userId !== 'number' || Number.isNaN(userId)) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { primaryWardId: true },
  });
  if (user?.primaryWardId) return true;
  const count = await prisma.nurseStationAssignment.count({
    where: { userId, station: { type: 'IPD', isActive: true } },
  });
  return count > 0;
};
