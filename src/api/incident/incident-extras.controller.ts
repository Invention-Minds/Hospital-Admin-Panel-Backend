import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog, auditLogSystem } from '../../service/app-audit';
import { INCIDENT_TAXONOMY, isValidSubCategory } from '../../service/incident-taxonomy';
import { HARM_LEVELS, isHarmLevel, severityFromHarm } from '../../service/incident-harm';
import { assertUnit } from '../../service/quality-escalation';
import {
  createWithIncidentCode, notifyIncidentRaised, incidentPermissions,
} from './incident.controller';

// Phase 3 — incident sub-types, anonymous public reporting (QR poster) and
// staff "also involved" on an incident.
//
//   GET    /api/incidents/taxonomy                  public — categories + sub-types
//   GET    /api/incidents/public/units              public — active units for the QR form
//   POST   /api/incidents/public                    public — anonymous report (rate-limited)
//   POST   /api/incidents/:id/participants          manager / unit HOD — add staff involved
//   DELETE /api/incidents/:id/participants/:userId  manager / unit HOD — remove

const CATEGORIES = INCIDENT_TAXONOMY.map((c) => c.category);
const MIN_DESCRIPTION = 20;
const MAX_DESCRIPTION = 4000;

export const getTaxonomy = (_req: Request, res: Response): void => {
  res.json({ data: INCIDENT_TAXONOMY });
};

export const listPublicUnits = async (_req: Request, res: Response): Promise<void> => {
  try {
    const units = await prisma.hospitalUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    res.json({ data: units });
  } catch (error) {
    console.error('[incident] public units failed:', error);
    res.status(500).json({ message: 'Could not load the list of areas' });
  }
};

/**
 * Anonymous report from the public QR page. Nothing that identifies the
 * reporter is stored (no user, no IP in the incident). A filled `website`
 * field is the bot trap: the bot gets a normal-looking reply, nothing is saved.
 */
export const createPublicIncident = async (req: Request, res: Response): Promise<void> => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.website === 'string' && b.website.trim()) {
      res.status(201).json({ data: { code: 'received' } });
      return;
    }
    const category = String(b.category ?? '');
    if (!CATEGORIES.includes(category)) {
      res.status(400).json({ message: 'Please choose what kind of incident it was.' });
      return;
    }
    if (!isValidSubCategory(category, b.subCategory)) {
      res.status(400).json({ message: 'Please choose a valid sub-type.' });
      return;
    }
    const description = typeof b.description === 'string' ? b.description.trim() : '';
    if (description.length < MIN_DESCRIPTION) {
      res.status(400).json({ message: `Please describe what happened (at least ${MIN_DESCRIPTION} characters).` });
      return;
    }
    if (description.length > MAX_DESCRIPTION) {
      res.status(400).json({ message: `Please keep the description under ${MAX_DESCRIPTION} characters.` });
      return;
    }
    // Harm: optional ("not sure" = null). Unknown harm is triaged as moderate
    // so it is looked at, never quietly filed as minor.
    let harmLevel: string | null = null;
    if (b.harmLevel != null && b.harmLevel !== '') {
      if (!isHarmLevel(b.harmLevel)) {
        res.status(400).json({ message: `harmLevel must be one of: ${HARM_LEVELS.join(', ')}` });
        return;
      }
      harmLevel = b.harmLevel;
    }
    const severity = harmLevel ? severityFromHarm(harmLevel as typeof HARM_LEVELS[number]) : 'moderate';
    let unitId: number | null = null;
    try { unitId = await assertUnit(b.unitId); } catch { res.status(400).json({ message: 'Unknown area — please pick it from the list.' }); return; }
    const location = typeof b.location === 'string' ? b.location.trim().slice(0, 160) || null : null;
    let occurredAt: Date | null = null;
    if (typeof b.occurredAt === 'string' && b.occurredAt) {
      const d = new Date(b.occurredAt);
      if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 60 * 60 * 1000) {
        res.status(400).json({ message: 'Please enter a valid date and time (not in the future).' });
        return;
      }
      occurredAt = d;
    }
    const cat = INCIDENT_TAXONOMY.find((c) => c.category === category);
    const sub = cat?.subtypes.find((s) => s.key === b.subCategory);
    const title = `[Anonymous] ${sub?.label ?? cat?.label ?? 'Incident'}${location ? ` — ${location}` : ''}`.slice(0, 190);

    const incident = await createWithIncidentCode((code) => prisma.incident.create({
      data: {
        code, category, subCategory: (b.subCategory as string) || null, severity, harmLevel,
        source: 'anonymous', anonymous: true, title, description,
        ward: location, occurredAt, unitId, escalationStartAt: new Date(),
        reportedBy: null, reportedById: null,
      },
    }));
    await auditLogSystem({
      module: 'incident', action: 'CREATE', entityType: 'Incident', entityId: incident.id, source: 'public-qr',
      payload: { code: incident.code, category, subCategory: b.subCategory ?? null, severity, unitId },
    });
    void notifyIncidentRaised(incident);
    res.status(201).json({ data: { code: incident.code } });
  } catch (error) {
    console.error('[incident] public report failed:', error);
    res.status(500).json({ message: 'Could not submit the report — please try again or tell the Quality team.' });
  }
};

