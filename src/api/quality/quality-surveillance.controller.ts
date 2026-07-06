import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.26 / Phase 5b — Infection surveillance / NSI / sterilization /
// device-day capture. Three sibling controllers sharing one file because
// each has a small, almost-identical CRUD surface.

// ─── Period helper ─────────────────────────────────────────────────────
function deriveMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const VALID_SURV_TYPES = ['HAI', 'SSI', 'VAP', 'CAUTI', 'CLABSI', 'NSI'] as const;
const VALID_DEVICE_TYPES = ['ventilator', 'urinary_catheter', 'central_line'] as const;

// ─── Surveillance events ───────────────────────────────────────────────

interface SurvCreateBody {
  type?: string;
  patientPrn?: string | null;
  admissionId?: string | null;
  ward?: string | null;
  organism?: string | null;
  deviceRelated?: boolean;
  observedAt?: string;
  notes?: string | null;
}

export const createSurveillance = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as SurvCreateBody;
    if (!body.type || !VALID_SURV_TYPES.includes(body.type as typeof VALID_SURV_TYPES[number])) {
      res.status(400).json({ message: `'type' must be one of: ${VALID_SURV_TYPES.join(', ')}` });
      return;
    }
    const observedAt = body.observedAt ? new Date(body.observedAt) : new Date();
    if (Number.isNaN(observedAt.getTime())) {
      res.status(400).json({ message: "'observedAt' must be a valid ISO date" });
      return;
    }
    const row = await prisma.qualitySurveillanceEvent.create({
      data: {
        type: body.type,
        patientPrn: body.patientPrn ?? null,
        admissionId: body.admissionId ?? null,
        ward: body.ward ?? null,
        organism: body.organism ?? null,
        deviceRelated: body.deviceRelated === true,
        observedAt,
        period: deriveMonth(observedAt),
        notes: body.notes ?? null,
        reporter: req.user?.username ?? null,
        reporterId: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'quality-surveillance', action: 'CREATE', entityType: 'QualitySurveillanceEvent',
      entityId: String(row.id),
      payload: { type: row.type, period: row.period, ward: row.ward },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[quality-surv] create failed:', error);
    res.status(500).json({ message: 'Failed to record surveillance event' });
  }
};

export const listSurveillance = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, period, ward } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (type) where['type'] = type;
    if (period) where['period'] = period;
    if (ward) where['ward'] = ward;
    const rows = await prisma.qualitySurveillanceEvent.findMany({
      where, orderBy: { observedAt: 'desc' }, take: 500,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-surv] list failed:', error);
    res.status(500).json({ message: 'Failed to load surveillance events' });
  }
};

export const deleteSurveillance = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.qualitySurveillanceEvent.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Event not found' }); return; }
    await prisma.qualitySurveillanceEvent.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-surveillance', action: 'DELETE', entityType: 'QualitySurveillanceEvent',
      entityId: String(id), payload: { type: ex.type, period: ex.period },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-surv] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete event' });
  }
};

// ─── Device-day counts ─────────────────────────────────────────────────

interface DeviceDayBody {
  date?: string;
  ward?: string;
  deviceType?: string;
  count?: number;
}

