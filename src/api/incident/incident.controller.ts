import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import { incidentReadScope } from '../_shared/quality-roles';
import { auditLog } from '../../service/app-audit';
import bucket from '../../config/googeCloudStorage';
import { resolveTargetRole } from '../../service/role-alias';

// ─── Phase 3 — Notifications helper ────────────────────────────────────
// Shared by manual raise, auto-rule raise, and status changes. Best-effort:
// we log and swallow failures so a flaky bell never blocks the audit chain.

type NotifyKind = 'incident_raised' | 'incident_assigned' | 'incident_closed';

async function notifyIncident(opts: {
  kind: NotifyKind;
  incidentId: string;
  code: string;
  severity: string;
  title: string;
  targetRole?: string | null;
  userId?: number | null;
  isCritical?: boolean;
}): Promise<void> {
  try {
    const subject = (() => {
      switch (opts.kind) {
        case 'incident_raised':   return 'Incident raised';
        case 'incident_assigned': return 'Incident assigned to you';
        case 'incident_closed':   return 'Your incident report was closed';
      }
    })();
    await prisma.notification.create({
      data: {
        type: opts.kind,
        title: `${subject} · ${opts.code}`,
        message: `[${opts.severity.toUpperCase()}] ${opts.title}`,
        status: 'unread',
        userId: opts.userId ?? undefined,
        targetRole: opts.targetRole ?? undefined,
        isCritical: !!opts.isCritical,
        entityId: 0, // entityId is Int; incident id is a uuid, so we use 0
                     // and put the real id in entityType below for resolution.
        entityType: `Incident:${opts.incidentId}`,
      },
    });
  } catch (err) {
    console.warn('[incident:notify] failed:', (err as Error).message);
  }
}

// Phase 9.24 / Phase 1 — Incident reporting (manual raise, inbox, status flow).
//
// Auto-capture (rule engine) is Phase 2 and uses `raiseAutoIncident` here so
// hooks elsewhere don't need to know the Prisma shape. Keep that exported.

const VALID_CATEGORIES = [
  'clinical', 'medication', 'documentation', 'fall', 'infection',
  'equipment', 'behavioural', 'security', 'other',
] as const;
const VALID_SEVERITIES = ['near_miss', 'minor', 'moderate', 'major', 'sentinel'] as const;
const VALID_STATUSES = ['open', 'triaged', 'investigated', 'capa_in_progress', 'closed', 'cancelled'] as const;

type Severity = (typeof VALID_SEVERITIES)[number];
type Status = (typeof VALID_STATUSES)[number];

const ACTIVE_STATUSES: Status[] = ['open', 'triaged', 'investigated', 'capa_in_progress'];

// Allowed status moves. closed → investigated and cancelled → open are reopens.
const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  open: ['triaged', 'cancelled'],
  triaged: ['investigated', 'cancelled', 'open'],
  investigated: ['capa_in_progress', 'closed', 'triaged'],
  capa_in_progress: ['closed', 'investigated'],
  closed: ['investigated'],
  cancelled: ['open'],
};

const EVIDENCE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

class ValidationError extends Error {}

