import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { unitHeadUserIds } from '../../service/quality-escalation';
import { cancelPendingReviews } from '../../service/incident-capa';
import {
  CAPA_ACTION_KINDS, CAPA_ACTION_STATUSES, EFFECTIVENESS_OUTCOMES, REVIEW_EARLY_WINDOW_DAYS,
} from '../../service/incident-harm';
import { incidentPermissions, incidentManagerUserIds } from './incident.controller';

// Phase 2 — CAPA as tracked actions + effectiveness checks.
//
//   POST /api/incidents/:id/capa/actions              add an action (manager / unit HOD)
//   PUT  /api/incidents/:id/capa/actions/:actionId    edit (manager / HOD) or complete (owner)
//   POST /api/incidents/:id/effectiveness-reviews/:reviewId
//                                                     record a 30/60/90-day check (manager / HOD);
//                                                     'not_effective' reopens the incident
//
// Root cause / 5-Whys stay on IncidentCapa (PUT /:id/capa).

class ValidationError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCKED = ['closed', 'cancelled'];

function str(value: unknown, field: string, opts: { max?: number } = {}): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const t = value.trim();
  if (opts.max && t.length > opts.max) throw new ValidationError(`${field} is too long (max ${opts.max})`);
  return t || null;
}

function dateField(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new ValidationError(`${field} must be a date`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be a valid date`);
  return d;
}

/** Validates the owner id and returns { ownerId, owner } (display name). */
async function resolveOwner(value: unknown): Promise<{ ownerId: number | null; owner: string | null } | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === '') return { ownerId: null, owner: null };
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ValidationError('ownerId must be a positive integer');
  const u = await prisma.user.findFirst({ where: { id: n, isActive: true }, select: { id: true, username: true, fullName: true } });
  if (!u) throw new ValidationError('ownerId does not match an active user');
  return { ownerId: u.id, owner: u.fullName || u.username };
}

async function bell(userIds: number[], n: { type: string; title: string; message: string; incidentId: string; critical?: boolean }) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        type: n.type, title: n.title, message: n.message, status: 'unread', isCritical: !!n.critical,
        entityId: 0, entityType: `Incident:${n.incidentId}`, userId,
      })),
    });
  } catch (err) {
    console.warn(`[incident-capa:${n.type}] bell failed:`, (err as Error).message);
  }
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof ValidationError) { res.status(400).json({ message: error.message }); return; }
  console.error(`[incident-capa] ${what} failed:`, error);
  res.status(500).json({ message: `Failed to ${what}` });
}

// ─── Add an action ──────────────────────────────────────────────────────

export const createCapaAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id }, select: { id: true, code: true, status: true, unitId: true },
    });
    if (!incident) { res.status(404).json({ message: 'Incident not found' }); return; }
    if (LOCKED.includes(incident.status)) {
      res.status(409).json({ message: `Incident is ${incident.status} — reopen it before editing the CAPA` });
      return;
    }
    if (!(await incidentPermissions(req.user?.id, incident)).canEditCapa) {
      res.status(403).json({ message: 'Only incident managers or the unit HOD can add CAPA actions' });
      return;
    }
    const body = req.body ?? {};
    if (!CAPA_ACTION_KINDS.includes(body.kind)) throw new ValidationError(`kind must be one of: ${CAPA_ACTION_KINDS.join(', ')}`);
    const description = str(body.description, 'description', { max: 4000 });
    if (!description || description.length < 3) throw new ValidationError('description is required (min 3 chars)');
    const owner = (await resolveOwner(body.ownerId)) ?? { ownerId: null, owner: null };
    const dueDate = dateField(body.dueDate, 'dueDate') ?? null;

    const row = await prisma.incidentCapaAction.create({
      data: {
        incidentId: incident.id, kind: body.kind, description, ...owner, dueDate,
        createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, {
      module: 'incident', action: 'CREATE', entityType: 'IncidentCapaAction', entityId: row.id,
      payload: { incidentId: incident.id, kind: row.kind, ownerId: row.ownerId, dueDate: row.dueDate },
    });
    if (row.ownerId && row.ownerId !== req.user?.id) {
      void bell([row.ownerId], {
        type: 'capa_action_assigned', incidentId: incident.id,
        title: `CAPA action assigned to you · ${incident.code}`,
        message: `${row.kind === 'corrective' ? 'Corrective' : 'Preventive'} action: ${row.description.slice(0, 140)}` +
          (row.dueDate ? ` — due ${row.dueDate.toISOString().slice(0, 10)}` : ''),
      });
    }
    res.status(201).json({ data: row });
  } catch (error) {
    fail(res, error, 'add CAPA action');
  }
};

// ─── Edit / complete an action ──────────────────────────────────────────
//
// Managers / HOD may change anything. The action's owner may only move it
// between open and done (with a completion note). Done and dropped need a
// note — that note is the evidence of what was done / why it was dropped.

export const updateCapaAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const action = await prisma.incidentCapaAction.findFirst({
      where: { id: req.params.actionId, incidentId: req.params.id },
      include: { incident: { select: { id: true, code: true, status: true, unitId: true } } },
    });
    if (!action) { res.status(404).json({ message: 'CAPA action not found' }); return; }
    const incident = action.incident;
    if (LOCKED.includes(incident.status)) {
      res.status(409).json({ message: `Incident is ${incident.status} — reopen it before editing the CAPA` });
      return;
    }
    const perms = await incidentPermissions(req.user?.id, incident);
    const isOwner = action.ownerId != null && action.ownerId === req.user?.id;
    if (!perms.canEditCapa && !isOwner) {
      res.status(403).json({ message: 'Only incident managers, the unit HOD or the action owner can update this action' });
      return;
    }

    const body = req.body ?? {};
    const editsDefinition = ['kind', 'description', 'ownerId', 'dueDate'].some((k) => body[k] !== undefined);
    if (!perms.canEditCapa && editsDefinition) {
      res.status(403).json({ message: 'The action owner can only mark the action done or reopen it' });
      return;
    }
    if (body.status !== undefined && !CAPA_ACTION_STATUSES.includes(body.status)) {
      throw new ValidationError(`status must be one of: ${CAPA_ACTION_STATUSES.join(', ')}`);
    }
    if (!perms.canEditCapa && body.status === 'dropped') {
      res.status(403).json({ message: 'Only incident managers or the unit HOD can drop an action' });
      return;
    }
    if (body.kind !== undefined && !CAPA_ACTION_KINDS.includes(body.kind)) {
      throw new ValidationError(`kind must be one of: ${CAPA_ACTION_KINDS.join(', ')}`);
    }
    const description = str(body.description, 'description', { max: 4000 });
    if (description !== undefined && (!description || description.length < 3)) {
      throw new ValidationError('description cannot be empty (min 3 chars)');
    }
    const completionNote = str(body.completionNote, 'completionNote', { max: 4000 });
    const owner = await resolveOwner(body.ownerId);
    const dueDate = dateField(body.dueDate, 'dueDate');

    const to: string = body.status ?? action.status;
    const statusChanged = to !== action.status;
    const note = completionNote !== undefined ? completionNote : action.completionNote;
    if (statusChanged && to !== 'open' && !note) {
      throw new ValidationError(to === 'done' ? 'Add a completion note describing what was done' : 'Add a note explaining why the action is dropped');
    }

    const now = new Date();
    const data = {
      ...(body.kind !== undefined && { kind: body.kind as string }),
      ...(description !== undefined && { description: description as string }),
      ...(owner !== undefined && owner),
      ...(dueDate !== undefined && { dueDate }),
      ...(completionNote !== undefined && { completionNote }),
      ...(statusChanged && {
        status: to,
        ...(to === 'open'
          ? { completedAt: null, completedBy: null }
          : { completedAt: now, completedBy: req.user?.username ?? null }),
      }),
    };
    // Conditional on the status we validated against (concurrent edits).
    const { count } = await prisma.incidentCapaAction.updateMany({ where: { id: action.id, status: action.status }, data });
    if (count !== 1) { res.status(409).json({ message: 'Action was changed by someone else — reload and try again' }); return; }
    const row = await prisma.incidentCapaAction.findUniqueOrThrow({ where: { id: action.id } });

    await auditLog(req, {
      module: 'incident', action: 'UPDATE', entityType: 'IncidentCapaAction', entityId: row.id,
      payload: {
        incidentId: incident.id,
        ...(statusChanged && { from: action.status, to }),
        ...(owner !== undefined && owner.ownerId !== action.ownerId && { ownerFrom: action.ownerId, ownerTo: owner.ownerId }),
        ...(dueDate !== undefined && { dueDate }),
        // keep the replaced text in the trail
        ...(description !== undefined && description !== action.description && { previousDescription: action.description }),
        ...(completionNote !== undefined && action.completionNote && completionNote !== action.completionNote && { previousCompletionNote: action.completionNote }),
      },
    });

    if (owner?.ownerId && owner.ownerId !== action.ownerId && owner.ownerId !== req.user?.id) {
      void bell([owner.ownerId], {
        type: 'capa_action_assigned', incidentId: incident.id,
        title: `CAPA action assigned to you · ${incident.code}`,
        message: `${row.kind === 'corrective' ? 'Corrective' : 'Preventive'} action: ${row.description.slice(0, 140)}`,
      });
    }
    // Owner finished their action → tell the people who will close the incident.
    if (statusChanged && to === 'done' && !perms.canEditCapa) {
      const heads = await unitHeadUserIds(incident.unitId);
      void bell(heads.length > 0 ? heads : await incidentManagerUserIds(), {
        type: 'capa_action_done', incidentId: incident.id,
        title: `CAPA action completed · ${incident.code}`,
        message: `${row.owner ?? 'The owner'} marked an action done: ${row.description.slice(0, 120)}`,
      });
    }
    res.status(200).json({ data: row });
  } catch (error) {
    fail(res, error, 'update CAPA action');
  }
};

// ─── Effectiveness check ────────────────────────────────────────────────

export const recordEffectivenessReview = async (req: Request, res: Response): Promise<void> => {
  try {
    const review = await prisma.incidentEffectivenessReview.findFirst({
      where: { id: req.params.reviewId, incidentId: req.params.id },
      include: { incident: { select: { id: true, code: true, status: true, unitId: true, severity: true, severityFinal: true } } },
    });
    if (!review) { res.status(404).json({ message: 'Effectiveness check not found' }); return; }
    const incident = review.incident;
    if (!(await incidentPermissions(req.user?.id, incident)).canReviewEffectiveness) {
      res.status(403).json({ message: 'Only incident managers or the unit HOD can record effectiveness checks' });
      return;
    }
    if (review.status !== 'pending') {
      res.status(409).json({ message: `This check is already ${review.status === 'done' ? 'recorded' : 'cancelled'}` });
      return;
    }
    if (incident.status !== 'closed') {
      res.status(409).json({ message: 'Effectiveness checks are recorded on closed incidents' });
      return;
    }
    const opensAt = review.dueAt.getTime() - REVIEW_EARLY_WINDOW_DAYS * DAY_MS;
    if (Date.now() < opensAt) {
      res.status(409).json({
        message: `This ${review.dayOffset}-day check opens on ${new Date(opensAt).toISOString().slice(0, 10)}`,
      });
      return;
    }
    const body = req.body ?? {};
    if (!EFFECTIVENESS_OUTCOMES.includes(body.outcome)) {
      throw new ValidationError(`outcome must be one of: ${EFFECTIVENESS_OUTCOMES.join(', ')}`);
    }
    const notes = str(body.notes, 'notes', { max: 4000 }) ?? null;
    if (body.outcome !== 'effective' && !notes) {
      throw new ValidationError('Describe what was found when the CAPA is not fully effective');
    }

    const now = new Date();
    const { count } = await prisma.incidentEffectivenessReview.updateMany({
      where: { id: review.id, status: 'pending' },
      data: {
        status: 'done', outcome: body.outcome, notes, reviewedAt: now,
        reviewedBy: req.user?.username ?? null,
        reviewedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    if (count !== 1) { res.status(409).json({ message: 'This check was recorded by someone else — reload' }); return; }

    // Not effective → the CAPA failed: reopen to capa_in_progress, restart
    // escalation, drop the remaining checks (rescheduled at the next closure).
    let reopened = false;
    if (body.outcome === 'not_effective') {
      const r = await prisma.incident.updateMany({
        where: { id: incident.id, status: 'closed' },
        data: {
          status: 'capa_in_progress', closedAt: null, closedBy: null, closureNotes: null,
          escalationLevel: 0, escalationStartAt: now, lastEscalatedAt: null,
        },
      });
      reopened = r.count === 1;
      if (reopened) await cancelPendingReviews(incident.id);
    }

    await auditLog(req, {
      module: 'incident', action: 'UPDATE', entityType: 'IncidentEffectivenessReview', entityId: review.id,
      payload: { incidentId: incident.id, dayOffset: review.dayOffset, outcome: body.outcome, reopened },
    });
    if (reopened) {
      await auditLog(req, {
        module: 'incident', action: 'STATUS_CHANGE', entityType: 'Incident', entityId: incident.id,
        payload: { from: 'closed', to: 'capa_in_progress', reason: `${review.dayOffset}-day effectiveness check: not effective` },
      });
      const recipients = [...(await incidentManagerUserIds()), ...(await unitHeadUserIds(incident.unitId))];
      void bell(recipients, {
        type: 'incident_reopened', incidentId: incident.id, critical: true,
        title: `Incident reopened · ${incident.code}`,
        message: `The ${review.dayOffset}-day effectiveness check found the CAPA not effective — new actions are needed.`,
      });
    }

    const row = await prisma.incidentEffectivenessReview.findUniqueOrThrow({ where: { id: review.id } });
    res.status(200).json({ data: row, reopened });
  } catch (error) {
    fail(res, error, 'record effectiveness check');
  }
};
