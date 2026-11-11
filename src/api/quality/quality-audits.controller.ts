import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import type { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { isIncidentManager, QUALITY_VIEWER } from '../_shared/quality-roles';
import { QUALITY_EXECUTIVES, unitIdsHeadedBy, unitHeadUserIds, assertUnit } from '../../service/quality-escalation';
import { incidentManagerUserIds } from '../incident/incident.controller';
import { AUDIT_BACKED_INDICATORS } from './quality-indicator-auto-source';
import { AUDIT_STARTER_LIBRARY } from '../../service/audit-starter-library';

// Quality audits — checklist library, scheduled audits per unit, findings
// (every "no" answer) with corrective actions, and a compliance summary.
// Mounted at /api/quality/audits.
//
// Who may do what:
//   Quality Manager (+ super_admin) ... everything, incl. the checklist builder
//   Unit HOD / deputy ................. schedule + conduct audits for their units,
//                                       manage finding actions there
//   Assigned auditor .................. conduct (answer + submit) their audit
//   Quality viewers / executives ...... read everything (dashboards)
//   Finding-action owner .............. read that audit, complete their action

class ValidationError extends Error {}

const TZ = 'Asia/Kolkata';
const GROUPS = ['clinical', 'quality', 'facility'] as const;
const FREQUENCIES = ['weekly', 'monthly', 'quarterly'] as const;
const RESULTS = ['yes', 'no', 'na'] as const;
const OPEN_RUN = ['scheduled', 'in_progress'];
const AUDIT_QI = new Set(AUDIT_BACKED_INDICATORS);

// ─── Helpers ────────────────────────────────────────────────────────────

const str = (v: unknown, field: string, max = 4000): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return t || null;
};
const intId = (v: unknown, field: string): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return n;
};
const dateField = (v: unknown, field: string): Date | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError(`${field} must be a date`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be a valid date`);
  return d;
};

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
  console.error(`[quality-audits] ${what} failed:`, error);
  res.status(500).json({ message: `Failed to ${what}` });
}

async function activeUser(id: number): Promise<{ id: number; name: string } | null> {
  const u = await prisma.user.findFirst({ where: { id, isActive: true }, select: { id: true, username: true, fullName: true } });
  return u ? { id: u.id, name: u.fullName || u.username } : null;
}

async function bell(userIds: number[], n: { type: string; title: string; message: string; runId: string; critical?: boolean }) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        type: n.type, title: n.title, message: n.message, status: 'unread', isCritical: !!n.critical,
        entityId: 0, entityType: `AuditRun:${n.runId}`, userId,
      })),
    });
  } catch (err) {
    console.warn(`[quality-audits:${n.type}] bell failed:`, (err as Error).message);
  }
}

/** QM / super_admin. */
const isManager = (userId: number | undefined) => isIncidentManager(userId);

/** Quality viewers + executives read every audit (dashboards). */
async function isReader(userId: number | undefined): Promise<boolean> {
  if (await isManager(userId)) return true;
  if (typeof userId !== 'number') return false;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, adminType: true } });
  return !!u && u.role === 'admin' && !!u.adminType &&
    ([...QUALITY_VIEWER.adminTypes, ...QUALITY_EXECUTIVES] as string[]).includes(u.adminType);
}

export interface AuditPermissions {
  canConduct: boolean;     // answer + submit (open audits)
  canManage: boolean;      // reschedule / reassign / cancel (open audits)
  canManageActions: boolean; // add / edit / drop finding actions (completed audits)
}

async function runPermissions(userId: number | undefined, run: { unitId: number | null; auditorId: number | null; status: string }): Promise<AuditPermissions> {
  const manager = await isManager(userId);
  const hod = typeof userId === 'number' && run.unitId != null && (await unitIdsHeadedBy(userId)).includes(run.unitId);
  const open = OPEN_RUN.includes(run.status);
  return {
    canConduct: open && (manager || hod || (run.auditorId != null && run.auditorId === userId)),
    canManage: open && (manager || hod),
    canManageActions: run.status === 'completed' && (manager || hod),
  };
}

/** Prisma filter of the audits this user may read; null = all. */
async function runReadScope(userId: number | undefined) {
  if (await isReader(userId)) return null;
  if (typeof userId !== 'number') return { id: '__none__' };
  const headed = await unitIdsHeadedBy(userId);
  return {
    OR: [
      { auditorId: userId },
      { createdById: userId },
      ...(headed.length ? [{ unitId: { in: headed } }] : []),
      { actions: { some: { ownerId: userId } } },
    ],
  };
}

async function nextRunCode(): Promise<string> {
  const prefix = `AUD-${moment().tz(TZ).year()}-`;
  const rows = await prisma.$queryRaw<Array<{ maxSeq: bigint | number | null }>>`
    SELECT MAX(CAST(SUBSTRING(code, ${prefix.length + 1}) AS UNSIGNED)) AS maxSeq
    FROM AuditRun WHERE code LIKE ${prefix + '%'}`;
  return `${prefix}${String((Number(rows[0]?.maxSeq ?? 0) || 0) + 1).padStart(4, '0')}`;
}

// ─── Checklists ─────────────────────────────────────────────────────────

interface ItemBody { id?: unknown; text?: unknown; section?: unknown; critical?: unknown; qiCode?: unknown; isActive?: unknown }

function parseItems(raw: unknown): Array<{ id?: number; text: string; section: string | null; critical: boolean; qiCode: string | null; isActive: boolean }> {
  if (!Array.isArray(raw)) throw new ValidationError('items must be a list');
  if (raw.length > 200) throw new ValidationError('a checklist can have at most 200 items');
  return raw.map((it: ItemBody, i) => {
    const text = str(it?.text, `items[${i}].text`, 1000);
    if (!text || text.length < 3) throw new ValidationError(`items[${i}].text is required (min 3 chars)`);
    const qiCode = str(it.qiCode, `items[${i}].qiCode`, 20) ?? null;
    if (qiCode && !AUDIT_QI.has(qiCode)) throw new ValidationError(`items[${i}].qiCode ${qiCode} is not an audit-backed indicator`);
    const id = intId(it.id, `items[${i}].id`) ?? undefined;
    return {
      ...(id && { id }), text, section: str(it.section, `items[${i}].section`, 120) ?? null,
      critical: it.critical === true, qiCode, isActive: it.isActive !== false,
    };
  });
}

function checklistMeta(b: Record<string, unknown>, creating: boolean) {
  const name = str(b.name, 'name', 160);
  if (creating && (!name || name.length < 3)) throw new ValidationError('name is required (min 3 chars)');
  if (b.group !== undefined && !GROUPS.includes(b.group as typeof GROUPS[number])) throw new ValidationError(`group must be one of: ${GROUPS.join(', ')}`);
  if (creating && b.group === undefined) throw new ValidationError(`group must be one of: ${GROUPS.join(', ')}`);
  if (b.frequency != null && !FREQUENCIES.includes(b.frequency as typeof FREQUENCIES[number])) throw new ValidationError(`frequency must be one of: ${FREQUENCIES.join(', ')}`);
  return {
    ...(name !== undefined && name !== null && { name }),
    ...(b.group !== undefined && { group: b.group as string }),
    ...(b.description !== undefined && { description: str(b.description, 'description') ?? null }),
    ...(b.frequency !== undefined && { frequency: (b.frequency as string | null) ?? null }),
    ...(b.isActive !== undefined && { isActive: b.isActive === true }),
  };
}

export const listChecklists = async (req: Request, res: Response): Promise<void> => {
  try {
    const active = req.query.active === 'true';
    const rows = await prisma.auditChecklist.findMany({
      where: active ? { isActive: true } : {},
      include: { _count: { select: { items: { where: { isActive: true } }, runs: true } } },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
    });
    res.json({ data: rows.map(({ _count, ...c }) => ({ ...c, itemCount: _count.items, runCount: _count.runs })) });
  } catch (error) { fail(res, error, 'load checklists'); }
};

export const getChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intId(req.params.id, 'id');
    const row = await prisma.auditChecklist.findUnique({
      where: { id: id as number }, include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) { res.status(404).json({ message: 'Checklist not found' }); return; }
    res.json({ data: row });
  } catch (error) { fail(res, error, 'load checklist'); }
};

export const createChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body ?? {};
    const meta = checklistMeta(b, true);
    const items = parseItems(b.items ?? []);
    if (!items.length) throw new ValidationError('add at least one item');
    const code = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
    const row = await prisma.auditChecklist.create({
      data: {
        code, ...(meta as { name: string; group: string }),
        items: { create: items.map(({ id: _id, ...it }, i) => ({ ...it, sortOrder: i })) },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    await auditLog(req, { module: 'quality-audit', action: 'CREATE', entityType: 'AuditChecklist', entityId: String(row.id), payload: { name: row.name, items: items.length } });
    res.status(201).json({ data: row });
  } catch (error) { fail(res, error, 'create checklist'); }
};

/**
 * Replaces the checklist's item list: items with an id are updated, items
 * without one are added, and existing items left out are retired (inactive)
 * — never deleted, because past audits reference them.
 */
export const updateChecklist = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intId(req.params.id, 'id') as number;
    const existing = await prisma.auditChecklist.findUnique({ where: { id }, include: { items: true } });
    if (!existing) { res.status(404).json({ message: 'Checklist not found' }); return; }
    const b = req.body ?? {};
    const meta = checklistMeta(b, false);
    const items = b.items !== undefined ? parseItems(b.items) : null;
    if (items && !items.some((i) => i.isActive)) throw new ValidationError('a checklist needs at least one active item');
    const ownIds = new Set(existing.items.map((i) => i.id));
    if (items?.some((i) => i.id && !ownIds.has(i.id))) throw new ValidationError('an item id does not belong to this checklist');

    // One batched transaction (not an interactive one — per-item round trips to
    // a remote DB can exceed the interactive-transaction timeout).
    const ops: Prisma.PrismaPromise<unknown>[] = [prisma.auditChecklist.update({ where: { id }, data: meta })];
    if (items) {
      const kept = new Set<number>();
      for (const [i, it] of items.entries()) {
        const { id: itemId, ...data } = it;
        if (itemId) {
          kept.add(itemId);
          ops.push(prisma.auditChecklistItem.update({ where: { id: itemId }, data: { ...data, sortOrder: i } }));
        } else {
          ops.push(prisma.auditChecklistItem.create({ data: { ...data, checklistId: id, sortOrder: i } }));
        }
      }
      const retire = existing.items.filter((x) => !kept.has(x.id)).map((x) => x.id);
      if (retire.length) ops.push(prisma.auditChecklistItem.updateMany({ where: { id: { in: retire } }, data: { isActive: false } }));
    }
    await prisma.$transaction(ops);
    const row = await prisma.auditChecklist.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    await auditLog(req, { module: 'quality-audit', action: 'UPDATE', entityType: 'AuditChecklist', entityId: String(id), payload: { meta, items: items?.length ?? null } });
    res.json({ data: row });
  } catch (error) { fail(res, error, 'save checklist'); }
};

/** Adds starter-library checklists whose code doesn't exist yet. */
export const importStarterChecklists = async (req: Request, res: Response): Promise<void> => {
  try {
    const have = new Set((await prisma.auditChecklist.findMany({ select: { code: true } })).map((c) => c.code));
    let created = 0;
    for (const c of AUDIT_STARTER_LIBRARY) {
      if (have.has(c.code)) continue;
      const qi = c.qi && AUDIT_QI.has(c.qi) ? c.qi : null;
      await prisma.auditChecklist.create({
        data: {
          code: c.code, name: c.name, group: c.group, frequency: c.frequency, description: c.description ?? null,
          items: {
            create: c.items.map((raw, i) => ({
              sortOrder: i, text: raw.replace(/^!/, ''), critical: raw.startsWith('!'), qiCode: qi,
            })),
          },
        },
      });
      created += 1;
    }
    await auditLog(req, { module: 'quality-audit', action: 'CREATE', entityType: 'AuditChecklist', entityId: 'starter-library', payload: { created } });
    res.json({ data: { created, skipped: AUDIT_STARTER_LIBRARY.length - created } });
  } catch (error) { fail(res, error, 'import starter checklists'); }
};

// ─── Audit runs ─────────────────────────────────────────────────────────

export const listRuns = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const scope = await runReadScope(req.user?.id);
    const rows = await prisma.auditRun.findMany({
      where: {
        ...(scope && { AND: [scope] }),
        ...(q.status && { status: q.status }),
        ...(q.checklistId && /^\d+$/.test(q.checklistId) && { checklistId: Number(q.checklistId) }),
        ...(q.unitId && /^\d+$/.test(q.unitId) && { unitId: Number(q.unitId) }),
        ...(q.mine === 'true' && typeof req.user?.id === 'number' && { auditorId: req.user.id }),
      },
      include: { checklist: { select: { name: true, group: true } }, _count: { select: { actions: { where: { status: 'open' } } } } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const unitIds = [...new Set(rows.map((r) => r.unitId).filter((x): x is number => x != null))];
    const units = unitIds.length ? await prisma.hospitalUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [];
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    const now = Date.now();
    res.json({
      data: rows.map(({ _count, ...r }) => ({
        ...r, unitName: r.unitId ? unitName.get(r.unitId) ?? null : null, openActions: _count.actions,
        overdue: OPEN_RUN.includes(r.status) && !!r.dueDate && r.dueDate.getTime() < now,
      })),
    });
  } catch (error) { fail(res, error, 'load audits'); }
};

export const createRun = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body ?? {};
    const checklistId = intId(b.checklistId, 'checklistId');
    if (!checklistId) throw new ValidationError('checklistId is required');
    const checklist = await prisma.auditChecklist.findUnique({ where: { id: checklistId }, select: { id: true, name: true, isActive: true } });
    if (!checklist?.isActive) throw new ValidationError('checklist does not exist or is inactive');
    let unitId: number | null;
    try { unitId = await assertUnit(b.unitId); } catch (e) { throw new ValidationError((e as Error).message); }
    const manager = await isManager(req.user?.id);
    const headed = typeof req.user?.id === 'number' ? await unitIdsHeadedBy(req.user.id) : [];
    if (!manager && !(unitId != null && headed.includes(unitId))) {
      res.status(403).json({ message: 'Only the Quality Manager or the unit HOD can schedule an audit' });
      return;
    }
    const auditorId = intId(b.auditorId, 'auditorId') ?? null;
    const auditor = auditorId ? await activeUser(auditorId) : null;
    if (auditorId && !auditor) throw new ValidationError('auditorId does not match an active user');

    let row = null;
    for (let attempt = 1; !row; attempt++) {
      try {
        row = await prisma.auditRun.create({
          data: {
            code: await nextRunCode(), checklistId, unitId,
            location: str(b.location, 'location', 160) ?? null,
            dueDate: dateField(b.dueDate, 'dueDate') ?? null,
            auditorId, auditor: auditor?.name ?? null,
            notes: str(b.notes, 'notes') ?? null,
            createdById: typeof req.user?.id === 'number' ? req.user.id : null,
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002' || attempt >= 5) throw err;
      }
    }
    await auditLog(req, { module: 'quality-audit', action: 'CREATE', entityType: 'AuditRun', entityId: row.id, payload: { code: row.code, checklistId, unitId, auditorId } });
    if (auditorId && auditorId !== req.user?.id) {
      void bell([auditorId], {
        type: 'audit_assigned', runId: row.id, title: `Audit assigned to you · ${row.code}`,
        message: `${checklist.name}${row.dueDate ? ` — due ${moment(row.dueDate).tz(TZ).format('DD MMM')}` : ''}`,
      });
    }
    res.status(201).json({ data: row });
  } catch (error) { fail(res, error, 'schedule audit'); }
};

/** Reschedule / reassign / cancel an open audit. */
export const updateRun = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await prisma.auditRun.findUnique({ where: { id: req.params.id }, include: { checklist: { select: { name: true } } } });
    if (!run) { res.status(404).json({ message: 'Audit not found' }); return; }
    const perms = await runPermissions(req.user?.id, run);
    if (!perms.canManage) {
      res.status(run.status === 'completed' || run.status === 'cancelled' ? 409 : 403)
        .json({ message: OPEN_RUN.includes(run.status) ? 'Only the Quality Manager or the unit HOD can change this audit' : `This audit is ${run.status}` });
      return;
    }
    const b = req.body ?? {};
    if (b.status !== undefined && b.status !== 'cancelled') throw new ValidationError("status can only be set to 'cancelled' here");
    const auditorId = intId(b.auditorId, 'auditorId');
    const auditor = auditorId ? await activeUser(auditorId) : null;
    if (auditorId && !auditor) throw new ValidationError('auditorId does not match an active user');
    const data = {
      ...(b.dueDate !== undefined && { dueDate: dateField(b.dueDate, 'dueDate') ?? null }),
      ...(b.location !== undefined && { location: str(b.location, 'location', 160) ?? null }),
      ...(b.notes !== undefined && { notes: str(b.notes, 'notes') ?? null }),
      ...(auditorId !== undefined && { auditorId, auditor: auditor?.name ?? null }),
      ...(b.status === 'cancelled' && { status: 'cancelled' }),
    };
    const { count } = await prisma.auditRun.updateMany({ where: { id: run.id, status: run.status }, data });
    if (count !== 1) { res.status(409).json({ message: 'Audit was changed by someone else — reload' }); return; }
    await auditLog(req, { module: 'quality-audit', action: b.status === 'cancelled' ? 'STATUS_CHANGE' : 'UPDATE', entityType: 'AuditRun', entityId: run.id, payload: data });
    if (auditorId && auditorId !== run.auditorId && auditorId !== req.user?.id) {
      void bell([auditorId], { type: 'audit_assigned', runId: run.id, title: `Audit assigned to you · ${run.code}`, message: run.checklist.name });
    }
    res.json({ data: await prisma.auditRun.findUnique({ where: { id: run.id } }) });
  } catch (error) { fail(res, error, 'update audit'); }
};

export const getRun = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await runReadScope(req.user?.id);
    const run = await prisma.auditRun.findFirst({
      where: { id: req.params.id, ...(scope && { AND: [scope] }) },
      include: {
        checklist: { select: { id: true, code: true, name: true, group: true, description: true } },
        responses: true,
        actions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) { res.status(404).json({ message: 'Audit not found' }); return; }

    // Items: everything answered on this run, plus (while open) every active item.
    const answered = new Set(run.responses.map((r) => r.itemId));
    const items = await prisma.auditChecklistItem.findMany({
      where: { checklistId: run.checklistId, OR: [{ id: { in: [...answered] } }, ...(OPEN_RUN.includes(run.status) ? [{ isActive: true }] : [])] },
      orderBy: { sortOrder: 'asc' },
    });

    // Effectiveness: the previous and next completed audit of the same
    // checklist + unit — was each NC here already an NC, and is it fixed next time?
    const sameScope = { checklistId: run.checklistId, unitId: run.unitId, status: 'completed', id: { not: run.id } };
    const at = run.completedAt ?? new Date();
    const [prev, next] = await Promise.all([
      prisma.auditRun.findFirst({ where: { ...sameScope, completedAt: { lt: at } }, orderBy: { completedAt: 'desc' }, select: { id: true, code: true, completedAt: true, compliancePct: true, responses: { select: { itemId: true, result: true } } } }),
      run.completedAt
        ? prisma.auditRun.findFirst({ where: { ...sameScope, completedAt: { gt: at } }, orderBy: { completedAt: 'asc' }, select: { id: true, code: true, completedAt: true, compliancePct: true, responses: { select: { itemId: true, result: true } } } })
        : null,
    ]);
    const prevResult = new Map(prev?.responses.map((r) => [r.itemId, r.result]) ?? []);
    const nextResult = new Map(next?.responses.map((r) => [r.itemId, r.result]) ?? []);

    const [unit, permissions] = await Promise.all([
      run.unitId ? prisma.hospitalUnit.findUnique({ where: { id: run.unitId }, select: { id: true, name: true } }) : null,
      runPermissions(req.user?.id, run),
    ]);
    const locked = run.status !== 'completed';
    res.json({
      data: {
        ...run,
        unit,
        items: items.map((it) => ({
          ...it,
          previousResult: prevResult.get(it.id) ?? null,
          nextResult: nextResult.get(it.id) ?? null,
        })),
        previousRun: prev ? { id: prev.id, code: prev.code, completedAt: prev.completedAt, compliancePct: prev.compliancePct } : null,
        nextRun: next ? { id: next.id, code: next.code, completedAt: next.completedAt, compliancePct: next.compliancePct } : null,
        actions: run.actions.map((a) => ({
          ...a,
          canComplete: !locked && (permissions.canManageActions || (a.ownerId != null && a.ownerId === req.user?.id)),
        })),
        permissions,
      },
    });
  } catch (error) { fail(res, error, 'load audit'); }
};

/** Save answers (partial saves allowed) while the audit is open. */
export const saveResponses = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await prisma.auditRun.findUnique({ where: { id: req.params.id } });
    if (!run) { res.status(404).json({ message: 'Audit not found' }); return; }
    if (!OPEN_RUN.includes(run.status)) { res.status(409).json({ message: `This audit is ${run.status}` }); return; }
    if (!(await runPermissions(req.user?.id, run)).canConduct) {
      res.status(403).json({ message: 'Only the assigned auditor, the unit HOD or the Quality Manager can conduct this audit' });
      return;
    }
    const b = req.body ?? {};
    if (!Array.isArray(b.responses)) throw new ValidationError('responses must be a list');
    const items = await prisma.auditChecklistItem.findMany({ where: { checklistId: run.checklistId }, select: { id: true } });
    const own = new Set(items.map((i) => i.id));
    const parsed = (b.responses as Array<Record<string, unknown>>).map((r, i) => {
      const itemId = intId(r?.itemId, `responses[${i}].itemId`);
      if (!itemId || !own.has(itemId)) throw new ValidationError(`responses[${i}].itemId is not an item of this checklist`);
      if (!RESULTS.includes(r.result as typeof RESULTS[number])) throw new ValidationError(`responses[${i}].result must be yes, no or na`);
      return { itemId, result: r.result as string, remark: str(r.remark, `responses[${i}].remark`, 2000) ?? null };
    });
    const notes = str(b.notes, 'notes');
    await prisma.$transaction([
      ...parsed.map((p) => prisma.auditRunResponse.upsert({
        where: { runId_itemId: { runId: run.id, itemId: p.itemId } },
        create: { runId: run.id, ...p }, update: { result: p.result, remark: p.remark },
      })),
      prisma.auditRun.update({
        where: { id: run.id },
        data: { status: 'in_progress', startedAt: run.startedAt ?? new Date(), ...(notes !== undefined && { notes }) },
      }),
    ]);
    res.json({ data: { saved: parsed.length } });
  } catch (error) { fail(res, error, 'save answers'); }
};

/**
 * Submit: every active item must be answered and every "no" needs a remark.
 * Scores the audit, alerts on critical NCs and feeds the linked indicators.
 */
export const submitRun = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await prisma.auditRun.findUnique({
      where: { id: req.params.id },
      include: { checklist: { select: { name: true } }, responses: { include: { item: true } } },
    });
    if (!run) { res.status(404).json({ message: 'Audit not found' }); return; }
    if (!OPEN_RUN.includes(run.status)) { res.status(409).json({ message: `This audit is ${run.status}` }); return; }
    if (!(await runPermissions(req.user?.id, run)).canConduct) {
      res.status(403).json({ message: 'Only the assigned auditor, the unit HOD or the Quality Manager can submit this audit' });
      return;
    }
    const active = await prisma.auditChecklistItem.findMany({ where: { checklistId: run.checklistId, isActive: true }, select: { id: true } });
    const answered = new Set(run.responses.map((r) => r.itemId));
    const missing = active.filter((i) => !answered.has(i.id)).length;
    if (missing) throw new ValidationError(`${missing} question(s) are not answered yet`);
    const noRemark = run.responses.filter((r) => r.result === 'no' && !r.remark?.trim()).length;
    if (noRemark) throw new ValidationError(`Add a remark to each "No" answer (${noRemark} missing) — it is the evidence for the finding`);

    const applicable = run.responses.filter((r) => r.result !== 'na');
    const compliant = applicable.filter((r) => r.result === 'yes').length;
    const nc = applicable.filter((r) => r.result === 'no');
    const criticalNc = nc.filter((r) => r.item.critical);
    const now = new Date();
    const data = {
      status: 'completed', completedAt: now,
      applicableCount: applicable.length, compliantCount: compliant, ncCount: nc.length, criticalNcCount: criticalNc.length,
      compliancePct: applicable.length ? Math.round((compliant / applicable.length) * 1000) / 10 : null,
    };
    const { count } = await prisma.auditRun.updateMany({ where: { id: run.id, status: run.status }, data });
    if (count !== 1) { res.status(409).json({ message: 'Audit was changed by someone else — reload' }); return; }

    // Feed audit-backed indicators: one observation per answered tagged item.
    let unitName: string | null = null;
    if (run.unitId) unitName = (await prisma.hospitalUnit.findUnique({ where: { id: run.unitId }, select: { name: true } }))?.name ?? null;
    const obs = applicable.filter((r) => r.item.qiCode && AUDIT_QI.has(r.item.qiCode));
    if (obs.length) {
      await prisma.qualityAuditObservation.createMany({
        data: obs.map((r) => ({
          qiCode: r.item.qiCode as string,
          observedAt: now,
          period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          location: (run.location || unitName || null)?.slice(0, 190) ?? null,
          checkpointKey: `audit:${run.code}:${r.itemId}`,
          checkpointLabel: r.item.text.slice(0, 190),
          compliant: r.result === 'yes',
          notes: r.remark,
          auditor: run.auditor ?? req.user?.username ?? null,
          auditorId: run.auditorId ?? (typeof req.user?.id === 'number' ? req.user.id : null),
        })),
      });
    }

    await auditLog(req, {
      module: 'quality-audit', action: 'STATUS_CHANGE', entityType: 'AuditRun', entityId: run.id,
      payload: { from: run.status, to: 'completed', ...data, observations: obs.length },
    });
    if (criticalNc.length) {
      const heads = await unitHeadUserIds(run.unitId);
      void bell([...heads, ...(await incidentManagerUserIds())], {
        type: 'audit_critical_nc', runId: run.id, critical: true,
        title: `Critical audit finding · ${run.code}`,
        message: `${run.checklist.name}${unitName ? ` · ${unitName}` : ''}: ${criticalNc.length} critical non-compliance(s) — assign corrective actions.`,
      });
    }
    res.json({ data: { ...data, observations: obs.length } });
  } catch (error) { fail(res, error, 'submit audit'); }
};

// ─── Finding actions ────────────────────────────────────────────────────

export const createFindingAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await prisma.auditRun.findUnique({ where: { id: req.params.id }, include: { checklist: { select: { name: true } } } });
    if (!run) { res.status(404).json({ message: 'Audit not found' }); return; }
    if (run.status !== 'completed') { res.status(409).json({ message: 'Actions are added after the audit is submitted' }); return; }
    if (!(await runPermissions(req.user?.id, run)).canManageActions) {
      res.status(403).json({ message: 'Only the Quality Manager or the unit HOD can add actions' });
      return;
    }
    const b = req.body ?? {};
    const itemId = intId(b.itemId, 'itemId');
    const finding = itemId ? await prisma.auditRunResponse.findUnique({ where: { runId_itemId: { runId: run.id, itemId } } }) : null;
    if (!finding || finding.result !== 'no') throw new ValidationError('itemId must be a "No" finding of this audit');
    const description = str(b.description, 'description');
    if (!description || description.length < 3) throw new ValidationError('description is required (min 3 chars)');
    const ownerId = intId(b.ownerId, 'ownerId') ?? null;
    const owner = ownerId ? await activeUser(ownerId) : null;
    if (ownerId && !owner) throw new ValidationError('ownerId does not match an active user');
    const row = await prisma.auditFindingAction.create({
      data: {
        runId: run.id, itemId: itemId as number, description, ownerId, owner: owner?.name ?? null,
        dueDate: dateField(b.dueDate, 'dueDate') ?? null, createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, { module: 'quality-audit', action: 'CREATE', entityType: 'AuditFindingAction', entityId: row.id, payload: { runId: run.id, itemId, ownerId } });
    if (ownerId && ownerId !== req.user?.id) {
      void bell([ownerId], {
        type: 'audit_action_assigned', runId: run.id, title: `Audit action assigned to you · ${run.code}`,
        message: `${run.checklist.name}: ${description.slice(0, 140)}${row.dueDate ? ` — due ${moment(row.dueDate).tz(TZ).format('DD MMM')}` : ''}`,
      });
    }
    res.status(201).json({ data: row });
  } catch (error) { fail(res, error, 'add action'); }
};

/** Same rules as incident CAPA actions: managers / HOD edit anything; the owner only completes / reopens with a note. */
export const updateFindingAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const action = await prisma.auditFindingAction.findFirst({
      where: { id: req.params.actionId, runId: req.params.id }, include: { run: true },
    });
    if (!action) { res.status(404).json({ message: 'Action not found' }); return; }
    const perms = await runPermissions(req.user?.id, action.run);
    const isOwner = action.ownerId != null && action.ownerId === req.user?.id;
    if (!perms.canManageActions && !isOwner) { res.status(403).json({ message: 'Only the Quality Manager, the unit HOD or the action owner can update this action' }); return; }
    const b = req.body ?? {};
    if (!perms.canManageActions && ['description', 'ownerId', 'dueDate'].some((k) => b[k] !== undefined)) {
      res.status(403).json({ message: 'The action owner can only mark the action done or reopen it' });
      return;
    }
    if (b.status !== undefined && !['open', 'done', 'dropped'].includes(b.status)) throw new ValidationError('status must be open, done or dropped');
    if (!perms.canManageActions && b.status === 'dropped') { res.status(403).json({ message: 'Only the Quality Manager or the unit HOD can drop an action' }); return; }
    const description = str(b.description, 'description');
    if (description !== undefined && (!description || description.length < 3)) throw new ValidationError('description cannot be empty');
    const completionNote = str(b.completionNote, 'completionNote');
    const ownerId = intId(b.ownerId, 'ownerId');
    const owner = ownerId ? await activeUser(ownerId) : null;
    if (ownerId && !owner) throw new ValidationError('ownerId does not match an active user');
    const to: string = b.status ?? action.status;
    const changed = to !== action.status;
    const note = completionNote !== undefined ? completionNote : action.completionNote;
    if (changed && to !== 'open' && !note) throw new ValidationError(to === 'done' ? 'Add a note on what was done' : 'Add a note on why the action is dropped');
    const now = new Date();
    const data = {
      ...(description !== undefined && { description: description as string }),
      ...(ownerId !== undefined && { ownerId, owner: owner?.name ?? null }),
      ...(b.dueDate !== undefined && { dueDate: dateField(b.dueDate, 'dueDate') ?? null }),
      ...(completionNote !== undefined && { completionNote }),
      ...(changed && { status: to, ...(to === 'open' ? { completedAt: null, completedBy: null } : { completedAt: now, completedBy: req.user?.username ?? null }) }),
    };
    const { count } = await prisma.auditFindingAction.updateMany({ where: { id: action.id, status: action.status }, data });
    if (count !== 1) { res.status(409).json({ message: 'Action was changed by someone else — reload' }); return; }
    await auditLog(req, {
      module: 'quality-audit', action: 'UPDATE', entityType: 'AuditFindingAction', entityId: action.id,
      payload: { ...(changed && { from: action.status, to }), ...(ownerId !== undefined && { ownerTo: ownerId }), ...(description !== undefined && description !== action.description && { previousDescription: action.description }) },
    });
    if (ownerId && ownerId !== action.ownerId && ownerId !== req.user?.id) {
      void bell([ownerId], { type: 'audit_action_assigned', runId: action.runId, title: `Audit action assigned to you · ${action.run.code}`, message: (description ?? action.description).slice(0, 140) });
    }
    res.json({ data: await prisma.auditFindingAction.findUnique({ where: { id: action.id } }) });
  } catch (error) { fail(res, error, 'update action'); }
};

// ─── Summary (dashboard) ────────────────────────────────────────────────

export const auditSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await isReader(req.user?.id))) { res.status(403).json({ message: 'Quality dashboards only' }); return; }
    const q = req.query as Record<string, string | undefined>;
    const day = (v: string | undefined, end: boolean) => {
      if (!v) return undefined;
      const m = moment.tz(v, 'YYYY-MM-DD', true, TZ);
      if (!m.isValid()) throw new ValidationError('from / to must be YYYY-MM-DD');
      return (end ? m.endOf('day') : m.startOf('day')).toDate();
    };
    const to = day(q.to, true) ?? moment.tz(TZ).endOf('day').toDate();
    const from = day(q.from, false) ?? moment.tz(to, TZ).subtract(89, 'days').startOf('day').toDate();
    const unitId = q.unitId && /^\d+$/.test(q.unitId) ? Number(q.unitId) : undefined;
    const now = new Date();

    const [done, openRuns, actions] = await Promise.all([
      prisma.auditRun.findMany({
        where: { status: 'completed', completedAt: { gte: from, lte: to }, ...(unitId && { unitId }) },
        select: { checklistId: true, unitId: true, applicableCount: true, compliantCount: true, ncCount: true, criticalNcCount: true, checklist: { select: { name: true, group: true } } },
      }),
      prisma.auditRun.findMany({ where: { status: { in: OPEN_RUN }, ...(unitId && { unitId }) }, select: { dueDate: true } }),
      prisma.auditFindingAction.findMany({ where: { status: 'open', ...(unitId && { run: { unitId } }) }, select: { dueDate: true } }),
    ]);
    type Agg = { key: string; label: string; group?: string; audits: number; applicable: number; compliant: number; nc: number; criticalNc: number };
    const add = (m: Map<string, Agg>, key: string, label: string, r: typeof done[number], group?: string) => {
      const a = m.get(key) ?? { key, label, group, audits: 0, applicable: 0, compliant: 0, nc: 0, criticalNc: 0 };
      a.audits += 1; a.applicable += r.applicableCount ?? 0; a.compliant += r.compliantCount ?? 0;
      a.nc += r.ncCount ?? 0; a.criticalNc += r.criticalNcCount ?? 0;
      m.set(key, a);
    };
    const byChecklist = new Map<string, Agg>();
    const byUnit = new Map<string, Agg>();
    const total: Agg = { key: 'all', label: 'All', audits: 0, applicable: 0, compliant: 0, nc: 0, criticalNc: 0 };
    const unitIds = [...new Set(done.map((r) => r.unitId).filter((x): x is number => x != null))];
    const units = unitIds.length ? await prisma.hospitalUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [];
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    for (const r of done) {
      total.audits += 1; total.applicable += r.applicableCount ?? 0; total.compliant += r.compliantCount ?? 0;
      total.nc += r.ncCount ?? 0; total.criticalNc += r.criticalNcCount ?? 0;
      add(byChecklist, String(r.checklistId), r.checklist.name, r, r.checklist.group);
      add(byUnit, r.unitId != null ? String(r.unitId) : '—', r.unitId != null ? unitName.get(r.unitId) ?? `Unit ${r.unitId}` : 'No unit', r);
    }
    const pct = (a: Agg) => ({
      ...a,
      compliancePct: a.applicable ? Math.round((a.compliant / a.applicable) * 1000) / 10 : null,
      ncPct: a.applicable ? Math.round((a.nc / a.applicable) * 1000) / 10 : null,
    });
    res.json({
      window: { from, to },
      summary: {
        ...pct(total),
        openAudits: openRuns.length,
        overdueAudits: openRuns.filter((r) => r.dueDate && r.dueDate < now).length,
        openActions: actions.length,
        overdueActions: actions.filter((a) => a.dueDate && a.dueDate < now).length,
      },
      byChecklist: [...byChecklist.values()].map(pct).sort((a, b) => (a.compliancePct ?? 101) - (b.compliancePct ?? 101)),
      byUnit: [...byUnit.values()].map(pct).sort((a, b) => (a.compliancePct ?? 101) - (b.compliancePct ?? 101)),
    });
  } catch (error) { fail(res, error, 'load audit summary'); }
};
