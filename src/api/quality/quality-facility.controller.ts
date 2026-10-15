import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { INVALID, parseDateInput, parseRangeQuery, prismaErrorCode } from './quality-input.util';

// Phase 9.26 / Phase 5f — Facility / equipment / ambulance / maintenance.
//
// One file because each surface is small and they share helpers. Backs
// FMS-001 (PM), FMS-002 (calibration), FMS-003 (critical breakdown),
// FMS-004 (utility failure), FMS-008 (ambulance), FMS-009 (maintenance TAT).
// FMS-007 (security) reuses existing Incident + Phase 5c denominator pattern.

// Hospital-configurable target for ambulance "within-target". Computed at
// write time so historical FMS-008 numbers stay stable if the target is
// tuned in policy.
const AMBULANCE_TARGET_MINUTES = 8;

const EQUIPMENT_STATUSES = ['operational', 'breakdown', 'retired'] as const;
const EQUIPMENT_EVENT_TYPES = ['pm', 'calibration', 'breakdown'] as const;
const UTILITY_TYPES = ['power', 'water', 'gas', 'oxygen', 'medical_gas', 'hvac', 'other'] as const;
const MAINT_TYPES = ['electrical', 'plumbing', 'biomedical', 'civil', 'other'] as const;
const MAINT_STATUSES = ['open', 'in_progress', 'closed'] as const;

const badRange = (res: Response): void => {
  res.status(400).json({ message: "'from' / 'to' must be valid dates" });
};

const username = (req: Request): string | null => req.user?.username ?? null;
const userId = (req: Request): number | null => (typeof req.user?.id === 'number' ? req.user.id : null);

// ─── Equipment master ──────────────────────────────────────────────────

interface EquipmentBody {
  code?: string;
  name?: string;
  type?: string | null;
  isCritical?: boolean;
  location?: string | null;
  department?: string | null;
  status?: string;
}

export const createEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as EquipmentBody;
    if (!body.code || !body.code.trim()) { res.status(400).json({ message: "'code' is required" }); return; }
    if (!body.name || !body.name.trim()) { res.status(400).json({ message: "'name' is required" }); return; }
    if (body.status && !EQUIPMENT_STATUSES.includes(body.status as typeof EQUIPMENT_STATUSES[number])) {
      res.status(400).json({ message: `'status' must be one of: ${EQUIPMENT_STATUSES.join(', ')}` });
      return;
    }
    const row = await prisma.facilityEquipment.create({
      data: {
        code: body.code.trim(), name: body.name.trim(),
        type: body.type ?? null, isCritical: body.isCritical === true,
        location: body.location ?? null, department: body.department ?? null,
        status: body.status ?? 'operational',
      },
    });
    await auditLog(req, {
      module: 'facility-equipment', action: 'CREATE', entityType: 'FacilityEquipment',
      entityId: row.id, payload: { code: row.code, isCritical: row.isCritical },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    if (prismaErrorCode(error) === 'P2002') {
      res.status(409).json({ message: 'Equipment with this code already exists' });
      return;
    }
    console.error('[facility-equipment] create failed:', error);
    res.status(500).json({ message: 'Failed to add equipment' });
  }
};

export const listEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { isCritical, status, search, includeRetired } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (isCritical === 'true') where['isCritical'] = true;
    if (isCritical === 'false') where['isCritical'] = false;
    // Retired equipment is hidden unless explicitly asked for.
    if (status) where['status'] = status;
    else if (includeRetired !== 'true') where['status'] = { not: 'retired' };
    if (search) where['OR'] = [{ code: { contains: search } }, { name: { contains: search } }];
    const [rows, total] = await Promise.all([
      prisma.facilityEquipment.findMany({ where, orderBy: { code: 'asc' }, take: 1000 }),
      prisma.facilityEquipment.count({ where }),
    ]);
    res.status(200).json({ data: rows, total });
  } catch (error) {
    console.error('[facility-equipment] list failed:', error);
    res.status(500).json({ message: 'Failed to load equipment' });
  }
};

export const updateEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const ex = await prisma.facilityEquipment.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Equipment not found' }); return; }
    const body = (req.body ?? {}) as EquipmentBody;
    if (body.status && !EQUIPMENT_STATUSES.includes(body.status as typeof EQUIPMENT_STATUSES[number])) {
      res.status(400).json({ message: `'status' must be one of: ${EQUIPMENT_STATUSES.join(', ')}` });
      return;
    }
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string') data['name'] = body.name.trim();
    if (body.type !== undefined) data['type'] = body.type;
    if (typeof body.isCritical === 'boolean') data['isCritical'] = body.isCritical;
    if (body.location !== undefined) data['location'] = body.location;
    if (body.department !== undefined) data['department'] = body.department;
    if (body.status) data['status'] = body.status;
    const row = await prisma.facilityEquipment.update({ where: { id }, data });
    await auditLog(req, {
      module: 'facility-equipment', action: 'UPDATE', entityType: 'FacilityEquipment',
      entityId: id, payload: data,
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[facility-equipment] update failed:', error);
    res.status(500).json({ message: 'Failed to update equipment' });
  }
};

