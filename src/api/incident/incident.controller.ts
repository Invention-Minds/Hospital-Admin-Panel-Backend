import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';
import moment from 'moment-timezone';
import {
  incidentReadScope, complaintReadScope, isIncidentManager, QUALITY_MANAGER,
} from '../_shared/quality-roles';
import { auditLog, auditLogSystem } from '../../service/app-audit';
import { isValidSubCategory } from '../../service/incident-taxonomy';
import bucket from '../../config/googeCloudStorage';
import {
  assertUnit, resolveUnitId, isHodOfUnit, unitHeadUserIds, caseUnitSummary, escalationTimeline,
} from '../../service/quality-escalation';
import { HARM_LEVELS, isHarmLevel, severityFromHarm, type HarmLevel } from '../../service/incident-harm';
import {
  closureCapaProblem, scheduleEffectivenessReviews, cancelPendingReviews,
} from '../../service/incident-capa';

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

/**
 * Incident managers (Quality Manager admins) — the triage audience. Falls back
 * to super admins when no Quality Manager is configured. Bells are per user
 * because the FE matches incident bells on userId; a role-wide 'admin' bell
 * reached every admin regardless of admin type.
 */
export async function incidentManagerUserIds(): Promise<number[]> {
  const qm = await prisma.user.findMany({
    where: { role: 'admin', adminType: QUALITY_MANAGER }, select: { id: true },
  });
  if (qm.length > 0) return qm.map((u) => u.id);
  const sa = await prisma.user.findMany({ where: { role: 'super_admin' }, select: { id: true } });
  return sa.map((u) => u.id);
}

/** "New incident" bell to the incident managers + the owning unit's HOD/deputy. No patient identifiers in the text. */
export async function notifyIncidentRaised(inc: {
  id: string; code: string; severity: string; category: string; source: string; unitId?: number | null;
}): Promise<void> {
  try {
    const userIds = [...new Set([...(await incidentManagerUserIds()), ...(await unitHeadUserIds(inc.unitId ?? null))])];
    if (userIds.length === 0) return;
    const origin = inc.source === 'auto-rule' ? 'auto-captured' : 'staff-reported';
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        type: 'incident_raised',
        title: `Incident raised · ${inc.code}`,
        message: `[${inc.severity.toUpperCase()}] New ${inc.category} incident (${origin}) — open it to triage.`,
        status: 'unread',
        userId,
        isCritical: inc.severity === 'major' || inc.severity === 'sentinel',
        entityId: 0,
        entityType: `Incident:${inc.id}`,
      })),
    });
  } catch (err) {
    console.warn('[incident:notify-raised] failed:', (err as Error).message);
  }
}

