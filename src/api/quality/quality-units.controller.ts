import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import {
  UNIT_TYPES, ESCALATION_MODULES, MODULE_SEVERITIES, QUALITY_EXECUTIVES,
  loadEscalationMatrix, targetsError, type EscalationModule,
} from '../../service/quality-escalation';
import { runQualityEscalationSweep } from './quality-escalation.cron';

// Quality → Units & Escalation settings.
//   Hospital units (HOD / deputy), their mappings to specialties / legacy
//   department strings / IPD wards, and the escalation matrix editor.
// Reads of the unit list are open to any signed-in user (raise-form pickers);
// everything else is Quality team only (enforced on the routes).

class ValidationError extends Error {}

const optUserId = async (v: unknown, field: string): Promise<number | null | undefined> => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ValidationError(`${field} must be a user id`);
  const u = await prisma.user.findUnique({ where: { id: n }, select: { isActive: true } });
  if (!u || !u.isActive) throw new ValidationError(`${field}: user ${n} not found or inactive`);
  return n;
};

const handle = (res: Response, label: string, error: unknown): void => {
  if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
  const e = error as { code?: string };
  if (e?.code === 'P2002') { res.status(409).json({ message: 'A unit with that name already exists' }); return; }
  console.error(`[quality-units] ${label} failed:`, error);
  res.status(500).json({ message: `Failed to ${label}` });
};

// ── Units ──────────────────────────────────────────────────────────────

export const listUnits = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeOnly = req.query.active === 'true';
    const units = await prisma.hospitalUnit.findMany({
      where: activeOnly ? { isActive: true } : {},
      include: { mappings: { select: { kind: true, value: true } } },
      orderBy: { name: 'asc' },
    });
    const userIds = [...new Set(units.flatMap((u) => [u.hodUserId, u.deputyUserId]).filter((x): x is number => typeof x === 'number'))];
    const people = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, fullName: true } })
      : [];
    const nameOf = (id: number | null) => {
      const p = people.find((x) => x.id === id);
      return p ? p.fullName || p.username : null;
    };
    res.status(200).json({
      data: units.map((u) => ({
        ...u,
        hodName: nameOf(u.hodUserId),
        deputyName: nameOf(u.deputyUserId),
        departments: u.mappings.filter((m) => m.kind === 'department').map((m) => m.value),
        wardIds: u.mappings.filter((m) => m.kind === 'ward').map((m) => m.value),
        mappings: undefined,
      })),
    });
  } catch (error) { handle(res, 'load units', error); }
};

interface UnitBody { name?: unknown; type?: unknown; hodUserId?: unknown; deputyUserId?: unknown; isActive?: unknown }

function parseUnitBody(body: UnitBody, creating: boolean): { name?: string; type?: string; isActive?: boolean } {
  const out: { name?: string; type?: string; isActive?: boolean } = {};
  if (body.name !== undefined || creating) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 80) {
      throw new ValidationError('name is required (2–80 characters)');
    }
    out.name = body.name.trim();
  }
  if (body.type !== undefined || creating) {
    if (typeof body.type !== 'string' || !(UNIT_TYPES as readonly string[]).includes(body.type)) {
      throw new ValidationError(`type must be one of: ${UNIT_TYPES.join(', ')}`);
    }
    out.type = body.type;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new ValidationError('isActive must be true/false');
    out.isActive = body.isActive;
  }
  return out;
}

export const createUnit = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as UnitBody;
    const base = parseUnitBody(body, true);
    const hodUserId = await optUserId(body.hodUserId, 'hodUserId');
    const deputyUserId = await optUserId(body.deputyUserId, 'deputyUserId');
    const row = await prisma.hospitalUnit.create({
      data: {
        name: base.name as string, type: base.type as string,
        hodUserId: hodUserId ?? null, deputyUserId: deputyUserId ?? null,
        ...(base.isActive !== undefined && { isActive: base.isActive }),
      },
    });
    await auditLog(req, { module: 'quality', action: 'CREATE', entityType: 'HospitalUnit', entityId: row.id, payload: { name: row.name, hodUserId: row.hodUserId } });
    res.status(201).json({ data: row });
  } catch (error) { handle(res, 'create unit', error); }
};

