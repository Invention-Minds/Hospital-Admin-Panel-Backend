import type { Request, Response } from 'express';
import crypto from 'crypto';
import bucket from '../../config/googeCloudStorage';
import { auditLog } from '../../service/app-audit';
import prisma from '../../service/prisma-client';
import {
  complaintReadScope,
  incidentReadScope,
  isComplaintHandler,
  isIncidentManager,
  PATIENT_RELATIONS,
  QUALITY_MANAGER,
  SENIOR_MANAGEMENT,
} from '../_shared/quality-roles';
import { escalationTimeline, QUALITY_EXECUTIVES, unitIdsHeadedBy } from '../../service/quality-escalation';
import { createComplaint } from '../feedback/complaint.controller';

// Management mobile app — Quality. The web endpoints (/api/incidents,
// /api/complaints, /api/quality/audits, /api/feedback) stay as they are and the
// app calls them directly; these add what the phone needs and the web never
// had: one overview digest, an incident timeline with the unit heads' phone
// numbers, the user's quality capabilities, and "raise this feedback as a
// complaint" with the survey link kept.

const OPEN_COMPLAINT = ['open', 'acknowledged', 'escalated'];
const OPEN_INCIDENT = ['open', 'triaged', 'investigated', 'capa_in_progress'];
const SEVERITY_RANK: Record<string, number> = { sentinel: 5, major: 4, moderate: 3, minor: 2, near_miss: 1 };
const NURSING_SUPERINTENDENT = 'Nursing Superintendent';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Me = {
  userId: number;
  role: string;
  adminType: string | null;
  subAdminType: string | null;
  isManager: boolean;
  isComplaintHandler: boolean;
  canViewFeedback: boolean;
  hodUnitIds: number[];
  canSeeQuality: boolean;
};

async function loadMe(req: Request): Promise<Me | null> {
  const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
  return userId ? qualityCapabilitiesFor(userId) : null;
}

/** Quality capabilities of a user — shared with the push dispatcher's morning digest. */
export async function qualityCapabilitiesFor(userId: number): Promise<Me | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, adminType: true, subAdminType: true } });
  if (!u) return null;
  const [isManager, isHandler, hodUnitIds] = await Promise.all([isIncidentManager(userId), isComplaintHandler(userId), unitIdsHeadedBy(userId)]);
  const viewerAdmin = u.role === 'admin' && !!u.adminType && [QUALITY_MANAGER, ...SENIOR_MANAGEMENT].includes(u.adminType);
  const executive = u.role === 'admin' && !!u.adminType && QUALITY_EXECUTIVES.includes(u.adminType);
  const canViewFeedback = u.role === 'super_admin' || viewerAdmin || u.subAdminType === PATIENT_RELATIONS;
  return {
    userId,
    role: String(u.role),
    adminType: u.adminType,
    subAdminType: u.subAdminType,
    isManager,
    isComplaintHandler: isHandler,
    canViewFeedback,
    hodUnitIds,
    canSeeQuality: isManager || isHandler || canViewFeedback || executive || hodUnitIds.length > 0 || u.subAdminType === NURSING_SUPERINTENDENT,
  };
}

/** Complaint time left in minutes (negative = overdue); null without a deadline. */
export function minutesLeft(slaDueAt: Date | null, now = Date.now()): number | null {
  return slaDueAt ? Math.round((slaDueAt.getTime() - now) / 60000) : null;
}