export const deleteEquipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const ex = await prisma.facilityEquipment.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Equipment not found' }); return; }
    // Events cascade on delete and feed FMS-001/002/003 — keep history by
    // retiring instead. Hard delete only when nothing references the row.
    const eventCount = await prisma.facilityEquipmentEvent.count({ where: { equipmentId: id } });
    if (eventCount > 0) {
      await prisma.facilityEquipment.update({ where: { id }, data: { status: 'retired' } });
      await auditLog(req, {
        module: 'facility-equipment', action: 'RETIRE', entityType: 'FacilityEquipment',
        entityId: id, payload: { code: ex.code, from: ex.status, eventCount },
      });
      res.status(200).json({ ok: true, retired: true });
      return;
    }
    await prisma.facilityEquipment.delete({ where: { id } });
    await auditLog(req, {
      module: 'facility-equipment', action: 'DELETE', entityType: 'FacilityEquipment',
      entityId: id, payload: { code: ex.code },
    });
    res.status(200).json({ ok: true, retired: false });
  } catch (error) {
    console.error('[facility-equipment] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete equipment' });
  }
};

// ─── Equipment events (PM / calibration / breakdown) ───────────────────

interface EquipmentEventBody {
  equipmentId?: string;
  eventType?: string;
  dueAt?: string | null;
  occurredAt?: string;
  resolvedAt?: string | null;
  notes?: string | null;
}

export const createEquipmentEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as EquipmentEventBody;
    if (!body.equipmentId) { res.status(400).json({ message: "'equipmentId' is required" }); return; }
    if (!body.eventType || !EQUIPMENT_EVENT_TYPES.includes(body.eventType as typeof EQUIPMENT_EVENT_TYPES[number])) {
      res.status(400).json({ message: `'eventType' must be one of: ${EQUIPMENT_EVENT_TYPES.join(', ')}` });
      return;
    }
    // Date-only dueAt = end of that IST day, so same-day completion is on time.
    const dueAt = parseDateInput(body.dueAt, true);
    const occurredIn = parseDateInput(body.occurredAt);
    const resolvedAt = parseDateInput(body.resolvedAt);
    if (dueAt === INVALID || occurredIn === INVALID || resolvedAt === INVALID) {
      res.status(400).json({ message: "'dueAt', 'occurredAt' and 'resolvedAt' must be valid dates" });
      return;
    }
    const occurredAt = occurredIn ?? new Date();
    if (resolvedAt && resolvedAt < occurredAt) {
      res.status(400).json({ message: "'resolvedAt' must be at or after 'occurredAt'" });
      return;
    }
    const equipment = await prisma.facilityEquipment.findUnique({
      where: { id: body.equipmentId }, select: { id: true, status: true },
    });
    if (!equipment) { res.status(404).json({ message: 'Equipment not found' }); return; }

    const row = await prisma.facilityEquipmentEvent.create({
      data: {
        equipmentId: body.equipmentId, eventType: body.eventType,
        dueAt, occurredAt,
        resolvedAt: body.eventType === 'breakdown' ? resolvedAt : null,
        performedBy: username(req), performedById: userId(req),
        notes: body.notes ?? null,
      },
    });

    // Flip equipment.status on breakdown / restore (never un-retire).
    if (body.eventType === 'breakdown' && equipment.status !== 'retired') {
      if (!resolvedAt) {
        await prisma.facilityEquipment.update({ where: { id: body.equipmentId }, data: { status: 'breakdown' } });
      } else {
        await restoreIfNoOpenBreakdown(body.equipmentId);
      }
    }

    await auditLog(req, {
      module: 'facility-equipment-event', action: 'CREATE', entityType: 'FacilityEquipmentEvent',
      entityId: String(row.id),
      payload: { equipmentId: body.equipmentId, eventType: body.eventType },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[facility-equipment-event] create failed:', error);
    res.status(500).json({ message: 'Failed to record event' });
  }
};