export const updateUnit = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.hospitalUnit.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Unit not found' }); return; }
    const body = (req.body ?? {}) as UnitBody;
    const base = parseUnitBody(body, false);
    const hodUserId = await optUserId(body.hodUserId, 'hodUserId');
    const deputyUserId = await optUserId(body.deputyUserId, 'deputyUserId');
    const row = await prisma.hospitalUnit.update({
      where: { id },
      data: {
        ...base,
        ...(hodUserId !== undefined && { hodUserId }),
        ...(deputyUserId !== undefined && { deputyUserId }),
      },
    });
    await auditLog(req, {
      module: 'quality', action: 'UPDATE', entityType: 'HospitalUnit', entityId: id,
      payload: {
        ...base,
        ...(hodUserId !== undefined && hodUserId !== existing.hodUserId && { hodFrom: existing.hodUserId, hodTo: hodUserId }),
        ...(deputyUserId !== undefined && deputyUserId !== existing.deputyUserId && { deputyFrom: existing.deputyUserId, deputyTo: deputyUserId }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) { handle(res, 'update unit', error); }
};

/**
 * Replace a unit's mappings. A value already mapped to another unit is moved
 * here (one specialty / ward → one unit).
 */
export const setUnitMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const unit = await prisma.hospitalUnit.findUnique({ where: { id }, select: { id: true } });
    if (!unit) { res.status(404).json({ message: 'Unit not found' }); return; }
    const body = (req.body ?? {}) as { departments?: unknown; wardIds?: unknown };
    const strList = (v: unknown, field: string): string[] => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !s.trim() || s.length > 120)) {
        throw new ValidationError(`${field} must be an array of non-empty strings`);
      }
      return [...new Set((v as string[]).map((s) => s.trim()))];
    };
    const departments = strList(body.departments, 'departments');
    const wardIds = strList(body.wardIds, 'wardIds');
    if (wardIds.length) {
      const found = await prisma.ipdWard.count({ where: { id: { in: wardIds } } });
      if (found !== wardIds.length) throw new ValidationError('wardIds contains an unknown ward');
    }
    const wanted = [
      ...departments.map((value) => ({ kind: 'department', value })),
      ...wardIds.map((value) => ({ kind: 'ward', value })),
    ];
    await prisma.$transaction(async (tx) => {
      await tx.hospitalUnitMapping.deleteMany({ where: { unitId: id } });
      for (const m of wanted) {
        await tx.hospitalUnitMapping.upsert({
          where: { kind_value: m },
          create: { unitId: id, ...m },
          update: { unitId: id },
        });
      }
    });
    await auditLog(req, { module: 'quality', action: 'UPDATE', entityType: 'HospitalUnitMapping', entityId: id, payload: { departments, wardIds } });
    res.status(200).json({ data: { unitId: id, departments, wardIds } });
  } catch (error) { handle(res, 'save mappings', error); }
};

/**
 * One-click start: a clinical unit per doctor specialty (Department row)
 * that isn't already a unit name or mapped, each mapped to its specialty.
 */
export const importSpecialties = async (req: Request, res: Response): Promise<void> => {
  try {
    const [depts, units, mapped] = await Promise.all([
      prisma.department.findMany({ select: { name: true } }),
      prisma.hospitalUnit.findMany({ select: { name: true } }),
      prisma.hospitalUnitMapping.findMany({ where: { kind: 'department' }, select: { value: true } }),
    ]);
    const taken = new Set([...units.map((u) => u.name.toLowerCase()), ...mapped.map((m) => m.value.toLowerCase())]);
    const created: string[] = [];
    for (const d of depts) {
      if (taken.has(d.name.toLowerCase())) continue;
      await prisma.hospitalUnit.create({
        data: { name: d.name, type: 'clinical', mappings: { create: { kind: 'department', value: d.name } } },
      });
      created.push(d.name);
    }
    await auditLog(req, { module: 'quality', action: 'IMPORT', entityType: 'HospitalUnit', entityId: 'bulk', payload: { created } });
    res.status(200).json({ data: { created } });
  } catch (error) { handle(res, 'import specialties', error); }
};