/** GET /api/quality/mobile/overview — the manager's morning digest. */
export const getQualityOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const me = await loadMe(req);
    if (!me) {
      res.status(401).json({ error: 'Sign in again' });
      return;
    }
    const capabilities = {
      canSeeQuality: me.canSeeQuality,
      isManager: me.isManager,
      isComplaintHandler: me.isComplaintHandler,
      canViewFeedback: me.canViewFeedback,
      hodUnitIds: me.hodUnitIds,
    };
    if (!me.canSeeQuality) {
      res.status(200).json({ capabilities });
      return;
    }

    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const [cScope, iScope] = await Promise.all([complaintReadScope(me.userId), incidentReadScope(me.userId)]);

    const auditWhere = {
      status: { in: ['scheduled', 'in_progress'] },
      dueDate: { lte: endOfToday },
      ...(me.isManager ? {} : { OR: [{ auditorId: me.userId }, ...(me.hodUnitIds.length ? [{ unitId: { in: me.hodUnitIds } }] : [])] }),
    };

    const incidentWhere = { status: { in: OPEN_INCIDENT }, ...(iScope ?? {}) };
    const [openIncidents, incidentGroups, mineCount] = await Promise.all([
      prisma.incident.count({ where: incidentWhere }),
      prisma.incident.groupBy({ by: ['severity'], where: incidentWhere, _count: { _all: true } }),
      prisma.incident.count({ where: { ...incidentWhere, assignedToId: me.userId } }),
    ]);
    const [complaints, incidents, audits, detractors] = await Promise.all([
      prisma.complaint.findMany({
        where: { status: { in: OPEN_COMPLAINT }, ...(cScope ?? {}) },
        select: { id: true, code: true, patientName: true, description: true, severity: true, status: true, slaDueAt: true, department: true, assignedTo: true, raisedAt: true },
        orderBy: { slaDueAt: 'asc' },
        take: 300,
      }),
      // The most serious first; recent within a severity. Five are shown.
      Promise.all(
        ['sentinel', 'major', 'moderate', 'minor', 'near_miss'].map((s) =>
          prisma.incident.findMany({
            where: { ...incidentWhere, OR: [{ severityFinal: s }, { severityFinal: null, severity: s }] },
            select: { id: true, code: true, title: true, severity: true, severityFinal: true, status: true, category: true, ward: true, department: true, reportedAt: true, assignedTo: true, assignedToId: true, escalationLevel: true },
            orderBy: { reportedAt: 'desc' },
            take: 5,
          }),
        ),
      ).then((groups) => groups.flat().slice(0, 5)),
      prisma.auditRun.findMany({
        where: auditWhere,
        select: { id: true, code: true, location: true, dueDate: true, status: true, unitId: true, auditor: true, checklist: { select: { name: true, group: true } } },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      me.canViewFeedback
        ? prisma.feedbackSurvey.findMany({
            where: { respondedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, npsScore: { lte: 6 } },
            select: { id: true, npsScore: true, comments: true, patientName: true, department: true, wardName: true, respondedAt: true, template: true, _count: { select: { complaints: true } } },
            orderBy: { respondedAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
    ]);

    const nowMs = now.getTime();
    const withLeft = complaints.map((c) => ({ ...c, minutesLeft: minutesLeft(c.slaDueAt, nowMs) }));
    const overdue = withLeft.filter((c) => c.minutesLeft != null && c.minutesLeft < 0);
    const dueSoon = withLeft.filter((c) => c.minutesLeft != null && c.minutesLeft >= 0 && c.minutesLeft <= 24 * 60);

    const sev = (i: (typeof incidents)[number]) => i.severityFinal ?? i.severity;
    // Reported severity (severityFinal revisions are rare and shown on the row).
    const bySeverity: Record<string, number> = {};
    for (const g of incidentGroups) bySeverity[g.severity] = g._count._all;
    const topIncidents = [...incidents].sort((a, b) => (SEVERITY_RANK[sev(b)] ?? 0) - (SEVERITY_RANK[sev(a)] ?? 0) || +b.reportedAt - +a.reportedAt);

    const auditsOverdue = audits.filter((a) => a.dueDate && a.dueDate.getTime() < new Date(now).setHours(0, 0, 0, 0));
    const unitIds = [...new Set(audits.map((a) => a.unitId).filter((x): x is number => x != null))];
    const units = unitIds.length ? await prisma.hospitalUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [];
    const unitName = new Map(units.map((u) => [u.id, u.name]));

    const followUp = detractors.filter((d) => d._count.complaints === 0);

    res.status(200).json({
      capabilities,
      complaints: {
        open: complaints.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        top: [...overdue, ...dueSoon].slice(0, 5),
      },
      incidents: {
        open: openIncidents,
        bySeverity,
        mine: mineCount,
        top: topIncidents.map((i) => ({ ...i, severity: sev(i) })),
      },
      audits: {
        dueToday: audits.length - auditsOverdue.length,
        overdue: auditsOverdue.length,
        top: audits.slice(0, 5).map((a) => ({ ...a, unitName: a.unitId != null ? unitName.get(a.unitId) ?? null : null })),
      },
      feedback: me.canViewFeedback
        ? {
            negative7d: detractors.length,
            needsFollowUp: followUp.length,
            top: followUp.slice(0, 5).map(({ _count, ...d }) => d),
          }
        : null,
    });
  } catch (error) {
    console.error('[quality:mobile:overview] failed:', error);
    res.status(500).json({ error: 'Failed to load the quality overview' });
  }
};

type TimelineEvent = { at: Date; kind: 'reported' | 'status' | 'assigned' | 'unit' | 'escalated' | 'closed'; label: string; by: string | null };

const STATUS_LABEL: Record<string, string> = {
  open: 'Reopened',
  triaged: 'Triaged',
  investigated: 'Investigation done',
  capa_in_progress: 'CAPA in progress',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** GET /api/quality/mobile/incidents/:id/timeline — status, assignment and escalation history + who to call. */
export const getIncidentTimeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id ?? '');
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const scope = await incidentReadScope(userId);
    const inc = await prisma.incident.findFirst({
      where: { id, ...(scope ?? {}) },
      select: { id: true, reportedAt: true, reportedBy: true, anonymous: true, unitId: true },
    });
    if (!inc) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    const [changes, escalations, unit] = await Promise.all([
      prisma.appAuditLog.findMany({
        where: { module: 'incident', action: 'STATUS_CHANGE', entityType: 'Incident', entityId: id },
        select: { createdAt: true, actorName: true, payload: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      escalationTimeline('Incident', id),
      inc.unitId != null
        ? prisma.hospitalUnit.findUnique({ where: { id: inc.unitId }, select: { id: true, name: true, hodUserId: true, deputyUserId: true } })
        : null,
    ]);

    const events: TimelineEvent[] = [{ at: inc.reportedAt, kind: 'reported', label: 'Reported', by: inc.anonymous ? 'Anonymous' : inc.reportedBy }];
    for (const c of changes) {
      let p: { from?: string; to?: string; assignedToId?: number; unitFrom?: number; unitTo?: number } = {};
      try {
        p = c.payload ? JSON.parse(c.payload) : {};
      } catch {
        p = {};
      }
      if (p.to && p.to !== p.from) events.push({ at: c.createdAt, kind: p.to === 'closed' ? 'closed' : 'status', label: STATUS_LABEL[p.to] ?? p.to, by: c.actorName });
      if (p.assignedToId != null) {
        const who = await prisma.user.findUnique({ where: { id: p.assignedToId }, select: { username: true } });
        events.push({ at: c.createdAt, kind: 'assigned', label: `Assigned to ${who?.username ?? `user #${p.assignedToId}`}`, by: c.actorName });
      }
      if (p.unitTo !== undefined && p.unitTo !== p.unitFrom) events.push({ at: c.createdAt, kind: 'unit', label: 'Moved to another unit', by: c.actorName });
    }
    for (const e of escalations as { at: Date | string; level: number; label?: string | null; recipients?: unknown }[]) {
      events.push({ at: new Date(e.at), kind: 'escalated', label: `Escalated to level ${e.level}${e.label ? ` · ${e.label}` : ''}`, by: 'Automatic' });
    }
    events.sort((a, b) => +a.at - +b.at);

    const headIds = [unit?.hodUserId, unit?.deputyUserId].filter((x): x is number => x != null);
    const heads = headIds.length
      ? await prisma.user.findMany({ where: { id: { in: headIds } }, select: { id: true, username: true, phoneNumber: true } })
      : [];
    const contact = (uid: number | null | undefined, role: 'HOD' | 'Deputy') => {
      const u = heads.find((h) => h.id === uid);
      return u ? { role, userId: u.id, name: u.username, phone: u.phoneNumber } : null;
    };

    res.status(200).json({
      data: {
        events,
        unit: unit ? { id: unit.id, name: unit.name } : null,
        contacts: [contact(unit?.hodUserId, 'HOD'), contact(unit?.deputyUserId, 'Deputy')].filter(Boolean),
      },
    });
  } catch (error) {
    console.error('[quality:mobile:timeline] failed:', error);
    res.status(500).json({ error: 'Failed to load the timeline' });
  }
};

/** GET /api/quality/mobile/assignees?q= — staff to assign an incident or complaint to. */
export const getAssignees = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = await prisma.user.findMany({
      where: {
        role: { in: ['admin', 'sub_admin', 'super_admin', 'doctor'] },
        ...(q ? { username: { contains: q } } : {}),
      },
      select: { id: true, username: true, role: true, adminType: true, subAdminType: true, department: true },
      orderBy: { username: 'asc' },
      take: 30,
    });
    res.status(200).json({
      data: rows.map((u) => ({ id: u.id, name: u.username, title: u.adminType ?? u.subAdminType ?? String(u.role), department: u.department })),
    });
  } catch (error) {
    console.error('[quality:mobile:assignees] failed:', error);
    res.status(500).json({ error: 'Failed to load staff' });
  }
};

/**
 * POST /api/quality/mobile/feedback/:surveyId/raise — turn a negative survey into a complaint.
 * Runs the normal complaint create (same validation, deadline, notifications),
 * then links the survey, which the create body cannot carry. If the survey
 * already has a complaint, returns that one instead of raising a second.
 */
export const raiseFeedbackAsComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const surveyId = String(req.params.surveyId ?? '');
    const survey = await prisma.feedbackSurvey.findUnique({
      where: { id: surveyId },
      select: { id: true, patientPrn: true, patientName: true, comments: true, npsScore: true, department: true, unitId: true, complaints: { select: { id: true, code: true }, take: 1 } },
    });
    if (!survey) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }
    if (survey.complaints[0]) {
      res.status(200).json({ data: survey.complaints[0], alreadyRaised: true });
      return;
    }
    const b = req.body ?? {};
    const description =
      (typeof b.description === 'string' && b.description.trim()) ||
      `Patient feedback (score ${survey.npsScore ?? '—'}/10): ${survey.comments?.trim() || 'no comment left'}`;

    req.body = {
      description,
      severity: ['low', 'medium', 'high'].includes(b.severity) ? b.severity : (survey.npsScore ?? 10) <= 3 ? 'high' : 'medium',
      channel: 'survey-auto',
      category: typeof b.category === 'string' ? b.category : undefined,
      department: survey.department ?? undefined,
      unitId: survey.unitId ?? undefined,
      patientPrn: survey.patientPrn ?? undefined,
      patientName: survey.patientName ?? undefined,
      proceedDespiteDuplicate: b.proceedDespiteDuplicate === true,
    };

    // Link the survey before the created complaint is sent back.
    const json = res.json.bind(res);
    res.json = ((payload: { data?: { id?: string } }) => {
      const createdId = res.statusCode === 201 ? payload?.data?.id : undefined;
      if (!createdId) return json(payload);
      void prisma.complaint
        .update({ where: { id: createdId }, data: { feedbackSurveyId: survey.id }, select: { id: true, code: true, slaDueAt: true, feedbackSurveyId: true } })
        .then((row) => json({ data: { ...payload.data, ...row } }))
        .catch((e) => {
          console.error('[quality:mobile:raise] link failed:', e);
          json(payload);
        });
      return res;
    }) as typeof res.json;

    await createComplaint(req, res);
  } catch (error) {
    console.error('[quality:mobile:raise] failed:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to raise the complaint' });
  }
};

