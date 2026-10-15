import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { runComplaintSlaSweep } from './complaint-sla.cron';
import {
  findPossibleDuplicateComplaints, createWithComplaintCode, deriveComplaintDepartment,
} from '../../service/incident-complaint-link';
import { complaintReadScope } from '../_shared/quality-roles';

// Phase 9.25 / Phase 4 — Complaint workflow.
//
// Complaints can arrive from a low-NPS survey (created by feedback.controller),
// the WhatsApp bot, or be raised manually by any staff member. Reads are
// scoped by complaintReadScope; status / assign / bulk / sweep are for
// complaint handlers only (enforced on the routes).

const VALID_STATUSES = ['open', 'acknowledged', 'resolved', 'escalated'] as const;
const VALID_SEVERITIES = ['low', 'medium', 'high'] as const;
const VALID_CHANNELS = ['sms', 'whatsapp', 'kiosk', 'phone', 'in-person', 'survey-auto'] as const;

type Status = (typeof VALID_STATUSES)[number];

// Allowed status moves. resolved → acknowledged is a reopen.
const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  open: ['acknowledged', 'escalated'],
  acknowledged: ['resolved', 'escalated'],
  escalated: ['acknowledged', 'resolved'],
  resolved: ['acknowledged'],
};

const LIST_DEFAULT_TAKE = 100;
const LIST_MAX_TAKE = 500;

class ValidationError extends Error {}

function parseDateQuery(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a date`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be a valid date`);
  return d;
}

function parseStringField(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  return value;
}

function parseIdField(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return n;
}

function parseIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ValidationError(`${field} must be a non-negative integer`);
  return Math.min(Number(value), max);
}

/** undefined → unchanged, null/'' → clear, otherwise must match a Department.name. */
async function parseDepartment(value: unknown): Promise<string | null | undefined> {
  const raw = parseStringField(value, 'department');
  if (raw === undefined) return undefined;
  const name = raw?.trim();
  if (!name) return null;
  const dept = await prisma.department.findUnique({ where: { name }, select: { name: true } });
  if (!dept) throw new ValidationError(`department '${name}' does not exist`);
  return dept.name;
}

function slaHoursFor(severity: 'low' | 'medium' | 'high'): number {
  return severity === 'high' ? 24 : severity === 'medium' ? 72 : 168;
}

/** Whether the caller's read scope (quality-roles.complaintReadScope) covers this complaint. */
async function canReadComplaint(id: string, userId: number | undefined): Promise<boolean> {
  const scope = await complaintReadScope(userId);
  if (!scope) return true;
  return (await prisma.complaint.count({ where: { AND: [{ id }, scope] } })) > 0;
}

type NotifyKind = 'complaint_assigned' | 'complaint_resolved';

async function notifyComplaint(opts: {
  kind: NotifyKind; complaintId: string; code: string; severity: string; summary: string; userId: number;
}): Promise<void> {
  try {
    const subject = opts.kind === 'complaint_assigned' ? 'Complaint assigned to you' : 'A complaint you raised was resolved';
    await prisma.notification.create({
      data: {
        type: opts.kind,
        title: `${subject} · ${opts.code}`,
        message: `[${opts.severity.toUpperCase()}] ${opts.summary.slice(0, 180)}`,
        status: 'unread',
        userId: opts.userId,
        entityId: 0, // entityId is Int; complaint id is a uuid → real id in entityType.
        entityType: `Complaint:${opts.complaintId}`,
      },
    });
  } catch (err) {
    console.warn('[complaint:notify] failed:', (err as Error).message);
  }
}

interface CreateBody {
  patientPrn?: string | null;
  patientName?: string | null;
  channel?: string;
  description?: string;
  severity?: string;
  department?: string | null;
  // Phase 6 / Concern #4 — encounter FKs for dedup matching.
  appointmentId?: number | string | null;
  admissionId?: string | null;
  emergencyId?: number | string | null;
  // Operator override — proceed even when possibleDuplicates were surfaced.
  proceedDespiteDuplicate?: boolean;
}

