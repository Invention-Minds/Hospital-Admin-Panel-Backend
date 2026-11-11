import prisma from './prisma-client';

// Quality escalation matrix — hospital units (HOD routing), the default
// matrix, and recipient resolution. Shared by the incident / complaint
// controllers, the escalation cron and the settings API.
//
// HospitalUnit is separate from Department (doctor specialties). A case's
// unit is: an explicit pick → the IPD admission's ward → the case's
// department string (specialty or legacy free text), via HospitalUnitMapping.

export const UNIT_TYPES = ['clinical', 'nursing', 'diagnostic', 'support', 'administrative'] as const;
export const MAPPING_KINDS = ['department', 'ward'] as const;

export const ESCALATION_MODULES = ['incident', 'complaint'] as const;
export type EscalationModule = (typeof ESCALATION_MODULES)[number];
export const MODULE_SEVERITIES: Record<EscalationModule, readonly string[]> = {
  incident: ['near_miss', 'minor', 'moderate', 'major', 'sentinel'],
  complaint: ['low', 'medium', 'high'],
};

// Senior roles that receive escalations and read every case.
export const MEDICAL_SUPERINTENDENT = 'Medical Superintendent';
export const MEDICAL_DIRECTOR = 'Medical Director';
export const CEO = 'CEO';
export const QUALITY_EXECUTIVES = [MEDICAL_SUPERINTENDENT, MEDICAL_DIRECTOR, CEO];

export interface EscalationLevelDef {
  level: number; afterMinutes: number; targets: string; label?: string | null;
  /** Also alert recipients by WhatsApp / SMS (service/staff-alerts.ts; off by default). */
  notifyWhatsapp?: boolean; notifySms?: boolean;
}

const H = 60;
const D = 24 * H;

/**
 * Built-in matrix, used for any module × severity with no
 * QualityEscalationRule rows. Minutes are from the escalation clock start
 * (case raised / reopened) while the case is still open.
 */
export const DEFAULT_MATRIX: Record<EscalationModule, Record<string, EscalationLevelDef[]>> = {
  incident: {
    sentinel: [
      { level: 1, afterMinutes: 1 * H, targets: `quality_manager,admin_type:${MEDICAL_DIRECTOR}`, label: 'Not triaged within 1h' },
      { level: 2, afterMinutes: 4 * H, targets: `admin_type:${CEO},admin_type:${MEDICAL_DIRECTOR}`, label: 'Open 4h — CEO' },
      { level: 3, afterMinutes: 3 * D, targets: `quality_manager,admin_type:${MEDICAL_DIRECTOR},admin_type:${CEO}`, label: 'RCA committee due (72h)' },
    ],
    major: [
      { level: 1, afterMinutes: 4 * H, targets: 'hod,quality_manager', label: 'Open 4h' },
      { level: 2, afterMinutes: 1 * D, targets: `admin_type:${MEDICAL_SUPERINTENDENT}`, label: 'Open 24h — Medical Superintendent' },
      { level: 3, afterMinutes: 3 * D, targets: `admin_type:${CEO}`, label: 'Open 72h — CEO' },
    ],
    moderate: [
      { level: 1, afterMinutes: 1 * D, targets: 'hod', label: 'Open 24h' },
      { level: 2, afterMinutes: 2 * D, targets: 'quality_manager', label: 'Open 48h — Quality' },
      { level: 3, afterMinutes: 7 * D, targets: `admin_type:${MEDICAL_SUPERINTENDENT}`, label: 'Open 7 days — Medical Superintendent' },
    ],
    minor: [
      { level: 1, afterMinutes: 3 * D, targets: 'hod', label: 'Open 72h' },
      { level: 2, afterMinutes: 7 * D, targets: 'quality_manager', label: 'Open 7 days — Quality' },
    ],
    near_miss: [
      { level: 1, afterMinutes: 3 * D, targets: 'hod', label: 'Open 72h' },
      { level: 2, afterMinutes: 7 * D, targets: 'quality_manager', label: 'Open 7 days — Quality' },
    ],
  },
  complaint: {
    high: [
      { level: 1, afterMinutes: 1 * D, targets: 'hod,patient_relations', label: 'Unresolved 24h' },
      { level: 2, afterMinutes: 2 * D, targets: `admin_type:${MEDICAL_SUPERINTENDENT}`, label: 'Unresolved 48h — Medical Superintendent' },
      { level: 3, afterMinutes: 3 * D, targets: `admin_type:${CEO}`, label: 'Unresolved 72h — CEO' },
    ],
    medium: [
      { level: 1, afterMinutes: 3 * D, targets: 'hod', label: 'Unresolved 72h' },
      { level: 2, afterMinutes: 5 * D, targets: 'quality_manager,patient_relations', label: 'Unresolved 5 days' },
      { level: 3, afterMinutes: 7 * D, targets: `admin_type:${MEDICAL_SUPERINTENDENT}`, label: 'Unresolved 7 days — Medical Superintendent' },
    ],
    low: [
      { level: 1, afterMinutes: 7 * D, targets: 'hod', label: 'Unresolved 7 days' },
      { level: 2, afterMinutes: 10 * D, targets: 'quality_manager,patient_relations', label: 'Unresolved 10 days' },
    ],
  },
};