const AUDIT_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

/**
 * POST /api/quality/mobile/audit-runs/:id/photo (multipart `file`) — a photo for
 * a "No" answer. AuditRunResponse has no attachment column, so the app puts the
 * returned link into the observation remark. Same who-may-conduct rule as
 * PUT /api/quality/audits/runs/:id/responses.
 */
export const uploadAuditPhoto = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const run = await prisma.auditRun.findUnique({ where: { id: String(req.params.id ?? '') }, select: { id: true, code: true, unitId: true, auditorId: true, status: true } });
    if (!run) {
      res.status(404).json({ error: 'Audit not found' });
      return;
    }
    const open = run.status === 'scheduled' || run.status === 'in_progress';
    const manager = await isIncidentManager(userId);
    const hod = userId != null && run.unitId != null && (await unitIdsHeadedBy(userId)).includes(run.unitId);
    if (!open || !(manager || hod || (run.auditorId != null && run.auditorId === userId))) {
      res.status(403).json({ error: 'Only the assigned auditor, the unit HOD or the Quality Manager can add photos to this audit' });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      res.status(400).json({ error: 'No photo uploaded' });
      return;
    }
    if (!AUDIT_PHOTO_TYPES.has(file.mimetype)) {
      res.status(400).json({ error: 'Upload a photo (JPEG, PNG, HEIC or WebP)' });
      return;
    }
    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : file.mimetype.startsWith('image/hei') ? 'heic' : 'jpg';
    const objectName = `audits/${new Date().toISOString().slice(0, 10)}/${run.code}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const blob = bucket.file(objectName);
    await new Promise<void>((resolve, reject) => {
      const stream = blob.createWriteStream({ resumable: false, contentType: file.mimetype });
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.end(file.buffer);
    });
    const url = `https://storage.googleapis.com/${bucket.name}/${objectName}`;
    await auditLog(req, { module: 'quality-audit', action: 'PHOTO', entityType: 'AuditRun', entityId: run.id, payload: { code: run.code, url, via: 'mobile' } });
    res.status(201).json({ data: { url } });
  } catch (error) {
    console.error('[quality:mobile:audit-photo] failed:', error);
    res.status(500).json({ error: 'Failed to upload the photo' });
  }
};