// ─── Staff also involved ────────────────────────────────────────────────

async function loadForParticipants(req: Request, res: Response) {
  const incident = await prisma.incident.findUnique({ where: { id: req.params.id }, select: { id: true, code: true, status: true, unitId: true, title: true, severity: true } });
  if (!incident) { res.status(404).json({ message: 'Incident not found' }); return null; }
  if (incident.status === 'closed' || incident.status === 'cancelled') {
    res.status(409).json({ message: `Incident is ${incident.status} — reopen it before changing who is involved` });
    return null;
  }
  if (!(await incidentPermissions(req.user?.id, incident)).canTriage) {
    res.status(403).json({ message: 'Only incident managers or the unit HOD can change who is involved' });
    return null;
  }
  return incident;
}

export const addParticipant = async (req: Request, res: Response): Promise<void> => {
  try {
    const incident = await loadForParticipants(req, res);
    if (!incident) return;
    const raw = (req.body ?? {}).userId;
    const userId = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) { res.status(400).json({ message: 'userId is required' }); return; }
    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
    if (!user) { res.status(400).json({ message: 'userId does not match an active user' }); return; }
    const existing = await prisma.incidentParticipant.findUnique({ where: { incidentId_userId: { incidentId: incident.id, userId } } });
    if (existing) { res.status(409).json({ message: 'Already involved' }); return; }
    await prisma.incidentParticipant.create({ data: { incidentId: incident.id, userId, addedBy: req.user?.username ?? null } });
    await auditLog(req, { module: 'incident', action: 'UPDATE', entityType: 'Incident', entityId: incident.id, payload: { participantAdded: userId } });
    if (userId !== req.user?.id) {
      await prisma.notification.create({
        data: {
          type: 'incident_participant', title: `You were added to an incident · ${incident.code}`,
          message: `[${incident.severity.toUpperCase()}] ${incident.title}`, status: 'unread',
          entityId: 0, entityType: `Incident:${incident.id}`, userId,
        },
      }).catch((e) => console.warn('[incident:participant] bell failed:', (e as Error).message));
    }
    res.status(201).json({ data: { userId } });
  } catch (error) {
    console.error('[incident] addParticipant failed:', error);
    res.status(500).json({ message: 'Failed to add the staff member' });
  }
};

export const removeParticipant = async (req: Request, res: Response): Promise<void> => {
  try {
    const incident = await loadForParticipants(req, res);
    if (!incident) return;
    const userId = Number(req.params.userId);
    const { count } = await prisma.incidentParticipant.deleteMany({ where: { incidentId: incident.id, userId } });
    if (!count) { res.status(404).json({ message: 'Not on this incident' }); return; }
    await auditLog(req, { module: 'incident', action: 'UPDATE', entityType: 'Incident', entityId: incident.id, payload: { participantRemoved: userId } });
    res.json({ data: { userId } });
  } catch (error) {
    console.error('[incident] removeParticipant failed:', error);
    res.status(500).json({ message: 'Failed to remove the staff member' });
  }
};