/** Validates a comma-separated targets string; returns an error or null. */
export function targetsError(targets: string): string | null {
  const tokens = targets.split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return 'at least one target is required';
  for (const t of tokens) {
    if (['hod', 'quality_manager', 'patient_relations'].includes(t)) continue;
    if (/^admin_type:.{2,60}$/.test(t)) continue;
    if (/^user:\d+$/.test(t)) continue;
    return `unknown target '${t}' (use hod, quality_manager, patient_relations, admin_type:<type>, user:<id>)`;
  }
  return null;
}

/** Effective matrix: DB rows where present, else the default, per module × severity. */
export async function loadEscalationMatrix(): Promise<Record<EscalationModule, Record<string, { source: 'custom' | 'default'; levels: EscalationLevelDef[] }>>> {
  const rows = await prisma.qualityEscalationRule.findMany({ orderBy: [{ module: 'asc' }, { severity: 'asc' }, { level: 'asc' }] });
  const out = {} as Record<EscalationModule, Record<string, { source: 'custom' | 'default'; levels: EscalationLevelDef[] }>>;
  for (const m of ESCALATION_MODULES) {
    out[m] = {};
    for (const sev of MODULE_SEVERITIES[m]) {
      const custom = rows.filter((r) => r.module === m && r.severity === sev);
      out[m][sev] = custom.length > 0
        ? { source: 'custom', levels: custom.map((r) => ({ level: r.level, afterMinutes: r.afterMinutes, targets: r.targets, label: r.label, notifyWhatsapp: r.notifyWhatsapp, notifySms: r.notifySms })) }
        : { source: 'default', levels: DEFAULT_MATRIX[m][sev] ?? [] };
    }
  }
  return out;
}

// ── Units ──────────────────────────────────────────────────────────────