/** Unknown QI codes would silently feed nothing (or the wrong indicator). */
async function qiCodeExists(qiCode: string): Promise<boolean> {
  return (await prisma.qualityIndicator.count({ where: { qiCode } })) > 0;
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
  const year = moment().tz('Asia/Kolkata').year(); // hospital year, not server-TZ year
  const prefix = `INC-${year}-`;
  const rows = await prisma.$queryRaw<Array<{ maxSeq: bigint | number | null }>>`
    SELECT MAX(CAST(SUBSTRING(code, ${prefix.length + 1}) AS UNSIGNED)) AS maxSeq
    FROM Incident WHERE code LIKE ${prefix + '%'}`;
  const lastSeq = Number(rows[0]?.maxSeq ?? 0) || 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/** Runs `create` with a fresh code, retrying when a concurrent insert took it. */
export async function createWithIncidentCode<T>(create: (code: string) => Promise<T>): Promise<T> {
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

export interface IncidentPermissions {
  canTriage: boolean;       // status moves short of close / cancel / reopen, assign, revised severity
  canEditCapa: boolean;
  canClose: boolean;        // close, cancel, reopen
  canChangeUnit: boolean;
  canTagQi: boolean;
  canReviewEffectiveness: boolean; // record 30/60/90-day checks — works on closed incidents
}

/**
 * What the caller may do on this incident. Incident managers: everything.
 * HOD / deputy of the incident's unit: investigate (triage → CAPA), never
 * close / cancel / reopen or move it to another unit.
 */
export async function incidentPermissions(
  userId: number | undefined, inc: { unitId: number | null; status: string },
): Promise<IncidentPermissions> {
  if (await isIncidentManager(userId)) {
    return { canTriage: true, canEditCapa: true, canClose: true, canChangeUnit: true, canTagQi: true, canReviewEffectiveness: true };
  }
  const locked = inc.status === 'closed' || inc.status === 'cancelled';
  const isHod = await isHodOfUnit(userId, inc.unitId);
  const hod = !locked && isHod;
  return {
    canTriage: hod, canEditCapa: hod, canClose: false, canChangeUnit: false, canTagQi: false,
    canReviewEffectiveness: isHod && inc.status !== 'cancelled',
  };
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
  harmLevel?: string | null;  // preferred — severity is derived from it
  subCategory?: string | null; // service/incident-taxonomy.ts
  anonymous?: boolean;         // staff report without their name being stored
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
  unitId?: number | string | null; // HospitalUnit — else resolved from ward / department
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
    // Harm answer wins and sets the severity; a bare severity is still
    // accepted from older clients (harm then stays "not assessed").
    let harmLevel: HarmLevel | null = null;
    if (body.harmLevel != null) {
      if (!isHarmLevel(body.harmLevel)) {
        res.status(400).json({ message: `harmLevel must be one of: ${HARM_LEVELS.join(', ')}` });
        return;
      }
      harmLevel = body.harmLevel;
      body.severity = severityFromHarm(harmLevel);
    }
    if (!body.severity || !VALID_SEVERITIES.includes(body.severity as Severity)) {
      res.status(400).json({ message: `harmLevel (${HARM_LEVELS.join(', ')}) or severity (${VALID_SEVERITIES.join(', ')}) is required` });
      return;
    }

    const emergencyId = parseIdField(body.emergencyId, 'emergencyId');
    const appointmentId = parseIdField(body.appointmentId, 'appointmentId');
    const occurredAt = parseDateField(body.occurredAt, 'occurredAt');
    const patientName = parseStringField(body.patientName, 'patientName');
    const admissionId = parseStringField(body.admissionId, 'admissionId');
    const ward = parseStringField(body.ward, 'ward');
    const department = parseStringField(body.department, 'department');
    // QI tag + NABH clause feed indicator numerators — only incident managers
    // classify. Reporters' values are ignored (not rejected) so a stale form
    // doesn't block a safety report.
    const canClassify = await isIncidentManager(req.user?.id);
    const nabhClause = canClassify ? parseStringField(body.nabhClause, 'nabhClause')?.trim() || null : null;
    const qiCode = canClassify ? parseStringField(body.qiCode, 'qiCode')?.trim() || null : null;
    if (qiCode && !(await qiCodeExists(qiCode))) throw new ValidationError(`qiCode '${qiCode}' is not a known quality indicator`);
    if (body.patientPrn != null && typeof body.patientPrn !== 'string' && typeof body.patientPrn !== 'number') {
      throw new ValidationError('patientPrn must be a string');
    }
    if (body.evidenceLinks !== undefined && body.evidenceLinks !== null && (
      !Array.isArray(body.evidenceLinks) ||
      body.evidenceLinks.some((l) => !l || typeof l.label !== 'string' || typeof l.url !== 'string')
    )) {
      throw new ValidationError('evidenceLinks must be an array of { label, url }');
    }
    if (!isValidSubCategory(body.category, body.subCategory)) {
      throw new ValidationError(`subCategory '${body.subCategory}' is not a sub-type of ${body.category}`);
    }
    let pickedUnit: number | null;
    try { pickedUnit = await assertUnit(body.unitId); } catch (e) { throw new ValidationError((e as Error).message); }
    const unitId = await resolveUnitId({ unitId: pickedUnit, admissionId, ward, department });
    // Anonymous: the reporter's identity is never stored (nobody — not even
    // Quality — can see who reported). They also can't follow it up later.
    const anonymous = body.anonymous === true;

    const incident = await createWithIncidentCode((code) => prisma.incident.create({
      data: {
        code,
        category: body.category as string,
        severity: body.severity as string,
        harmLevel,
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
        nabhClause,
        qiCode,
        evidenceLinks: body.evidenceLinks ? JSON.stringify(body.evidenceLinks) : null,
        subCategory: body.subCategory || null,
        anonymous,
        reportedBy: anonymous ? null : req.user?.username ?? null,
        reportedById: anonymous ? null : typeof req.user?.id === 'number' ? req.user.id : null,
        unitId,
        escalationStartAt: new Date(),
      },
    }));

    // The audit trail must not reveal an anonymous reporter either.
    if (anonymous) {
      await auditLogSystem({
        module: 'incident', action: 'CREATE', entityType: 'Incident', entityId: incident.id, source: 'anonymous-report',
        payload: { code: incident.code, category: body.category, subCategory: body.subCategory ?? null, severity: body.severity, harmLevel },
      });
    } else {
      await auditLog(req, {
        module: 'incident', action: 'CREATE', entityType: 'Incident',
        entityId: incident.id, payload: { code: incident.code, category: body.category, subCategory: body.subCategory ?? null, severity: body.severity, harmLevel },
      });
    }

    // Bell — incident managers triage; the unit's HOD is told too.
    void notifyIncidentRaised(incident);

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
 *   - sourceRef     → one incident per ruleKey + sourceRef (e.g. the lab result
 *                     id), any status. The ref is stamped into the description
 *                     as `[ref:<sourceRef>]` (no schema column for it).
 *   - otherwise     → one incident per ruleKey + most specific entity
 *                     (admission > emergency > appointment > PRN). Active
 *                     incidents only, unless `dedupeAnyStatus` — cron rules
 *                     set it so a closed/cancelled incident isn't re-raised
 *                     15 minutes later while the condition still holds.
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
  sourceRef?: string | null;
  dedupeAnyStatus?: boolean;
  subCategory?: string | null;
}): Promise<{ created: boolean; code?: string; incidentId?: string }> => {
  const refMarker = opts.sourceRef ? `[ref:${opts.sourceRef}]` : null;
  let dedupeWhere: Prisma.IncidentWhereInput;
  if (refMarker) {
    dedupeWhere = { ruleKey: opts.ruleKey, description: { contains: refMarker } };
  } else if (opts.qiCode) {
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
      ...(!(opts.dedupeAnyStatus && entity) && { status: { in: ACTIVE_STATUSES } }),
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

  const unitId = await resolveUnitId({ admissionId: opts.admissionId, ward: opts.ward, department: opts.department });
  const created = await createWithIncidentCode((code) => prisma.incident.create({
    data: {
      code,
      category: opts.category,
      severity: opts.severity,
      source: 'auto-rule',
      ruleKey: opts.ruleKey,
      subCategory: opts.subCategory ?? null,
      title: opts.title,
      description: refMarker ? `${opts.description}\n${refMarker}` : opts.description,
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
      unitId,
      escalationStartAt: new Date(),
    },
  }));
  // Bell — incident managers triage auto-raised incidents too.
  void notifyIncidentRaised(created);
  return { created: true, code: created.code, incidentId: created.id };
};

export const listIncidents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, severity, category, source, patientPrn, ruleKey, ward, department, nabhClause, qiCode, assignedToId, mine, unitId } = req.query as Record<string, string | undefined>;
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
        ...(unitId && /^\d+$/.test(unitId) && { unitId: Number(unitId) }),
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
      include: {
        capa: true,
        capaActions: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
        effectivenessReviews: { where: { status: { not: 'cancelled' } }, orderBy: { dueAt: 'asc' } },
        participants: { orderBy: { createdAt: 'asc' } },
      },
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
          // Only siblings the caller could open themselves.
          const scope = await incidentReadScope(req.user?.id);
          relatedIncidents = await prisma.incident.findMany({
            where: {
              id: { in: ids.filter((s): s is string => typeof s === 'string') },
              ...(scope && { AND: [scope] }),
            },
            select: { id: true, code: true, category: true, severity: true, status: true },
          });
        }
      } catch { /* invalid JSON — ignore */ }
    }
    let complaint: { id: string; code: string; status: string; severity: string } | null = null;
    if (row.complaintId) {
      const cScope = await complaintReadScope(req.user?.id);
      complaint = await prisma.complaint.findFirst({
        where: { id: row.complaintId, ...(cScope && { AND: [cScope] }) },
        select: { id: true, code: true, status: true, severity: true },
      });
    }
    const feedbackSurvey = row.feedbackSurveyId
      ? await prisma.feedbackSurvey.findUnique({
          where: { id: row.feedbackSurveyId },
          select: { id: true, template: true, npsScore: true, respondedAt: true },
        })
      : null;

    const [unit, permissions, escalations] = await Promise.all([
      caseUnitSummary(row.unitId),
      incidentPermissions(req.user?.id, row),
      escalationTimeline('Incident', row.id),
    ]);

    // The action owner may mark their own action done / reopen it while the incident is open.
    const locked = row.status === 'closed' || row.status === 'cancelled';
    const capaActions = row.capaActions.map((a) => ({
      ...a,
      canComplete: !locked && (permissions.canEditCapa || (a.ownerId != null && a.ownerId === req.user?.id)),
    }));
    const pUsers = row.participants.length
      ? await prisma.user.findMany({ where: { id: { in: row.participants.map((p) => p.userId) } }, select: { id: true, username: true, fullName: true } })
      : [];
    const pName = new Map(pUsers.map((u) => [u.id, u.fullName || u.username]));
    const participants = row.participants.map((p) => ({ userId: p.userId, name: pName.get(p.userId) ?? `User ${p.userId}`, addedBy: p.addedBy, createdAt: p.createdAt }));

    res.status(200).json({
      data: { ...row, capaActions, participants, admissionNo, relatedIncidents, complaint, feedbackSurvey, unit, permissions, escalations },
    });
  } catch (error) {
    console.error('[incident] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch incident' });
  }
};