export const createComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) {
      res.status(401).json({ message: 'Authenticated staff user required' });
      return;
    }
    const body = (req.body ?? {}) as CreateBody;
    if (typeof body.description !== 'string' || body.description.trim().length < 3) {
      res.status(400).json({ message: 'description is required' });
      return;
    }
    if (!body.severity || !VALID_SEVERITIES.includes(body.severity as typeof VALID_SEVERITIES[number])) {
      res.status(400).json({ message: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
      return;
    }
    if (!body.channel || !VALID_CHANNELS.includes(body.channel as typeof VALID_CHANNELS[number])) {
      res.status(400).json({ message: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
      return;
    }
    const appointmentId = parseIdField(body.appointmentId, 'appointmentId') ?? null;
    const emergencyId = parseIdField(body.emergencyId, 'emergencyId') ?? null;
    const admissionId = parseStringField(body.admissionId, 'admissionId')?.trim() || null;
    const patientName = parseStringField(body.patientName, 'patientName')?.trim() || null;
    if (body.patientPrn != null && typeof body.patientPrn !== 'string' && typeof body.patientPrn !== 'number') {
      throw new ValidationError('patientPrn must be a string');
    }
    const patientPrn = body.patientPrn != null ? String(body.patientPrn).trim() || null : null;
    const department = (await parseDepartment(body.department))
      ?? await deriveComplaintDepartment({ appointmentId, admissionId, emergencyId });

    // Phase 6 / Option A — surface possible duplicates (same encounter or PRN,
    // last 30d, still open). Doesn't block — operator can resubmit with
    // proceedDespiteDuplicate=true to bypass.
    if (body.proceedDespiteDuplicate !== true) {
      const dupes = await findPossibleDuplicateComplaints({ patientPrn, admissionId, appointmentId, emergencyId });
      if (dupes.length > 0) {
        res.status(409).json({
          message: 'Possible duplicate complaint(s) found for this patient/encounter.',
          possibleDuplicates: dupes,
          hint: 'Resubmit with proceedDespiteDuplicate=true to create anyway.',
        });
        return;
      }
    }

    const severity = body.severity as 'low' | 'medium' | 'high';
    const slaDueAt = new Date(Date.now() + slaHoursFor(severity) * 60 * 60 * 1000);
    const row = await createWithComplaintCode((code) => prisma.complaint.create({
      data: {
        code,
        patientPrn,
        patientName,
        channel: body.channel as string,
        source: 'manual',
        description: (body.description as string).trim(),
        severity,
        slaDueAt,
        department,
        raisedById: userId,
        appointmentId,
        admissionId,
        emergencyId,
      },
    }));
    await auditLog(req, { module: 'complaint', action: 'CREATE', entityType: 'Complaint', entityId: row.id, payload: { code: row.code, department } });
    res.status(201).json({ data: row });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[complaint] create failed:', error);
    res.status(500).json({ message: 'Failed to raise complaint' });
  }
};

export const listComplaints = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, unknown>;
    const str = (k: string): string | undefined => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);
    const status = str('status');
    const severity = str('severity');
    const source = str('source');
    const patientPrn = str('patientPrn');
    const department = str('department');
    const from = parseDateQuery(q['from'], 'from');
    const to = parseDateQuery(q['to'], 'to');
    const take = Math.max(1, parseIntQuery(q['take'], 'take', LIST_DEFAULT_TAKE, LIST_MAX_TAKE));
    const skip = parseIntQuery(q['skip'], 'skip', 0, Number.MAX_SAFE_INTEGER);
    const assignedToId = parseIdField(q['assignedToId'], 'assignedToId');
    const assigneeFilter = q['mine'] === 'true' && typeof req.user?.id === 'number' ? req.user.id : assignedToId ?? undefined;

    const scope = await complaintReadScope(req.user?.id);
    const where: Prisma.ComplaintWhereInput = {
      ...(scope && { AND: [scope] }),
      ...(status && { status }),
      ...(severity && { severity }),
      ...(source && { source }),
      ...(patientPrn && { patientPrn }),
      ...(department && { department }),
      ...(assigneeFilter !== undefined && { assignedToId: assigneeFilter }),
      ...((from || to) && { raisedAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
    };
    const [rows, total] = await Promise.all([
      prisma.complaint.findMany({ where, orderBy: { raisedAt: 'desc' }, take, skip }),
      prisma.complaint.count({ where }),
    ]);
    res.status(200).json({ data: rows, total, take, skip });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[complaint] list failed:', error);
    res.status(500).json({ message: 'Failed to load complaints' });
  }
};

export const getComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: { feedbackSurvey: true },
    });
    if (!row || !(await canReadComplaint(row.id, req.user?.id))) {
      res.status(404).json({ message: 'Complaint not found' });
      return;
    }

    // Phase 6 / Option A — resolve related incidents so the UI can render chips.
    let relatedIncidents: Array<{ id: string; code: string; category: string; severity: string; status: string }> = [];
    if (row.relatedIncidentIds) {
      try {
        const ids = JSON.parse(row.relatedIncidentIds);
        if (Array.isArray(ids) && ids.length > 0) {
          relatedIncidents = await prisma.incident.findMany({
            where: { id: { in: ids.filter((s): s is string => typeof s === 'string') } },
            select: { id: true, code: true, category: true, severity: true, status: true },
          });
        }
      } catch { /* ignore bad JSON */ }
    }
    const raisedBy = row.raisedById
      ? await prisma.user.findUnique({ where: { id: row.raisedById }, select: { username: true, fullName: true } })
      : null;

    res.status(200).json({
      data: { ...row, relatedIncidents, raisedByName: raisedBy ? raisedBy.fullName || raisedBy.username : null },
    });
  } catch (error) {
    console.error('[complaint] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch complaint' });
  }
};