export const upsertDeviceDay = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as DeviceDayBody;
    if (!body.date) { res.status(400).json({ message: "'date' is required (YYYY-MM-DD)" }); return; }
    if (!body.ward) { res.status(400).json({ message: "'ward' is required" }); return; }
    if (!body.deviceType || !VALID_DEVICE_TYPES.includes(body.deviceType as typeof VALID_DEVICE_TYPES[number])) {
      res.status(400).json({ message: `'deviceType' must be one of: ${VALID_DEVICE_TYPES.join(', ')}` });
      return;
    }
    if (typeof body.count !== 'number' || !Number.isInteger(body.count) || body.count < 0) {
      res.status(400).json({ message: "'count' must be a non-negative integer" });
      return;
    }
    // Normalize to start-of-day so the @@unique([date, ward, deviceType]) hits.
    const day = new Date(body.date);
    if (Number.isNaN(day.getTime())) { res.status(400).json({ message: "'date' is not parseable" }); return; }
    day.setHours(0, 0, 0, 0);

    const row = await prisma.qualityDeviceDayCount.upsert({
      where: { date_ward_deviceType: { date: day, ward: body.ward, deviceType: body.deviceType } },
      create: {
        date: day, ward: body.ward, deviceType: body.deviceType, count: body.count,
        capturedBy: req.user?.username ?? null,
        capturedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      update: {
        count: body.count,
        capturedBy: req.user?.username ?? null,
        capturedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'quality-device-day', action: 'UPSERT', entityType: 'QualityDeviceDayCount',
      entityId: String(row.id),
      payload: { date: body.date, ward: row.ward, deviceType: row.deviceType, count: row.count },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[quality-device-day] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save device-day count' });
  }
};

export const listDeviceDays = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, ward, deviceType } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (ward) where['ward'] = ward;
    if (deviceType) where['deviceType'] = deviceType;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range['gte'] = new Date(from);
      if (to) range['lte'] = new Date(to);
      where['date'] = range;
    }
    const rows = await prisma.qualityDeviceDayCount.findMany({
      where, orderBy: { date: 'desc' }, take: 1000,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-device-day] list failed:', error);
    res.status(500).json({ message: 'Failed to load device-day counts' });
  }
};

export const deleteDeviceDay = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.qualityDeviceDayCount.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Row not found' }); return; }
    await prisma.qualityDeviceDayCount.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-device-day', action: 'DELETE', entityType: 'QualityDeviceDayCount',
      entityId: String(id),
      payload: { ward: ex.ward, deviceType: ex.deviceType, date: ex.date },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-device-day] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete row' });
  }
};

// ─── Sterilization cycles ──────────────────────────────────────────────

interface SterilCreateBody {
  batchCode?: string | null;
  runAt?: string;
  passed?: boolean;
  failureReason?: string | null;
}

export const createSterilizationCycle = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as SterilCreateBody;
    if (typeof body.passed !== 'boolean') {
      res.status(400).json({ message: "'passed' (boolean) is required" });
      return;
    }
    const runAt = body.runAt ? new Date(body.runAt) : new Date();
    if (Number.isNaN(runAt.getTime())) { res.status(400).json({ message: "'runAt' is not parseable" }); return; }

    const row = await prisma.qualitySterilizationCycle.create({
      data: {
        batchCode: body.batchCode ?? null,
        runAt, passed: body.passed,
        failureReason: body.passed ? null : (body.failureReason ?? null),
        capturedBy: req.user?.username ?? null,
        capturedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'quality-sterilization', action: 'CREATE', entityType: 'QualitySterilizationCycle',
      entityId: String(row.id),
      payload: { batchCode: row.batchCode, passed: row.passed },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[quality-steril] create failed:', error);
    res.status(500).json({ message: 'Failed to record cycle' });
  }
};

export const listSterilizationCycles = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, passed } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (passed === 'true') where['passed'] = true;
    if (passed === 'false') where['passed'] = false;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range['gte'] = new Date(from);
      if (to) range['lte'] = new Date(to);
      where['runAt'] = range;
    }
    const rows = await prisma.qualitySterilizationCycle.findMany({
      where, orderBy: { runAt: 'desc' }, take: 500,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-steril] list failed:', error);
    res.status(500).json({ message: 'Failed to load cycles' });
  }
};

export const deleteSterilizationCycle = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.qualitySterilizationCycle.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Cycle not found' }); return; }
    await prisma.qualitySterilizationCycle.delete({ where: { id } });
    await auditLog(req, {
      module: 'quality-sterilization', action: 'DELETE', entityType: 'QualitySterilizationCycle',
      entityId: String(id),
      payload: { batchCode: ex.batchCode },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[quality-steril] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete cycle' });
  }
};