export const listEquipmentEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { equipmentId, eventType, from, to } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (equipmentId) where['equipmentId'] = equipmentId;
    if (eventType) where['eventType'] = eventType;
    const range = parseRangeQuery(from, to);
    if (range === INVALID) { badRange(res); return; }
    if (range) where['occurredAt'] = range;
    const [rows, total] = await Promise.all([
      prisma.facilityEquipmentEvent.findMany({
        where, orderBy: { occurredAt: 'desc' }, take: 500,
        include: { equipment: { select: { code: true, name: true, isCritical: true, status: true } } },
      }),
      prisma.facilityEquipmentEvent.count({ where }),
    ]);
    res.status(200).json({ data: rows, total });
  } catch (error) {
    console.error('[facility-equipment-event] list failed:', error);
    res.status(500).json({ message: 'Failed to load events' });
  }
};

/** Set equipment back to operational once it has no open breakdown events. */
async function restoreIfNoOpenBreakdown(equipmentId: string): Promise<void> {
  const open = await prisma.facilityEquipmentEvent.count({
    where: { equipmentId, eventType: 'breakdown', resolvedAt: null },
  });
  if (open > 0) return;
  await prisma.facilityEquipment.updateMany({
    where: { id: equipmentId, status: 'breakdown' }, data: { status: 'operational' },
  });
}

export const resolveEquipmentEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const body = (req.body ?? {}) as { resolvedAt?: string | null; notes?: string | null };
    const parsed = parseDateInput(body.resolvedAt);
    if (parsed === INVALID) { res.status(400).json({ message: "'resolvedAt' must be a valid date" }); return; }
    const ex = await prisma.facilityEquipmentEvent.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Event not found' }); return; }
    if (ex.eventType !== 'breakdown') { res.status(400).json({ message: 'Only breakdown events can be resolved' }); return; }
    if (ex.resolvedAt) { res.status(409).json({ message: 'Breakdown is already resolved' }); return; }
    const resolvedAt = parsed ?? new Date();
    if (resolvedAt < ex.occurredAt) {
      res.status(400).json({ message: "'resolvedAt' must be at or after the breakdown time" });
      return;
    }
    const data: Record<string, unknown> = { resolvedAt };
    const note = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (note) data['notes'] = ex.notes ? `${ex.notes}\nResolution: ${note}` : `Resolution: ${note}`;
    const row = await prisma.facilityEquipmentEvent.update({ where: { id }, data });
    await restoreIfNoOpenBreakdown(ex.equipmentId);
    await auditLog(req, {
      module: 'facility-equipment-event', action: 'RESOLVE', entityType: 'FacilityEquipmentEvent',
      entityId: String(id), payload: { equipmentId: ex.equipmentId, resolvedAt },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[facility-equipment-event] resolve failed:', error);
    res.status(500).json({ message: 'Failed to resolve breakdown' });
  }
};

export const deleteEquipmentEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.facilityEquipmentEvent.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Event not found' }); return; }
    await prisma.facilityEquipmentEvent.delete({ where: { id } });
    await auditLog(req, {
      module: 'facility-equipment-event', action: 'DELETE', entityType: 'FacilityEquipmentEvent',
      entityId: String(id), payload: { equipmentId: ex.equipmentId, eventType: ex.eventType },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[facility-equipment-event] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete event' });
  }
};

// ─── Utility failures ──────────────────────────────────────────────────

interface UtilityBody {
  utilityType?: string;
  occurredAt?: string;
  durationMinutes?: number | null;
  affectedAreas?: string | null;
  notes?: string | null;
}

export const createUtilityFailure = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as UtilityBody;
    if (!body.utilityType || !UTILITY_TYPES.includes(body.utilityType as typeof UTILITY_TYPES[number])) {
      res.status(400).json({ message: `'utilityType' must be one of: ${UTILITY_TYPES.join(', ')}` });
      return;
    }
    const occurredAt = parseDateInput(body.occurredAt);
    if (occurredAt === INVALID) { res.status(400).json({ message: "'occurredAt' must be a valid date" }); return; }
    const duration = body.durationMinutes;
    if (duration !== undefined && duration !== null
        && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) {
      res.status(400).json({ message: "'durationMinutes' must be a non-negative number" });
      return;
    }
    const row = await prisma.facilityUtilityFailure.create({
      data: {
        utilityType: body.utilityType,
        occurredAt: occurredAt ?? new Date(),
        durationMinutes: typeof duration === 'number' ? Math.round(duration) : null,
        affectedAreas: body.affectedAreas ?? null,
        notes: body.notes ?? null,
        reporter: username(req), reporterId: userId(req),
      },
    });
    await auditLog(req, {
      module: 'facility-utility', action: 'CREATE', entityType: 'FacilityUtilityFailure',
      entityId: String(row.id), payload: { utilityType: row.utilityType },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[facility-utility] create failed:', error);
    res.status(500).json({ message: 'Failed to record utility failure' });
  }
};