interface StatusBody {
  status?: string;
  assignedTo?: string | null;
  assignedToId?: number | string | null;
  resolutionNotes?: string | null;
  department?: string | null;
}

/** Stamps for a status move — shared by the single and bulk endpoints. */
function transitionData(
  from: Status, to: Status, req: Request, escalatedAt: Date | null, now: Date,
): Prisma.ComplaintUpdateManyMutationInput {
  const data: Prisma.ComplaintUpdateManyMutationInput = { status: to };
  if (from === to) return data;
  if (to === 'resolved') {
    data.resolvedAt = now;
    data.resolvedBy = req.user?.username ?? null;
    data.resolvedById = typeof req.user?.id === 'number' ? req.user.id : null;
  }
  if (to === 'escalated' && !escalatedAt) data.escalatedAt = now;
  // Reopen — resolution stamps no longer apply.
  if (from === 'resolved') {
    data.resolvedAt = null;
    data.resolvedBy = null;
    data.resolvedById = null;
    data.resolutionNotes = null;
  }
  return data;
}

export const updateComplaintStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.complaint.findUnique({
      where: { id },
      select: { id: true, status: true, assignedToId: true, resolutionNotes: true, escalatedAt: true },
    });
    if (!existing) { res.status(404).json({ message: 'Complaint not found' }); return; }

    const body = (req.body ?? {}) as StatusBody;
    if (!body.status || !VALID_STATUSES.includes(body.status as Status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const from = existing.status as Status;
    const to = body.status as Status;
    const isTransition = from !== to;
    if (isTransition && !(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
      res.status(400).json({ message: `Cannot move complaint from '${from}' to '${to}'` });
      return;
    }

    const assignedToId = parseIdField(body.assignedToId, 'assignedToId');
    let assignedTo = parseStringField(body.assignedTo, 'assignedTo');
    const resolutionNotes = parseStringField(body.resolutionNotes, 'resolutionNotes');
    const department = await parseDepartment(body.department);

    if (assignedToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: assignedToId }, select: { username: true, fullName: true },
      });
      if (!assignee) { res.status(400).json({ message: 'assignedToId does not match a user' }); return; }
      if (!assignedTo?.trim()) assignedTo = assignee.fullName || assignee.username;
    }

    if (isTransition && to === 'resolved') {
      const notes = resolutionNotes !== undefined ? resolutionNotes : existing.resolutionNotes;
      if (!notes?.trim()) {
        res.status(400).json({ message: 'resolutionNotes are required to resolve a complaint' });
        return;
      }
    }

    const data: Prisma.ComplaintUpdateInput = {
      ...(assignedTo !== undefined && { assignedTo: assignedTo?.trim() || null }),
      ...(assignedToId !== undefined && { assignedToId }),
      ...(resolutionNotes !== undefined && { resolutionNotes: resolutionNotes?.trim() || null }),
      ...(department !== undefined && { department }),
      ...transitionData(from, to, req, existing.escalatedAt, new Date()),
    };

    const row = await prisma.complaint.update({ where: { id }, data });
    await auditLog(req, {
      module: 'complaint', action: 'STATUS_CHANGE', entityType: 'Complaint', entityId: id,
      payload: {
        from, to,
        ...(assignedToId !== undefined && { assignedToId }),
        ...(department !== undefined && { department }),
      },
    });

    if (assignedToId && assignedToId !== existing.assignedToId) {
      void notifyComplaint({
        kind: 'complaint_assigned', complaintId: row.id, code: row.code,
        severity: row.severity, summary: row.description, userId: assignedToId,
      });
    }
    if (isTransition && to === 'resolved' && row.raisedById && row.raisedById !== req.user?.id) {
      void notifyComplaint({
        kind: 'complaint_resolved', complaintId: row.id, code: row.code,
        severity: row.severity, summary: row.description, userId: row.raisedById,
      });
    }

    res.status(200).json({ data: row });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[complaint] updateStatus failed:', error);
    res.status(500).json({ message: 'Failed to update complaint status' });
  }
};