/** Unit ids the user heads (as HOD or deputy). A user may head several. */
export async function unitIdsHeadedBy(userId: number | undefined): Promise<number[]> {
  if (typeof userId !== 'number' || userId <= 0) return [];
  const rows = await prisma.hospitalUnit.findMany({
    where: { isActive: true, OR: [{ hodUserId: userId }, { deputyUserId: userId }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function isHodOfUnit(userId: number | undefined, unitId: number | null | undefined): Promise<boolean> {
  if (!unitId) return false;
  return (await unitIdsHeadedBy(userId)).includes(unitId);
}

/** Validates an explicit unit pick; null when absent, throws on unknown/inactive. */
export async function assertUnit(unitId: unknown): Promise<number | null> {
  if (unitId === undefined || unitId === null || unitId === '') return null;
  const n = typeof unitId === 'string' && /^\d+$/.test(unitId) ? Number(unitId) : unitId;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new Error('unitId must be a positive integer');
  const u = await prisma.hospitalUnit.findUnique({ where: { id: n }, select: { isActive: true } });
  if (!u || !u.isActive) throw new Error(`unit ${n} does not exist or is inactive`);
  return n;
}

/**
 * Resolve the owning unit for a case: explicit pick → IPD ward → department
 * string. Never throws — null means "Quality triages it".
 */
export async function resolveUnitId(opts: {
  unitId?: number | null;
  admissionId?: string | null;
  ward?: string | null;
  department?: string | null;
}): Promise<number | null> {
  try {
    if (opts.unitId) return opts.unitId;
    let wardId: string | null = null;
    if (opts.admissionId) {
      const adm = await prisma.ipdAdmission.findUnique({ where: { id: opts.admissionId }, select: { wardId: true, department: true } });
      wardId = adm?.wardId ?? null;
      if (!opts.department && adm?.department) opts = { ...opts, department: adm.department };
    }
    if (!wardId && opts.ward?.trim()) {
      const w = await prisma.ipdWard.findFirst({ where: { wardName: opts.ward.trim() }, select: { id: true } });
      wardId = w?.id ?? null;
    }
    if (wardId) {
      const m = await prisma.hospitalUnitMapping.findUnique({
        where: { kind_value: { kind: 'ward', value: wardId } },
        select: { unitId: true, unit: { select: { isActive: true } } },
      });
      if (m?.unit.isActive) return m.unitId;
    }
    const dept = opts.department?.trim();
    if (dept) {
      const m = await prisma.hospitalUnitMapping.findUnique({
        where: { kind_value: { kind: 'department', value: dept } },
        select: { unitId: true, unit: { select: { isActive: true } } },
      });
      if (m?.unit.isActive) return m.unitId;
      // A unit named exactly like the department also matches.
      const byName = await prisma.hospitalUnit.findFirst({ where: { name: dept, isActive: true }, select: { id: true } });
      if (byName) return byName.id;
    }
  } catch (err) {
    console.warn('[quality-unit] resolve failed:', (err as Error).message);
  }
  return null;
}

// ── Recipients ─────────────────────────────────────────────────────────

/** Resolve escalation target tokens to user ids for a case in `unitId`. */
export async function resolveTargetUserIds(targets: string, unitId: number | null): Promise<number[]> {
  const ids = new Set<number>();
  const tokens = targets.split(',').map((t) => t.trim()).filter(Boolean);
  for (const t of tokens) {
    if (t === 'hod') {
      const unit = unitId
        ? await prisma.hospitalUnit.findUnique({ where: { id: unitId }, select: { hodUserId: true, deputyUserId: true } })
        : null;
      const heads = [unit?.hodUserId, unit?.deputyUserId].filter((x): x is number => typeof x === 'number');
      if (heads.length > 0) heads.forEach((h) => ids.add(h));
      else (await usersWhere({ role: 'admin', adminType: 'Quality Manager' })).forEach((u) => ids.add(u)); // no HOD → Quality
    } else if (t === 'quality_manager') {
      (await usersWhere({ role: 'admin', adminType: 'Quality Manager' })).forEach((u) => ids.add(u));
    } else if (t === 'patient_relations') {
      (await usersWhere({ subAdminType: 'Patient Relations' })).forEach((u) => ids.add(u));
    } else if (t.startsWith('admin_type:')) {
      (await usersWhere({ role: 'admin', adminType: t.slice('admin_type:'.length) })).forEach((u) => ids.add(u));
    } else if (t.startsWith('user:')) {
      const n = Number(t.slice('user:'.length));
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  }
  return [...ids];
}

async function usersWhere(where: { role?: 'admin'; adminType?: string; subAdminType?: string }): Promise<number[]> {
  const rows = await prisma.user.findMany({ where: { ...where, isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

// ── Detail-view helpers ────────────────────────────────────────────────

export interface CaseUnitSummary { id: number; name: string; type: string; hodName: string | null; deputyName: string | null }

/** Unit + HOD/deputy display names for a case detail view. */
export async function caseUnitSummary(unitId: number | null): Promise<CaseUnitSummary | null> {
  if (!unitId) return null;
  const u = await prisma.hospitalUnit.findUnique({ where: { id: unitId } });
  if (!u) return null;
  const people = await prisma.user.findMany({
    where: { id: { in: [u.hodUserId, u.deputyUserId].filter((x): x is number => typeof x === 'number') } },
    select: { id: true, username: true, fullName: true },
  });
  const nameOf = (id: number | null) => {
    const p = people.find((x) => x.id === id);
    return p ? p.fullName || p.username : null;
  };
  return { id: u.id, name: u.name, type: u.type, hodName: nameOf(u.hodUserId), deputyName: nameOf(u.deputyUserId) };
}

export interface EscalationEvent { at: Date; level: number; label: string | null; targets: string; recipients: number }

/** Escalations fired for a case (written to AppAuditLog by the cron), oldest first. */
export async function escalationTimeline(entityType: 'Incident' | 'Complaint', id: string): Promise<EscalationEvent[]> {
  const rows = await prisma.appAuditLog.findMany({
    where: { entityType, entityId: id, action: 'ESCALATE' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, payload: true },
    take: 50,
  });
  return rows.map((r) => {
    let p: { level?: number; label?: string | null; targets?: string; recipients?: number } = {};
    try { p = r.payload ? JSON.parse(r.payload) : {}; } catch { /* bad JSON */ }
    return { at: r.createdAt, level: p.level ?? 0, label: p.label ?? null, targets: p.targets ?? '', recipients: p.recipients ?? 0 };
  });
}

/** HOD + deputy of a unit (for "new case" bells). */
export async function unitHeadUserIds(unitId: number | null): Promise<number[]> {
  if (!unitId) return [];
  const u = await prisma.hospitalUnit.findUnique({ where: { id: unitId }, select: { hodUserId: true, deputyUserId: true, isActive: true } });
  if (!u?.isActive) return [];
  return [u.hodUserId, u.deputyUserId].filter((x): x is number => typeof x === 'number');
}