export const listUtilityFailures = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, utilityType } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (utilityType) where['utilityType'] = utilityType;
    const range = parseRangeQuery(from, to);
    if (range === INVALID) { badRange(res); return; }
    if (range) where['occurredAt'] = range;
    const [rows, total] = await Promise.all([
      prisma.facilityUtilityFailure.findMany({ where, orderBy: { occurredAt: 'desc' }, take: 500 }),
      prisma.facilityUtilityFailure.count({ where }),
    ]);
    res.status(200).json({ data: rows, total });
  } catch (error) {
    console.error('[facility-utility] list failed:', error);
    res.status(500).json({ message: 'Failed to load utility failures' });
  }
};

export const deleteUtilityFailure = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.facilityUtilityFailure.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Row not found' }); return; }
    await prisma.facilityUtilityFailure.delete({ where: { id } });
    await auditLog(req, {
      module: 'facility-utility', action: 'DELETE', entityType: 'FacilityUtilityFailure',
      entityId: String(id), payload: { utilityType: ex.utilityType },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[facility-utility] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete row' });
  }
};

// ─── Ambulance calls ───────────────────────────────────────────────────

interface AmbulanceBody {
  calledAt?: string;
  dispatchedAt?: string | null;
  arrivedAt?: string | null;
  responseTimeMinutes?: number | null;
  notes?: string | null;
}

export const createAmbulanceCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as AmbulanceBody;
    if (!body.calledAt) { res.status(400).json({ message: "'calledAt' is required" }); return; }
    const calledAt = parseDateInput(body.calledAt);
    if (!calledAt || calledAt === INVALID) { res.status(400).json({ message: "'calledAt' must be a valid date" }); return; }
    const dispatchedAt = parseDateInput(body.dispatchedAt);
    const arrivedAt = parseDateInput(body.arrivedAt);
    if (dispatchedAt === INVALID || arrivedAt === INVALID) {
      res.status(400).json({ message: "'dispatchedAt' / 'arrivedAt' must be valid dates" });
      return;
    }
    if (dispatchedAt && dispatchedAt < calledAt) {
      res.status(400).json({ message: "'dispatchedAt' must be at or after 'calledAt'" });
      return;
    }
    if (arrivedAt && arrivedAt < calledAt) {
      res.status(400).json({ message: "'arrivedAt' must be at or after 'calledAt'" });
      return;
    }
    const suppliedRt = body.responseTimeMinutes;
    if (suppliedRt !== undefined && suppliedRt !== null
        && (typeof suppliedRt !== 'number' || !Number.isFinite(suppliedRt) || suppliedRt < 0)) {
      res.status(400).json({ message: "'responseTimeMinutes' must be a non-negative number" });
      return;
    }

    let responseTimeMinutes = typeof suppliedRt === 'number' ? Math.round(suppliedRt) : null;
    if (arrivedAt && responseTimeMinutes === null) {
      responseTimeMinutes = Math.round((arrivedAt.getTime() - calledAt.getTime()) / 60_000);
    }
    // withinTarget is a non-null column, so an unknown response time is
    // stored as false (target not evidenced) until the schema allows null.
    const withinTarget = responseTimeMinutes !== null && responseTimeMinutes <= AMBULANCE_TARGET_MINUTES;

    const row = await prisma.facilityAmbulanceCall.create({
      data: {
        calledAt,
        dispatchedAt,
        arrivedAt, responseTimeMinutes,
        withinTarget,
        notes: body.notes ?? null,
        reporter: username(req), reporterId: userId(req),
      },
    });
    await auditLog(req, {
      module: 'facility-ambulance', action: 'CREATE', entityType: 'FacilityAmbulanceCall',
      entityId: String(row.id), payload: { withinTarget, responseTimeMinutes },
    });
    res.status(201).json({ data: row, target: AMBULANCE_TARGET_MINUTES });
  } catch (error) {
    console.error('[facility-ambulance] create failed:', error);
    res.status(500).json({ message: 'Failed to record ambulance call' });
  }
};

export const listAmbulanceCalls = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    const range = parseRangeQuery(from, to);
    if (range === INVALID) { badRange(res); return; }
    if (range) where['calledAt'] = range;
    const [rows, total] = await Promise.all([
      prisma.facilityAmbulanceCall.findMany({ where, orderBy: { calledAt: 'desc' }, take: 500 }),
      prisma.facilityAmbulanceCall.count({ where }),
    ]);
    res.status(200).json({ data: rows, total, target: AMBULANCE_TARGET_MINUTES });
  } catch (error) {
    console.error('[facility-ambulance] list failed:', error);
    res.status(500).json({ message: 'Failed to load ambulance calls' });
  }
};