/** undefined → leave unchanged, null/'' → clear, otherwise a valid Date (400 on garbage). */
function parseDateField(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new ValidationError(`${field} must be a date`);
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

/** Generate the next INC-YYYY-NNNN code (year-scoped, numeric max). */
async function nextIncidentCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INC-${year}-`;
  const rows = await prisma.$queryRaw<Array<{ maxSeq: bigint | number | null }>>`
    SELECT MAX(CAST(SUBSTRING(code, ${prefix.length + 1}) AS UNSIGNED)) AS maxSeq
    FROM Incident WHERE code LIKE ${prefix + '%'}`;
  const lastSeq = Number(rows[0]?.maxSeq ?? 0) || 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/** Runs `create` with a fresh code, retrying when a concurrent insert took it. */
async function createWithIncidentCode<T>(create: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const code = await nextIncidentCode();
    try {
      return await create(code);
    } catch (err) {
      const e = err as { code?: string; meta?: { target?: unknown } };
      const isCodeClash = e.code === 'P2002' && String(e.meta?.target ?? 'code').includes('code');
      if (!isCodeClash || attempt >= 5) throw err;
    }
  }
}

/** Whether the caller's read scope (see quality-roles.incidentReadScope) covers this incident. */
async function canReadIncident(id: string, userId: number | undefined): Promise<boolean> {
  const scope = await incidentReadScope(userId);
  if (!scope) return true;
  return (await prisma.incident.count({ where: { AND: [{ id }, scope] } })) > 0;
}

interface CreateBody {
  category?: string;
  severity?: string;
  title?: string;
  description?: string;
  patientPrn?: string | null;
  patientName?: string | null;
  admissionId?: string | null;
  emergencyId?: number | null;
  appointmentId?: number | null;
  ward?: string | null;
  department?: string | null;
  occurredAt?: string | null;
  nabhClause?: string | null;
  qiCode?: string | null;     // Phase 5c — optional QI indicator tag
  evidenceLinks?: Array<{ label: string; url: string }>;
}

export const createIncident = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateBody;
    if (!body.title || body.title.trim().length < 3) { res.status(400).json({ message: 'title is required (min 3 chars)' }); return; }
    if (!body.description || body.description.trim().length < 3) { res.status(400).json({ message: 'description is required' }); return; }
    if (!body.category || !VALID_CATEGORIES.includes(body.category as typeof VALID_CATEGORIES[number])) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    if (!body.severity || !VALID_SEVERITIES.includes(body.severity as Severity)) {
      res.status(400).json({ message: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
      return;
    }

    const emergencyId = parseIdField(body.emergencyId, 'emergencyId');
    const appointmentId = parseIdField(body.appointmentId, 'appointmentId');
    const occurredAt = parseDateField(body.occurredAt, 'occurredAt');
    const patientName = parseStringField(body.patientName, 'patientName');
    const admissionId = parseStringField(body.admissionId, 'admissionId');
    const ward = parseStringField(body.ward, 'ward');
    const department = parseStringField(body.department, 'department');
    const nabhClause = parseStringField(body.nabhClause, 'nabhClause');
    const qiCode = parseStringField(body.qiCode, 'qiCode');
    if (body.patientPrn != null && typeof body.patientPrn !== 'string' && typeof body.patientPrn !== 'number') {
      throw new ValidationError('patientPrn must be a string');
    }
    if (body.evidenceLinks !== undefined && body.evidenceLinks !== null && (
      !Array.isArray(body.evidenceLinks) ||
      body.evidenceLinks.some((l) => !l || typeof l.label !== 'string' || typeof l.url !== 'string')
    )) {
      throw new ValidationError('evidenceLinks must be an array of { label, url }');
    }

    const incident = await createWithIncidentCode((code) => prisma.incident.create({
      data: {
        code,
        category: body.category as string,
        severity: body.severity as string,
        source: 'manual',
        title: (body.title as string).trim(),
        description: (body.description as string).trim(),
        patientPrn: body.patientPrn != null ? String(body.patientPrn) : null,
        patientName: patientName ?? null,
        admissionId: admissionId || null,
        emergencyId: emergencyId ?? null,
        appointmentId: appointmentId ?? null,
        ward: ward ?? null,
        department: department ?? null,
        occurredAt: occurredAt ?? null,
        nabhClause: nabhClause ?? null,
        qiCode: qiCode || null,
        evidenceLinks: body.evidenceLinks ? JSON.stringify(body.evidenceLinks) : null,
        reportedBy: req.user?.username ?? null,
        reportedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    }));

    await auditLog(req, {
      module: 'incident', action: 'CREATE', entityType: 'Incident',
      entityId: incident.id, payload: { code: incident.code, category: body.category, severity: body.severity },
    });

    // Bell — admins triage. Alias-resolved so an operator can re-route via
    // /settings/role-aliases without code changes.
    void (async () => {
      const targetRole = await resolveTargetRole('admin');
      await notifyIncident({
        kind: 'incident_raised', incidentId: incident.id, code: incident.code,
        severity: incident.severity, title: incident.title, targetRole,
        isCritical: incident.severity === 'major' || incident.severity === 'sentinel',
      });
    })();

    res.status(201).json({ data: incident });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[incident] create failed:', error);
    res.status(500).json({ message: 'Failed to raise incident' });
  }
};

/**
 * Internal helper used by the Phase-2 auto-capture engine. Idempotent so a
 * cron sweep can't raise duplicates:
 *   - qiCode given  → one incident per ruleKey + qiCode + period (title/description
 *                     contains qiPeriod), across every status except cancelled.
 *   - otherwise     → one active incident per ruleKey + most specific entity
 *                     (admission > emergency > appointment > PRN).
 */
export const raiseAutoIncident = async (opts: {
  ruleKey: string;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  nabhClause?: string | null;
  patientPrn?: string | null;
  patientName?: string | null;
  admissionId?: string | null;
  emergencyId?: number | null;
  appointmentId?: number | null;
  ward?: string | null;
  department?: string | null;
  occurredAt?: Date | null;
  qiCode?: string | null;
  qiPeriod?: string | null;
}): Promise<{ created: boolean; code?: string; incidentId?: string }> => {
  let dedupeWhere: Prisma.IncidentWhereInput;
  if (opts.qiCode) {
    dedupeWhere = {
      ruleKey: opts.ruleKey,
      qiCode: opts.qiCode,
      status: { not: 'cancelled' },
      ...(opts.qiPeriod && {
        OR: [{ title: { contains: opts.qiPeriod } }, { description: { contains: opts.qiPeriod } }],
      }),
    };
  } else {
    const entity: Prisma.IncidentWhereInput | null =
      opts.admissionId ? { admissionId: opts.admissionId }
      : opts.emergencyId ? { emergencyId: opts.emergencyId }
      : opts.appointmentId ? { appointmentId: opts.appointmentId }
      : opts.patientPrn ? { patientPrn: opts.patientPrn }
      : null;
    dedupeWhere = {
      ruleKey: opts.ruleKey,
      status: { in: ACTIVE_STATUSES },
      // No entity at all — fall back to an identical title raised in the last 24h.
      ...(entity ?? { title: opts.title, reportedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    };
  }
  const existing = await prisma.incident.findFirst({
    where: dedupeWhere,
    orderBy: { reportedAt: 'desc' },
    select: { id: true },
  });
  // Option A — even when deduped, surface the matched incident's id so the
  // caller can still link the new feedback/complaint to it.
  if (existing) return { created: false, incidentId: existing.id };

  const created = await createWithIncidentCode((code) => prisma.incident.create({
    data: {
      code,
      category: opts.category,
      severity: opts.severity,
      source: 'auto-rule',
      ruleKey: opts.ruleKey,
      title: opts.title,
      description: opts.description,
      nabhClause: opts.nabhClause ?? null,
      patientPrn: opts.patientPrn ?? null,
      patientName: opts.patientName ?? null,
      admissionId: opts.admissionId ?? null,
      emergencyId: opts.emergencyId ?? null,
      appointmentId: opts.appointmentId ?? null,
      ward: opts.ward ?? null,
      department: opts.department ?? null,
      occurredAt: opts.occurredAt ?? null,
      qiCode: opts.qiCode ?? null,
      reportedBy: 'system',
    },
  }));
  // Bell — admins triage auto-raised incidents too.
  void (async () => {
    const targetRole = await resolveTargetRole('admin');
    await notifyIncident({
      kind: 'incident_raised', incidentId: created.id, code: created.code,
      severity: created.severity, title: created.title, targetRole,
      isCritical: created.severity === 'major' || created.severity === 'sentinel',
    });
  })();
  return { created: true, code: created.code, incidentId: created.id };
};

export const listIncidents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, severity, category, source, patientPrn, ruleKey, ward, department, nabhClause, qiCode, assignedToId, mine } = req.query as Record<string, string | undefined>;
    const from = req.query.from ? new Date(req.query.from as string) : null;
    const to = req.query.to ? new Date(req.query.to as string) : null;

    // Phase 6g — 'mine=true' shortcut resolves to the caller's user id.
    const assigneeFilter: number | undefined = mine === 'true' && typeof req.user?.id === 'number'
      ? req.user.id
      : (assignedToId && /^\d+$/.test(assignedToId) ? Number(assignedToId) : undefined);

    const scope = await incidentReadScope(req.user?.id);

    const rows = await prisma.incident.findMany({
      where: {
        ...(scope && { AND: [scope] }),
        ...(status && { status }),
        ...(severity && { severity }),
        ...(category && { category }),
        ...(source && { source }),
        ...(patientPrn && { patientPrn }),
        ...(ruleKey && { ruleKey }),
        ...(ward && { ward }),
        ...(department && { department }),
        ...(nabhClause && { nabhClause }),
        ...(qiCode && { qiCode }),
        ...(assigneeFilter !== undefined && { assignedToId: assigneeFilter }),
        ...((from || to) && {
          reportedAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }),
      },
      orderBy: { reportedAt: 'desc' },
      take: 500,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[incident] list failed:', error);
    res.status(500).json({ message: 'Failed to load incidents' });
  }
};

export const getIncident = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: { capa: true },
    });
    if (!row || !(await canReadIncident(row.id, req.user?.id))) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }

    // Incident.admissionId is a free string column (no Prisma relation) — look
    // up the human-readable admissionNo so the UI doesn't display a raw uuid.
    let admissionNo: string | null = null;
    if (row.admissionId) {
      const adm = await prisma.ipdAdmission.findUnique({
        where: { id: row.admissionId },
        select: { admissionNo: true },
      });
      admissionNo = adm?.admissionNo ?? null;
    }

    // Phase 6 / Option A — resolve link rows so the UI can render chips
    // without needing a second round-trip per id.
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
      } catch { /* invalid JSON — ignore */ }
    }
    const complaint = row.complaintId
      ? await prisma.complaint.findUnique({
          where: { id: row.complaintId },
          select: { id: true, code: true, status: true, severity: true },
        })
      : null;
    const feedbackSurvey = row.feedbackSurveyId
      ? await prisma.feedbackSurvey.findUnique({
          where: { id: row.feedbackSurveyId },
          select: { id: true, template: true, npsScore: true, respondedAt: true },
        })
      : null;

    res.status(200).json({ data: { ...row, admissionNo, relatedIncidents, complaint, feedbackSurvey } });
  } catch (error) {
    console.error('[incident] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch incident' });
  }
};

interface StatusBody {
  status?: string;
  severityFinal?: string | null;
  assignedTo?: string | null;
  assignedToId?: number | null;
  closureNotes?: string | null;
}

export const updateIncidentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.incident.findUnique({
      where: { id },
      select: {
        id: true, status: true, assignedToId: true, closureNotes: true,
        capa: { select: { rootCause: true, correctiveActions: true } },
      },
    });
    if (!existing) { res.status(404).json({ message: 'Incident not found' }); return; }

    const body = req.body as StatusBody;
    if (!body.status || !VALID_STATUSES.includes(body.status as Status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const from = existing.status as Status;
    const to = body.status as Status;
    const isTransition = from !== to;
    if (isTransition && !(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
      res.status(400).json({ message: `Cannot move incident from '${from}' to '${to}'` });
      return;
    }
    if (body.severityFinal != null && !VALID_SEVERITIES.includes(body.severityFinal as Severity)) {
      res.status(400).json({ message: `severityFinal must be one of: ${VALID_SEVERITIES.join(', ')}` });
      return;
    }
    const assignedToId = parseIdField(body.assignedToId, 'assignedToId');
    let assignedTo = parseStringField(body.assignedTo, 'assignedTo');
    const closureNotes = parseStringField(body.closureNotes, 'closureNotes');

    if (assignedToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: assignedToId }, select: { username: true, fullName: true },
      });
      if (!assignee) { res.status(400).json({ message: 'assignedToId does not match a user' }); return; }
      if (!assignedTo) assignedTo = assignee.fullName || assignee.username;
    }

    if (isTransition && to === 'closed') {
      const notes = closureNotes !== undefined ? closureNotes : existing.closureNotes;
      if (!existing.capa?.rootCause?.trim() || !existing.capa?.correctiveActions?.trim()) {
        res.status(400).json({ message: 'Record a CAPA with root cause and corrective actions before closing' });
        return;
      }
      if (!notes?.trim()) {
        res.status(400).json({ message: 'closureNotes are required to close an incident' });
        return;
      }
    }

    const now = new Date();
    const data: Prisma.IncidentUpdateInput = {
      status: to,
      ...(body.severityFinal !== undefined && { severityFinal: body.severityFinal }),
      ...(assignedTo !== undefined && { assignedTo }),
      ...(assignedToId !== undefined && { assignedToId }),
      ...(closureNotes !== undefined && { closureNotes }),
    };
    if (isTransition && to === 'triaged') {
      data.triagedAt = now;
      data.triagedBy = req.user?.username ?? null;
    }
    if (isTransition && (to === 'closed' || to === 'cancelled')) {
      data.closedAt = now;
      data.closedBy = req.user?.username ?? null;
    }
    // Reopen — closure stamps no longer apply.
    if (isTransition && (from === 'closed' || from === 'cancelled')) {
      data.closedAt = null;
      data.closedBy = null;
      data.closureNotes = null;
    }

    const row = await prisma.incident.update({ where: { id }, data });
    await auditLog(req, {
      module: 'incident', action: 'STATUS_CHANGE', entityType: 'Incident',
      entityId: id, payload: { from, to, ...(assignedToId !== undefined && { assignedToId }) },
    });

    // ── Notifications on transitions ──
    // 1. New assignee → ping that specific user.
    if (assignedToId && assignedToId !== existing.assignedToId) {
      void notifyIncident({
        kind: 'incident_assigned', incidentId: row.id, code: row.code,
        severity: row.severity, title: row.title, userId: assignedToId,
      });
    }
    // 2. Closure → ping the original reporter (if we have their user id).
    if (isTransition && (to === 'closed' || to === 'cancelled') && row.reportedById) {
      void notifyIncident({
        kind: 'incident_closed', incidentId: row.id, code: row.code,
        severity: row.severity, title: row.title, userId: row.reportedById,
      });
    }

    res.status(200).json({ data: row });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[incident] updateStatus failed:', error);
    res.status(500).json({ message: 'Failed to update incident status' });
  }
};

// ─── Phase 3 — CAPA upsert ────────────────────────────────────────────
//
// One CAPA per incident (the relation is 1-1 on incidentId). PUT-style upsert
// so the editor can save partials any time. Saving CAPA does NOT change the
// incident status — that's a separate explicit action on the status endpoint.

interface CapaBody {
  immediateActions?: string | null;
  why1?: string | null; why2?: string | null; why3?: string | null;
  why4?: string | null; why5?: string | null;
  rootCause?: string | null;
  correctiveActions?: string | null;
  preventiveActions?: string | null;
  owner?: string | null;
  ownerId?: number | null;
  dueDate?: string | null;
  completedAt?: string | null;
  effectivenessReview?: string | null;
  effectivenessReviewAt?: string | null;
}

export const upsertIncidentCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const incidentId = req.params.id;
    const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true, status: true } });
    if (!incident) { res.status(404).json({ message: 'Incident not found' }); return; }

    // undefined → leave unchanged; null → clear.
    const body = (req.body ?? {}) as CapaBody;
    const data = {
      immediateActions: parseStringField(body.immediateActions, 'immediateActions'),
      why1: parseStringField(body.why1, 'why1'), why2: parseStringField(body.why2, 'why2'),
      why3: parseStringField(body.why3, 'why3'), why4: parseStringField(body.why4, 'why4'),
      why5: parseStringField(body.why5, 'why5'),
      rootCause: parseStringField(body.rootCause, 'rootCause'),
      correctiveActions: parseStringField(body.correctiveActions, 'correctiveActions'),
      preventiveActions: parseStringField(body.preventiveActions, 'preventiveActions'),
      owner: parseStringField(body.owner, 'owner'),
      ownerId: parseIdField(body.ownerId, 'ownerId'),
      dueDate: parseDateField(body.dueDate, 'dueDate'),
      completedAt: parseDateField(body.completedAt, 'completedAt'),
      effectivenessReview: parseStringField(body.effectivenessReview, 'effectivenessReview'),
      effectivenessReviewAt: parseDateField(body.effectivenessReviewAt, 'effectivenessReviewAt'),
    };

    const row = await prisma.incidentCapa.upsert({
      where: { incidentId },
      create: { incidentId, ...data },
      update: data,
    });

    await auditLog(req, {
      module: 'incident', action: 'UPDATE', entityType: 'IncidentCapa',
      entityId: row.id, payload: { incidentId },
    });

    res.status(200).json({ data: row });
  } catch (error) {
    if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
    console.error('[incident] upsertCapa failed:', error);
    res.status(500).json({ message: 'Failed to save CAPA' });
  }
};

// ─── Phase 9.26 / Phase 5c — QI tagging (post-hoc classification) ──────

interface QiTagBody { qiCode?: string | null }

export const tagIncidentWithQi = async (req: Request, res: Response): Promise<void> => {
  try {
    const incidentId = req.params.id;
    const existing = await prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true, qiCode: true } });
    if (!existing) { res.status(404).json({ message: 'Incident not found' }); return; }

    const body = (req.body ?? {}) as QiTagBody;
    if (body.qiCode !== null && (typeof body.qiCode !== 'string' || body.qiCode.length === 0)) {
      res.status(400).json({ message: "'qiCode' must be a non-empty string or null to clear" });
      return;
    }
    const next = body.qiCode === null ? null : (body.qiCode ?? null);

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: { qiCode: next },
      select: { id: true, code: true, qiCode: true },
    });

    await auditLog(req, {
      module: 'incident', action: 'QI_TAG', entityType: 'Incident',
      entityId: incidentId, payload: { previous: existing.qiCode ?? null, next },
    });

    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[incident] tag QI failed:', error);
    res.status(500).json({ message: 'Failed to tag incident' });
  }
};

/** Lightweight counts grouped by status (for the inbox tile). */
export const getIncidentStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await incidentReadScope(req.user?.id);
    const grouped = await prisma.incident.groupBy({
      by: ['status'],
      _count: { _all: true },
      ...(scope && { where: scope }),
    });
    const bySeverity = await prisma.incident.groupBy({
      by: ['severity'],
      _count: { _all: true },
      where: { status: { in: ['open', 'triaged', 'investigated', 'capa_in_progress'] }, ...(scope && { AND: [scope] }) },
    });
    res.status(200).json({
      byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      activeBySeverity: Object.fromEntries(bySeverity.map((g) => [g.severity, g._count._all])),
    });
  } catch (error) {
    console.error('[incident] stats failed:', error);
    res.status(500).json({ message: 'Failed to load stats' });
  }
};

// ─── Phase 9.24 / Phase 6f — Evidence upload ─────────────────────────────
// Pushes one file to GCS, appends { label, url, uploadedBy, uploadedAt }
// to the incident's evidenceLinks JSON array. No schema change — reuses
// the existing nullable string column.

interface EvidenceLink { label: string; url: string; uploadedBy?: string | null; uploadedAt?: string }

export const uploadIncidentEvidence = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const incident = await prisma.incident.findUnique({
      where: { id }, select: { id: true, code: true, reportedById: true, assignedToId: true },
    });
    if (!incident || !(await canReadIncident(incident.id, req.user?.id))) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file || !file.buffer) { res.status(400).json({ message: 'No file uploaded' }); return; }
    if (!EVIDENCE_MIME_TYPES.has(file.mimetype)) {
      res.status(400).json({ message: 'Unsupported file type — upload an image, PDF, Word/Excel document or text file' });
      return;
    }

    // Push to GCS — same pattern as investigation-result.controller.uploadResult.
    const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
    const datePath = new Date().toISOString().slice(0, 10);
    const objectName = `incidents/${datePath}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
    const blob = bucket.file(objectName);
    const stream = blob.createWriteStream({ resumable: false, contentType: file.mimetype });
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.end(file.buffer);
    });
    const url = `https://storage.googleapis.com/${bucket.name}/${objectName}`;

    const newLink: EvidenceLink = {
      label: req.body?.label?.toString().trim() || file.originalname,
      url,
      uploadedBy: req.user?.username ?? null,
      uploadedAt: new Date().toISOString(),
    };

    // Row lock so concurrent uploads don't overwrite each other's append.
    const { updated, next } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Incident WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.incident.findUnique({ where: { id }, select: { evidenceLinks: true } });
      const existing: EvidenceLink[] = (() => {
        if (!cur?.evidenceLinks) return [];
        try { const v = JSON.parse(cur.evidenceLinks); return Array.isArray(v) ? v : []; }
        catch { return []; }
      })();
      const merged = [...existing, newLink];
      const row = await tx.incident.update({
        where: { id },
        data: { evidenceLinks: JSON.stringify(merged) },
        select: { id: true },
      });
      return { updated: row, next: merged };
    });

    await auditLog(req, {
      module: 'incident', action: 'EVIDENCE_UPLOAD', entityType: 'Incident',
      entityId: id, payload: { code: incident.code, label: newLink.label, url },
    });

    res.status(201).json({ data: { id: updated.id, evidenceLinks: next, newLink } });
  } catch (error) {
    console.error('[incident] evidence upload failed:', error);
    res.status(500).json({ message: 'Failed to upload evidence' });
  }
};
