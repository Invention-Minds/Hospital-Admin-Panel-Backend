import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import {
  COMPLAINT_CATEGORIES, DEFAULT_SLA_HOURS, SEVERITIES, isComplaintCategory, resolveComplaintSla,
} from '../../service/complaint-sla';

// Quality → Units & Escalation → Complaint deadlines.
// Rules give the resolution hours for a unit × complaint type × severity
// (any of them may be "any"). New complaints take the most specific match;
// existing complaints keep the deadline they already have.

class ValidationError extends Error {}
const MAX_HOURS = 24 * 90;
const MAX_NOTE = 300;

const handle = (res: Response, label: string, error: unknown): void => {
  if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
  if ((error as { code?: string })?.code === 'P2025') { res.status(404).json({ message: 'Rule not found' }); return; }
  console.error(`[complaint-sla] ${label} failed:`, error);
  res.status(500).json({ message: `Failed to ${label}` });
};

function parseHours(v: unknown): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_HOURS) {
    throw new ValidationError(`hours must be a whole number from 1 to ${MAX_HOURS}`);
  }
  return n;
}

function parseNote(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new ValidationError('note must be text');
  const t = v.trim();
  if (t.length > MAX_NOTE) throw new ValidationError(`note must be at most ${MAX_NOTE} characters`);
  return t || null;
}

/** The match keys; '' / null / undefined = any. */
async function parseKeys(b: Record<string, unknown>): Promise<{ unitId: number | null; category: string | null; severity: string | null }> {
  let unitId: number | null = null;
  if (b.unitId !== undefined && b.unitId !== null && b.unitId !== '') {
    const n = typeof b.unitId === 'string' && /^\d+$/.test(b.unitId) ? Number(b.unitId) : b.unitId;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ValidationError('unitId must be a unit id');
    if (!(await prisma.hospitalUnit.findUnique({ where: { id: n }, select: { id: true } }))) throw new ValidationError(`unit ${n} does not exist`);
    unitId = n;
  }
  let category: string | null = null;
  if (b.category !== undefined && b.category !== null && b.category !== '') {
    if (!isComplaintCategory(b.category)) throw new ValidationError('category is not a known complaint type');
    category = b.category;
  }
  let severity: string | null = null;
  if (b.severity !== undefined && b.severity !== null && b.severity !== '') {
    if (!(SEVERITIES as readonly unknown[]).includes(b.severity)) throw new ValidationError(`severity must be one of: ${SEVERITIES.join(', ')}`);
    severity = b.severity as string;
  }
  return { unitId, category, severity };
}

/** Any signed-in user — the complaint forms' type picker. */
export const listComplaintCategories = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ data: COMPLAINT_CATEGORIES });
};

export const listComplaintSlaRules = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rules = await prisma.complaintSlaRule.findMany({ orderBy: [{ unitId: 'asc' }, { category: 'asc' }, { severity: 'asc' }] });
    const unitIds = [...new Set(rules.map((r) => r.unitId).filter((x): x is number => x != null))];
    const units = unitIds.length
      ? await prisma.hospitalUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
      : [];
    res.status(200).json({
      data: {
        rules: rules.map((r) => ({ ...r, unitName: units.find((u) => u.id === r.unitId)?.name ?? null })),
        categories: COMPLAINT_CATEGORIES,
        defaults: DEFAULT_SLA_HOURS,
        maxHours: MAX_HOURS,
      },
    });
  } catch (error) { handle(res, 'load complaint deadline rules', error); }
};

export const createComplaintSlaRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const keys = await parseKeys(b);
    const hours = parseHours(b.hours);
    const note = parseNote(b.note) ?? null;
    if (!keys.unitId && !keys.category && !keys.severity) {
      throw new ValidationError('Pick at least a unit, a complaint type or a severity — "any / any / any" is the built-in default');
    }
    // MySQL unique indexes treat NULLs as distinct, so check explicitly.
    const dupe = await prisma.complaintSlaRule.findFirst({ where: keys, select: { id: true } });
    if (dupe) { res.status(409).json({ message: 'A rule for exactly this unit, type and severity already exists — edit it instead' }); return; }
    const row = await prisma.complaintSlaRule.create({ data: { ...keys, hours, note } });
    await auditLog(req, { module: 'quality', action: 'COMPLAINT_SLA_RULE_CREATE', entityType: 'ComplaintSlaRule', entityId: row.id, payload: { ...keys, hours } });
    res.status(201).json({ data: row });
  } catch (error) { handle(res, 'add the rule', error); }
};

export const updateComplaintSlaRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = /^\d+$/.test(req.params.ruleId) ? Number(req.params.ruleId) : NaN;
    if (!Number.isInteger(id)) { res.status(404).json({ message: 'Rule not found' }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const existing = await prisma.complaintSlaRule.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Rule not found' }); return; }
    const hours = b.hours !== undefined ? parseHours(b.hours) : undefined;
    const note = parseNote(b.note);
    const row = await prisma.complaintSlaRule.update({
      where: { id }, data: { ...(hours !== undefined && { hours }), ...(note !== undefined && { note }) },
    });
    await auditLog(req, {
      module: 'quality', action: 'COMPLAINT_SLA_RULE_UPDATE', entityType: 'ComplaintSlaRule', entityId: id,
      payload: { hoursFrom: existing.hours, hoursTo: row.hours },
    });
    res.status(200).json({ data: row });
  } catch (error) { handle(res, 'update the rule', error); }
};

export const deleteComplaintSlaRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = /^\d+$/.test(req.params.ruleId) ? Number(req.params.ruleId) : NaN;
    if (!Number.isInteger(id)) { res.status(404).json({ message: 'Rule not found' }); return; }
    const row = await prisma.complaintSlaRule.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality', action: 'COMPLAINT_SLA_RULE_DELETE', entityType: 'ComplaintSlaRule', entityId: id,
      payload: { unitId: row.unitId, category: row.category, severity: row.severity, hours: row.hours },
    });
    res.status(204).end();
  } catch (error) { handle(res, 'delete the rule', error); }
};

/** "Which rule applies?" — severity is required (every complaint has one). */
export const testComplaintSla = async (req: Request, res: Response): Promise<void> => {
  try {
    const keys = await parseKeys(req.query as Record<string, unknown>);
    if (!keys.severity) throw new ValidationError('severity is required');
    const r = await resolveComplaintSla({ unitId: keys.unitId, category: keys.category, severity: keys.severity });
    res.status(200).json({ data: r });
  } catch (error) { handle(res, 'work out the deadline', error); }
};