/** Everything the mapping editor needs: specialties, wards, legacy strings, people. */
export const mappingSources = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [specialties, wards, incDepts, compDepts, mappings, people] = await Promise.all([
      prisma.department.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.ipdWard.findMany({ select: { id: true, wardName: true, department: true }, orderBy: { wardName: 'asc' } }),
      prisma.incident.groupBy({ by: ['department'], _count: { _all: true }, where: { department: { not: null } } }),
      prisma.complaint.groupBy({ by: ['department'], _count: { _all: true }, where: { department: { not: null } } }),
      prisma.hospitalUnitMapping.findMany({ select: { kind: true, value: true, unitId: true } }),
      prisma.user.findMany({
        where: { isActive: true, role: { in: ['super_admin', 'admin', 'sub_admin', 'doctor'] } },
        select: { id: true, username: true, fullName: true, role: true, adminType: true, subAdminType: true },
        orderBy: { username: 'asc' },
      }),
    ]);
    const specialtyNames = new Set(specialties.map((s) => s.name));
    const legacy = new Map<string, number>();
    for (const g of [...incDepts, ...compDepts]) {
      const name = g.department as string;
      if (specialtyNames.has(name)) continue;
      legacy.set(name, (legacy.get(name) ?? 0) + g._count._all);
    }
    res.status(200).json({
      data: {
        specialties: specialties.map((s) => s.name),
        legacyDepartments: [...legacy.entries()].map(([name, cases]) => ({ name, cases })).sort((a, b) => b.cases - a.cases),
        wards,
        mappings,
        people,
        unitTypes: UNIT_TYPES,
      },
    });
  } catch (error) { handle(res, 'load mapping sources', error); }
};

// ── Escalation matrix ──────────────────────────────────────────────────

export const getEscalationMatrix = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({
      data: {
        matrix: await loadEscalationMatrix(),
        severities: MODULE_SEVERITIES,
        targetHelp: {
          tokens: ['hod', 'quality_manager', 'patient_relations', 'admin_type:<type>', 'user:<id>'],
          executiveAdminTypes: QUALITY_EXECUTIVES,
        },
      },
    });
  } catch (error) { handle(res, 'load escalation matrix', error); }
};

/** Replace one module × severity ladder. An empty `levels` array resets it to the default. */
export const setEscalationLadder = async (req: Request, res: Response): Promise<void> => {
  try {
    const module = req.params.module as EscalationModule;
    const severity = req.params.severity;
    if (!(ESCALATION_MODULES as readonly string[]).includes(module)) throw new ValidationError('module must be incident or complaint');
    if (!MODULE_SEVERITIES[module].includes(severity)) throw new ValidationError(`severity must be one of: ${MODULE_SEVERITIES[module].join(', ')}`);
    const levels = (req.body ?? {}).levels as unknown;
    if (!Array.isArray(levels) || levels.length > 6) throw new ValidationError('levels must be an array (max 6)');
    const parsed = levels.map((l: { afterMinutes?: unknown; targets?: unknown; label?: unknown; notifyWhatsapp?: unknown; notifySms?: unknown }, i: number) => {
      const afterMinutes = Number(l?.afterMinutes);
      if (!Number.isInteger(afterMinutes) || afterMinutes < 1 || afterMinutes > 60 * 24 * 90) {
        throw new ValidationError(`level ${i + 1}: afterMinutes must be 1 … 129600`);
      }
      const targets = typeof l?.targets === 'string' ? l.targets.trim() : '';
      const err = targetsError(targets);
      if (err) throw new ValidationError(`level ${i + 1}: ${err}`);
      const label = typeof l?.label === 'string' && l.label.trim() ? l.label.trim().slice(0, 120) : null;
      return { level: i + 1, afterMinutes, targets, label, notifyWhatsapp: l?.notifyWhatsapp === true, notifySms: l?.notifySms === true };
    });
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].afterMinutes <= parsed[i - 1].afterMinutes) {
        throw new ValidationError(`level ${i + 1} must fire later than level ${i}`);
      }
    }
    await prisma.$transaction([
      prisma.qualityEscalationRule.deleteMany({ where: { module, severity } }),
      ...parsed.map((p) => prisma.qualityEscalationRule.create({ data: { module, severity, ...p } })),
    ]);
    await auditLog(req, { module: 'quality', action: 'UPDATE', entityType: 'QualityEscalationRule', entityId: `${module}:${severity}`, payload: { levels: parsed } });
    res.status(200).json({ data: (await loadEscalationMatrix())[module][severity] });
  } catch (error) { handle(res, 'save escalation levels', error); }
};

export const triggerEscalationSweep = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await runQualityEscalationSweep();
    await auditLog(req, { module: 'quality', action: 'ESCALATION_SWEEP', entityType: 'QualityEscalationRule', entityId: 'bulk', payload: { checked: report.checked, escalated: report.escalated } });
    res.status(200).json({ data: report });
  } catch (error) { handle(res, 'run escalation sweep', error); }
};