// Phase 6h — bulk status transition for the grievance officer inbox.

interface BulkStatusBody {
  ids?: unknown;
  status?: string;
  resolutionNotes?: string | null;
}

export const bulkUpdateStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as BulkStatusBody;
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      res.status(400).json({ message: "'ids' must be a non-empty array" });
      return;
    }
    if (body.ids.length > 200) {
      res.status(400).json({ message: 'Bulk update capped at 200 ids per call' });
      return;
    }
    if (!body.status || !VALID_STATUSES.includes(body.status as Status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const to = body.status as Status;
    const resolutionNotes = parseStringField(body.resolutionNotes, 'resolutionNotes')?.trim() || null;
    if (to === 'resolved' && !resolutionNotes) {
      res.status(400).json({ message: 'resolutionNotes are required to resolve complaints' });
      return;
    }
    const ids = Array.from(new Set(body.ids.filter((s): s is string => typeof s === 'string' && s.length > 0)));

    const rows = await prisma.complaint.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, status: true, escalatedAt: true, raisedById: true, severity: true, description: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = new Date();
    const skipped: Array<{ id: string; code?: string; reason: string }> = [];
    let updated = 0;

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { skipped.push({ id, reason: 'not found' }); continue; }
      const from = row.status as Status;
      if (from === to) { skipped.push({ id, code: row.code, reason: `already ${to}` }); continue; }
      if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
        skipped.push({ id, code: row.code, reason: `cannot move from '${from}' to '${to}'` });
        continue;
      }
      const data = transitionData(from, to, req, row.escalatedAt, now);
      if (to === 'resolved') data.resolutionNotes = resolutionNotes;
      // Conditional on the status we validated against — a concurrent change skips the row.
      const result = await prisma.complaint.updateMany({ where: { id, status: from }, data });
      if (result.count !== 1) { skipped.push({ id, code: row.code, reason: 'changed concurrently' }); continue; }
      updated += 1;
      if (to === 'resolved' && row.raisedById && row.raisedById !== req.user?.id) {
        void notifyComplaint({
          kind: 'complaint_resolved', complaintId: row.id, code: row.code,
          severity: row.severity, summary: row.description, userId: row.raisedById,
        });
      }
    }

    await auditLog(req, {
      module: 'complaint', action: 'BULK_STATUS', entityType: 'Complaint',
      entityId: 'bulk',
      payload: { requested: ids.length, updated, skipped: skipped.length, to },
    });

    res.status(200).json({ data: { requested: ids.length, updated, skipped: skipped.length, skippedRows: skipped } });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[complaint] bulk status failed:', error);
    res.status(500).json({ message: 'Failed bulk status update' });
  }
};

