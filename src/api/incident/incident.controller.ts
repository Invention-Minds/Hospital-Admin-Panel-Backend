import type { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../service/prisma-client';
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

/** Generate the next INC-YYYY-NNNN code (year-scoped sequence). */
async function nextIncidentCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INC-${year}-`;
  // Find the highest existing sequence for this year.
  const last = await prisma.incident.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const lastSeq = last ? parseInt(last.code.split('-').pop() || '0', 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
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

    const code = await nextIncidentCode();
    const incident = await prisma.incident.create({
      data: {
        code,
        category: body.category,
        severity: body.severity,
        source: 'manual',
        title: body.title.trim(),
        description: body.description.trim(),
        patientPrn: body.patientPrn?.toString() ?? null,
        patientName: body.patientName ?? null,
        admissionId: body.admissionId ?? null,
        emergencyId: typeof body.emergencyId === 'number' ? body.emergencyId : null,
        appointmentId: typeof body.appointmentId === 'number' ? body.appointmentId : null,
        ward: body.ward ?? null,
        department: body.department ?? null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
        nabhClause: body.nabhClause ?? null,
        qiCode: body.qiCode ?? null,
        evidenceLinks: body.evidenceLinks ? JSON.stringify(body.evidenceLinks) : null,
        reportedBy: req.user?.username ?? null,
        reportedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await auditLog(req, {
      module: 'incident', action: 'CREATE', entityType: 'Incident',
      entityId: incident.id, payload: { code, category: body.category, severity: body.severity },
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
    console.error('[incident] create failed:', error);
    res.status(500).json({ message: 'Failed to raise incident' });
  }
};

/**
 * Internal helper used by the Phase-2 auto-capture engine. Idempotent on
 * (ruleKey + entity context + day) so a cron sweep can't raise duplicates.
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
}): Promise<{ created: boolean; code?: string; incidentId?: string }> => {
  // Dedupe key: same rule + same primary entity within the last 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.incident.findFirst({
    where: {
      ruleKey: opts.ruleKey,
      reportedAt: { gte: since },
      status: { in: ['open', 'triaged', 'investigated', 'capa_in_progress'] },
      OR: [
        opts.admissionId ? { admissionId: opts.admissionId } : { admissionId: '__no_match__' },
        opts.emergencyId ? { emergencyId: opts.emergencyId } : { emergencyId: -1 },
        opts.appointmentId ? { appointmentId: opts.appointmentId } : { appointmentId: -1 },
        opts.patientPrn ? { patientPrn: opts.patientPrn } : { patientPrn: '__no_match__' },
      ],
    },
    select: { id: true },
  });
  // Option A — even when deduped, surface the matched incident's id so the
  // caller can still link the new feedback/complaint to it.
  if (existing) return { created: false, incidentId: existing.id };

  const code = await nextIncidentCode();
  const created = await prisma.incident.create({
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
      reportedBy: 'system',
    },
  });
  // Bell — admins triage auto-raised incidents too.
  void (async () => {
    const targetRole = await resolveTargetRole('admin');
    await notifyIncident({
      kind: 'incident_raised', incidentId: created.id, code: created.code,
      severity: created.severity, title: created.title, targetRole,
      isCritical: created.severity === 'major' || created.severity === 'sentinel',
    });
  })();
  return { created: true, code, incidentId: created.id };
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

    const rows = await prisma.incident.findMany({
      where: {
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
    if (!row) { res.status(404).json({ message: 'Incident not found' }); return; }

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
    const existing = await prisma.incident.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) { res.status(404).json({ message: 'Incident not found' }); return; }

    const body = req.body as StatusBody;
    if (!body.status || !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    if (body.severityFinal && !VALID_SEVERITIES.includes(body.severityFinal as Severity)) {
      res.status(400).json({ message: `severityFinal must be one of: ${VALID_SEVERITIES.join(', ')}` });
      return;
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      status: body.status,
      ...(body.severityFinal !== undefined && { severityFinal: body.severityFinal }),
      ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
      ...(body.assignedToId !== undefined && { assignedToId: body.assignedToId }),
      ...(body.closureNotes !== undefined && { closureNotes: body.closureNotes }),
    };
    if (body.status === 'triaged' && !existing.status.startsWith('triaged')) {
      data['triagedAt'] = now;
      data['triagedBy'] = req.user?.username ?? null;
    }
    if (body.status === 'closed' || body.status === 'cancelled') {
      data['closedAt'] = now;
      data['closedBy'] = req.user?.username ?? null;
    }

    const row = await prisma.incident.update({ where: { id }, data });
    await auditLog(req, {
      module: 'incident', action: 'STATUS_CHANGE', entityType: 'Incident',
      entityId: id, payload: { from: existing.status, to: body.status },
    });

    // ── Notifications on transitions ──
    // 1. New assignee → ping that specific user.
    if (body.assignedToId && body.assignedToId !== null) {
      void notifyIncident({
        kind: 'incident_assigned', incidentId: row.id, code: row.code,
        severity: row.severity, title: row.title, userId: body.assignedToId,
      });
    }
    // 2. Closure → ping the original reporter (if we have their user id).
    if ((body.status === 'closed' || body.status === 'cancelled') && row.reportedById) {
      void notifyIncident({
        kind: 'incident_closed', incidentId: row.id, code: row.code,
        severity: row.severity, title: row.title, userId: row.reportedById,
      });
    }

    res.status(200).json({ data: row });
  } catch (error) {
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

    const body = req.body as CapaBody;
    const data = {
      immediateActions: body.immediateActions ?? undefined,
      why1: body.why1 ?? undefined, why2: body.why2 ?? undefined,
      why3: body.why3 ?? undefined, why4: body.why4 ?? undefined, why5: body.why5 ?? undefined,
      rootCause: body.rootCause ?? undefined,
      correctiveActions: body.correctiveActions ?? undefined,
      preventiveActions: body.preventiveActions ?? undefined,
      owner: body.owner ?? undefined,
      ownerId: body.ownerId ?? undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
      effectivenessReview: body.effectivenessReview ?? undefined,
      effectivenessReviewAt: body.effectivenessReviewAt ? new Date(body.effectivenessReviewAt) : undefined,
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
export const getIncidentStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const grouped = await prisma.incident.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const bySeverity = await prisma.incident.groupBy({
      by: ['severity'],
      _count: { _all: true },
      where: { status: { in: ['open', 'triaged', 'investigated', 'capa_in_progress'] } },
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
      where: { id }, select: { id: true, code: true, evidenceLinks: true },
    });
    if (!incident) { res.status(404).json({ message: 'Incident not found' }); return; }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file || !file.buffer) { res.status(400).json({ message: 'No file uploaded' }); return; }

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

    const existing: EvidenceLink[] = (() => {
      if (!incident.evidenceLinks) return [];
      try { const v = JSON.parse(incident.evidenceLinks); return Array.isArray(v) ? v : []; }
      catch { return []; }
    })();
    const newLink: EvidenceLink = {
      label: req.body?.label?.toString().trim() || file.originalname,
      url,
      uploadedBy: req.user?.username ?? null,
      uploadedAt: new Date().toISOString(),
    };
    const next = [...existing, newLink];

    const updated = await prisma.incident.update({
      where: { id },
      data: { evidenceLinks: JSON.stringify(next) },
      select: { id: true, evidenceLinks: true },
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