export const deleteAmbulanceCall = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.facilityAmbulanceCall.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Call not found' }); return; }
    await prisma.facilityAmbulanceCall.delete({ where: { id } });
    await auditLog(req, {
      module: 'facility-ambulance', action: 'DELETE', entityType: 'FacilityAmbulanceCall',
      entityId: String(id), payload: { calledAt: ex.calledAt },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[facility-ambulance] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete call' });
  }
};

// ─── Maintenance complaints ────────────────────────────────────────────

interface MaintBody {
  type?: string;
  location?: string | null;
  notes?: string | null;
  slaDueAt?: string;
  status?: string;
  closedAt?: string | null;
}

export const createMaintenanceComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as MaintBody;
    if (!body.type || !MAINT_TYPES.includes(body.type as typeof MAINT_TYPES[number])) {
      res.status(400).json({ message: `'type' must be one of: ${MAINT_TYPES.join(', ')}` });
      return;
    }
    if (!body.slaDueAt) { res.status(400).json({ message: "'slaDueAt' is required" }); return; }
    const slaDueAt = parseDateInput(body.slaDueAt, true);
    if (!slaDueAt || slaDueAt === INVALID) { res.status(400).json({ message: "'slaDueAt' must be a valid date" }); return; }

    const row = await prisma.facilityMaintenanceComplaint.create({
      data: {
        type: body.type, location: body.location ?? null, notes: body.notes ?? null,
        slaDueAt, status: 'open',
        reporter: username(req), reporterId: userId(req),
      },
    });
    await auditLog(req, {
      module: 'facility-maintenance', action: 'CREATE', entityType: 'FacilityMaintenanceComplaint',
      entityId: String(row.id), payload: { type: row.type, slaDueAt: row.slaDueAt },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[facility-maintenance] create failed:', error);
    res.status(500).json({ message: 'Failed to raise maintenance complaint' });
  }
};

export const listMaintenanceComplaints = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, from, to } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    const range = parseRangeQuery(from, to);
    if (range === INVALID) { badRange(res); return; }
    if (range) where['raisedAt'] = range;
    const [rows, total] = await Promise.all([
      prisma.facilityMaintenanceComplaint.findMany({ where, orderBy: { raisedAt: 'desc' }, take: 500 }),
      prisma.facilityMaintenanceComplaint.count({ where }),
    ]);
    res.status(200).json({ data: rows, total });
  } catch (error) {
    console.error('[facility-maintenance] list failed:', error);
    res.status(500).json({ message: 'Failed to load complaints' });
  }
};

export const updateMaintenanceStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const body = (req.body ?? {}) as MaintBody;
    if (!body.status || !MAINT_STATUSES.includes(body.status as typeof MAINT_STATUSES[number])) {
      res.status(400).json({ message: `'status' must be one of: ${MAINT_STATUSES.join(', ')}` });
      return;
    }
    const ex = await prisma.facilityMaintenanceComplaint.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Complaint not found' }); return; }

    const closedAt = parseDateInput(body.closedAt);
    if (closedAt === INVALID) { res.status(400).json({ message: "'closedAt' must be a valid date" }); return; }

    const data: Record<string, unknown> = { status: body.status };
    if (body.status === 'closed') {
      data['closedAt'] = closedAt ?? new Date();
      data['closedBy'] = username(req);
      data['closedById'] = userId(req);
    } else {
      data['closedAt'] = null;
      data['closedBy'] = null;
      data['closedById'] = null;
    }
    const row = await prisma.facilityMaintenanceComplaint.update({ where: { id }, data });
    await auditLog(req, {
      module: 'facility-maintenance', action: 'STATUS', entityType: 'FacilityMaintenanceComplaint',
      entityId: String(id), payload: { status: body.status },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[facility-maintenance] status update failed:', error);
    res.status(500).json({ message: 'Failed to update status' });
  }
};

export const deleteMaintenanceComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.facilityMaintenanceComplaint.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Complaint not found' }); return; }
    await prisma.facilityMaintenanceComplaint.delete({ where: { id } });
    await auditLog(req, {
      module: 'facility-maintenance', action: 'DELETE', entityType: 'FacilityMaintenanceComplaint',
      entityId: String(id), payload: { type: ex.type },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[facility-maintenance] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete complaint' });
  }
};