export const complaintStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await complaintReadScope(req.user?.id);
    const scoped = (where: Prisma.ComplaintWhereInput): Prisma.ComplaintWhereInput =>
      scope ? { AND: [scope, where] } : where;
    const byStatus = await prisma.complaint.groupBy({ by: ['status'], _count: { _all: true }, where: scoped({}) });
    const bySeverity = await prisma.complaint.groupBy({
      by: ['severity'],
      _count: { _all: true },
      where: scoped({ status: { in: ['open', 'acknowledged', 'escalated'] } }),
    });
    // SLA breaches — past dueAt and not resolved.
    const breached = await prisma.complaint.count({
      where: scoped({ slaDueAt: { lt: new Date() }, status: { not: 'resolved' } }),
    });
    res.status(200).json({
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      activeBySeverity: Object.fromEntries(bySeverity.map((g) => [g.severity, g._count._all])),
      slaBreached: breached,
    });
  } catch (error) {
    console.error('[complaint] stats failed:', error);
    res.status(500).json({ message: 'Failed to load stats' });
  }
};

// Phase 6a — manual trigger for the SLA breach sweep (ad-hoc / after a
// policy change). Reuses the cron runner.

export const triggerSlaSweep = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await runComplaintSlaSweep();
    await auditLog(req, {
      module: 'complaint', action: 'SLA_SWEEP', entityType: 'Complaint',
      entityId: 'bulk',
      payload: { checked: report.checked, escalated: report.escalated, failed: report.failed },
    });
    res.status(200).json({ data: report });
  } catch (error) {
    console.error('[complaint] sla-sweep failed:', error);
    res.status(500).json({ message: 'SLA sweep failed' });
  }
};

// Reusable complaint creation for non-HTTP callers (e.g. the WhatsApp bot).
// Mirrors createComplaint's persistence without the request/duplicate layer.
export async function createComplaintRecord(input: {
  description: string;
  severity?: 'low' | 'medium' | 'high';
  channel?: string;
  patientPrn?: string | null;
  patientName?: string | null;
  appointmentId?: number | null;
  admissionId?: string | null;
  emergencyId?: number | null;
}) {
  const severity = input.severity ?? 'medium';
  const slaDueAt = new Date(Date.now() + slaHoursFor(severity) * 60 * 60 * 1000);
  const department = await deriveComplaintDepartment(input);
  return createWithComplaintCode((code) => prisma.complaint.create({
    data: {
      code,
      patientPrn: input.patientPrn ?? null,
      patientName: input.patientName ?? null,
      channel: input.channel ?? 'whatsapp',
      source: 'manual',
      description: input.description.trim(),
      severity,
      slaDueAt,
      department,
      appointmentId: input.appointmentId ?? null,
      admissionId: input.admissionId ?? null,
      emergencyId: input.emergencyId ?? null,
    },
  }));
}