interface StatusBody {
  status?: string;
  severityFinal?: string | null;
  harmLevelFinal?: string | null; // confirmed harm → sets severityFinal
  subCategory?: string | null;    // correct the sub-type during triage
  assignedTo?: string | null;
  assignedToId?: number | null;
  closureNotes?: string | null;
  unitId?: number | string | null;
}

export const updateIncidentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.incident.findUnique({
      where: { id },
      select: {
        id: true, status: true, assignedToId: true, closureNotes: true, unitId: true,
        severity: true, severityFinal: true, harmLevelFinal: true, category: true,
      },
    });
    if (!existing) { res.status(404).json({ message: 'Incident not found' }); return; }

    const body = req.body as StatusBody;
    const perms = await incidentPermissions(req.user?.id, existing);
    if (!perms.canTriage && !perms.canClose) {
      res.status(403).json({ message: 'Only incident managers or the unit HOD can update this incident' });
      return;
    }
    // HODs investigate; closing / cancelling / reopening and moving the
    // incident to another unit stay with the incident manager.
    if (!perms.canClose && (body.status === 'closed' || body.status === 'cancelled')) {
      res.status(403).json({ message: 'Only an incident manager can close or cancel an incident' });
      return;
    }
    if (body.unitId !== undefined && !perms.canChangeUnit) {
      res.status(403).json({ message: 'Only an incident manager can move an incident to another unit' });
      return;
    }
    let newUnitId: number | null | undefined;
    if (body.unitId !== undefined) {
      try { newUnitId = await assertUnit(body.unitId); } catch (e) { throw new ValidationError((e as Error).message); }
    }
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
    // Closed / cancelled records are frozen — reopen first, then edit.
    if (!isTransition && (from === 'closed' || from === 'cancelled')) {
      res.status(409).json({ message: `Incident is ${from} — reopen it before editing` });
      return;
    }
    if (body.severityFinal != null && !VALID_SEVERITIES.includes(body.severityFinal as Severity)) {
      res.status(400).json({ message: `severityFinal must be one of: ${VALID_SEVERITIES.join(', ')}` });
      return;
    }
    // Confirmed harm after investigation sets the final severity (wins over a
    // bare severityFinal); clearing it clears the final severity too.
    let harmLevelFinal: HarmLevel | null | undefined;
    if (body.harmLevelFinal !== undefined) {
      if (body.harmLevelFinal !== null && !isHarmLevel(body.harmLevelFinal)) {
        res.status(400).json({ message: `harmLevelFinal must be one of: ${HARM_LEVELS.join(', ')}` });
        return;
      }
      harmLevelFinal = body.harmLevelFinal;
      body.severityFinal = harmLevelFinal ? severityFromHarm(harmLevelFinal) : null;
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
      const capaProblem = await closureCapaProblem(id);
      if (capaProblem) {
        res.status(400).json({ message: capaProblem });
        return;
      }
      if (!notes?.trim()) {
        res.status(400).json({ message: 'closureNotes are required to close an incident' });
        return;
      }
    }
    // Cancelling (eFeedor's "reject") must say why — e.g. duplicate, not an incident, spam.
    if (isTransition && to === 'cancelled' && !closureNotes?.trim()) {
      res.status(400).json({ message: 'Give a reason for cancelling (closureNotes) — e.g. duplicate, not an incident' });
      return;
    }
    if (body.subCategory !== undefined && !isValidSubCategory(existing.category, body.subCategory)) {
      res.status(400).json({ message: `subCategory '${body.subCategory}' is not a sub-type of ${existing.category}` });
      return;
    }

    const now = new Date();
    const data: Prisma.IncidentUpdateManyMutationInput = {
      status: to,
      ...(body.severityFinal !== undefined && { severityFinal: body.severityFinal }),
      ...(harmLevelFinal !== undefined && { harmLevelFinal }),
      ...(body.subCategory !== undefined && { subCategory: body.subCategory || null }),
      ...(assignedTo !== undefined && { assignedTo }),
      ...(assignedToId !== undefined && { assignedToId }),
      ...(closureNotes !== undefined && { closureNotes }),
      ...(newUnitId !== undefined && { unitId: newUnitId }),
    };
    if (isTransition && to === 'triaged') {
      data.triagedAt = now;
      data.triagedBy = req.user?.username ?? null;
    }
    if (isTransition && (to === 'closed' || to === 'cancelled')) {
      data.closedAt = now;
      data.closedBy = req.user?.username ?? null;
    }
    // Reopen — closure stamps no longer apply; the escalation clock restarts.
    if (isTransition && (from === 'closed' || from === 'cancelled')) {
      data.closedAt = null;
      data.closedBy = null;
      data.closureNotes = null;
      data.escalationLevel = 0;
      data.escalationStartAt = now;
      data.lastEscalatedAt = null;
    }

    // Conditional on the status we validated against, so a concurrent change
    // can't be silently overwritten.
    const { count } = await prisma.incident.updateMany({ where: { id, status: from }, data });
    if (count !== 1) {
      res.status(409).json({ message: 'Incident was changed by someone else — reload and try again' });
      return;
    }
    const row = await prisma.incident.findUniqueOrThrow({ where: { id } });

    // Effectiveness checks: scheduled at closure, dropped on reopen.
    let reviewsScheduled: number | undefined;
    if (isTransition && to === 'closed') {
      reviewsScheduled = await scheduleEffectivenessReviews(id, row.severityFinal ?? row.severity, now);
    } else if (isTransition && from === 'closed') {
      await cancelPendingReviews(id);
    }

    await auditLog(req, {
      module: 'incident', action: 'STATUS_CHANGE', entityType: 'Incident',
      entityId: id,
      payload: {
        from, to,
        ...(reviewsScheduled !== undefined && { reviewsScheduled }),
        ...(harmLevelFinal !== undefined && harmLevelFinal !== existing.harmLevelFinal && { harmFinalFrom: existing.harmLevelFinal, harmFinalTo: harmLevelFinal }),
        ...(assignedToId !== undefined && { assignedToId }),
        ...(newUnitId !== undefined && newUnitId !== existing.unitId && { unitFrom: existing.unitId, unitTo: newUnitId }),
      },
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
    const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true, status: true, unitId: true } });
    if (!incident) { res.status(404).json({ message: 'Incident not found' }); return; }
    if (incident.status === 'closed' || incident.status === 'cancelled') {
      res.status(409).json({ message: `Incident is ${incident.status} — reopen it before editing the CAPA` });
      return;
    }
    if (!(await incidentPermissions(req.user?.id, incident)).canEditCapa) {
      res.status(403).json({ message: 'Only incident managers or the unit HOD can edit the CAPA' });
      return;
    }

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
    const next = body.qiCode === null ? null : (body.qiCode?.trim() || null);
    if (next && !(await qiCodeExists(next))) {
      res.status(400).json({ message: `qiCode '${next}' is not a known quality indicator` });
      return;
    }

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
      where: { id }, select: { id: true, code: true, status: true, reportedById: true, assignedToId: true, unitId: true },
    });
    if (!incident || !(await canReadIncident(incident.id, req.user?.id))) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }
    // Department viewers are read-only: evidence comes from the reporter, the
    // assignee, the unit HOD or an incident manager — and not onto a closed record.
    const uid = req.user?.id;
    const isParty = typeof uid === 'number' && (
      incident.reportedById === uid || incident.assignedToId === uid ||
      (await prisma.incidentParticipant.count({ where: { incidentId: incident.id, userId: uid } })) > 0
    );
    if (!isParty && !(await isIncidentManager(uid)) && !(await isHodOfUnit(uid, incident.unitId))) {
      res.status(403).json({ message: 'Only the reporter, the assignee, staff involved, the unit HOD or an incident manager can attach evidence' });
      return;
    }
    if (incident.status === 'closed' || incident.status === 'cancelled') {
      res.status(409).json({ message: `Incident is ${incident.status} — reopen it before attaching evidence` });
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