/** What a ward/unit QR code contains. The app scans it to open that unit's audits. */
export const unitQrPayload = (unitId: number) => `docminds:unit:${unitId}`;

/**
 * GET /api/quality/mobile/units/qr — QR codes to print and stick up in each
 * unit. Quality Manager: every active unit; a HOD: the units they head.
 */
export const getUnitQrCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const manager = await isIncidentManager(userId);
    const headed = userId != null ? await unitIdsHeadedBy(userId) : [];
    if (!manager && !headed.length) {
      res.status(403).json({ error: 'Only the Quality Manager or a unit head can print unit QR codes' });
      return;
    }
    const units = await prisma.hospitalUnit.findMany({
      where: { isActive: true, ...(manager ? {} : { id: { in: headed } }) },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const QRCode = require('qrcode') as { toDataURL: (text: string, opts: object) => Promise<string> };
    const data = await Promise.all(
      units.map(async (u) => ({
        ...u,
        payload: unitQrPayload(u.id),
        dataUrl: await QRCode.toDataURL(unitQrPayload(u.id), { margin: 1, width: 480, errorCorrectionLevel: 'M' }),
      })),
    );
    res.status(200).json({ data });
  } catch (error) {
    console.error('[quality:mobile:unit-qr] failed:', error);
    res.status(500).json({ error: 'Failed to make the QR codes' });
  }
};
