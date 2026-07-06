import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Day-Care Monitoring controller (Phase 5 — NABH COP.6).
 *
 * For outpatient day-procedure sessions (dialysis, chemo, endoscopy,
 * day-surgery). Two endpoint groups:
 *   • Session CRUD — create the session and its alert thresholds upfront.
 *   • Readings — append per-time-row vitals; the server computes which
 *     thresholds were breached and stamps `alertsTriggered` so the UI can
 *     highlight the row and prompt to call the duty doctor.
 */

const VALID_PROCEDURE_TYPES = ['chemo', 'dialysis', 'endoscopy', 'day-surgery', 'other'];
const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISCHARGED', 'CANCELLED'];
const VALID_IV_PATENCY = ['patent', 'blocked', 'na'];

// ─── Session CRUD ───────────────────────────────────────────────────

interface UpsertSessionBody {
  prn?: string | null;
  patientName: string;
  age?: number | null;
  gender?: string | null;
  dateOfService: string;
  procedureType: string;
  procedureDetails?: string | null;
  allergies?: string | null;
  consultantName?: string | null;

  spo2Low?: number | null;
  spo2High?: number | null;
  bpSystolicLow?: number | null;
  bpSystolicHigh?: number | null;
  bpDiastolicLow?: number | null;
  bpDiastolicHigh?: number | null;
  hrLow?: number | null;
  hrHigh?: number | null;
  rrLow?: number | null;
  rrHigh?: number | null;
  tempLow?: number | null;
  tempHigh?: number | null;
  uopLow?: number | null;
  uopHigh?: number | null;

  startedAt?: string | null;
  completedAt?: string | null;
  dischargedAt?: string | null;
  status?: string;
}

export const listSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const dateParam = req.query.date as string | undefined;
    const status = req.query.status as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (dateParam) {
      const day = new Date(`${dateParam}T00:00:00`);
      const next = new Date(day); next.setDate(day.getDate() + 1);
      where.dateOfService = { gte: day, lt: next };
    }
    const rows = await prisma.dayCareSession.findMany({
      where,
      orderBy: { dateOfService: 'desc' },
      take: 500,
      include: { readings: { orderBy: { recordedAt: 'asc' }, take: 1 } },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[day-care] listSessions failed:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
};

export const getSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.dayCareSession.findUnique({
      where: { id: req.params.id },
      include: { readings: { orderBy: { recordedAt: 'asc' } } },
    });
    if (!row) { res.status(404).json({ error: 'Session not found' }); return; }
    res.status(200).json(row);
  } catch (error) {
    console.error('[day-care] getSession failed:', error);
    res.status(500).json({ error: 'Failed to load session' });
  }
};

export const upsertSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as UpsertSessionBody;
    if (!body.patientName?.trim() || !body.dateOfService || !body.procedureType) {
      res.status(400).json({ error: 'patientName, dateOfService and procedureType are required' });
      return;
    }
    if (!VALID_PROCEDURE_TYPES.includes(body.procedureType)) {
      res.status(400).json({ error: `procedureType must be one of: ${VALID_PROCEDURE_TYPES.join(', ')}` });
      return;
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    // Build a single typed object — Prisma's create input wants the required
    // fields visible at the literal level, so we keep them out of any
    // intermediate Record<string, unknown> wrapper.
    const baseData = {
      prn: body.prn ?? null,
      patientName: body.patientName.trim(),
      age: body.age ?? null,
      gender: body.gender ?? null,
      dateOfService: new Date(body.dateOfService),
      procedureType: body.procedureType,
      procedureDetails: body.procedureDetails ?? null,
      allergies: body.allergies ?? null,
      consultantName: body.consultantName ?? null,
      spo2Low: body.spo2Low ?? null,
      spo2High: body.spo2High ?? null,
      bpSystolicLow: body.bpSystolicLow ?? null,
      bpSystolicHigh: body.bpSystolicHigh ?? null,
      bpDiastolicLow: body.bpDiastolicLow ?? null,
      bpDiastolicHigh: body.bpDiastolicHigh ?? null,
      hrLow: body.hrLow ?? null,
      hrHigh: body.hrHigh ?? null,
      rrLow: body.rrLow ?? null,
      rrHigh: body.rrHigh ?? null,
      tempLow: body.tempLow ?? null,
      tempHigh: body.tempHigh ?? null,
      uopLow: body.uopLow ?? null,
      uopHigh: body.uopHigh ?? null,
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      completedAt: body.completedAt ? new Date(body.completedAt) : null,
      dischargedAt: body.dischargedAt ? new Date(body.dischargedAt) : null,
      status: body.status ?? 'OPEN',
    };

    const actorUsername = req.user?.username ?? null;
    const actorId = typeof req.user?.id === 'number' ? req.user.id : null;

    const row = id
      ? await prisma.dayCareSession.update({
          where: { id },
          data: { ...baseData, updatedBy: actorUsername, updatedById: actorId },
        })
      : await prisma.dayCareSession.create({
          data: { ...baseData, createdBy: actorUsername, createdById: actorId },
        });

    await auditLog(req, {
      module: 'day-care',
      action: id ? 'UPDATE' : 'CREATE',
      entityType: 'DayCareSession',
      entityId: row.id,
      payload: { procedureType: row.procedureType, patientName: row.patientName },
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[day-care] upsertSession failed:', error);
    res.status(500).json({
      error: 'Failed to save session',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Readings ───────────────────────────────────────────────────────

interface CreateReadingBody {
  recordedAt?: string;
  spo2?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  hr?: number | null;
  rr?: number | null;
  tempF?: number | null;
  uopMl?: number | null;
  ivPatency?: string | null;
  consciousnessLevel?: number | null;
  remarks?: string | null;
}

/** Server-side threshold check — compares each non-null reading against the
 *  session's thresholds and returns the list of breached metric names. The
 *  UI uses this to highlight rows and prompt to call the duty doctor. */
function computeAlerts(
  reading: CreateReadingBody,
  session: { spo2Low: number | null; spo2High: number | null;
             bpSystolicLow: number | null; bpSystolicHigh: number | null;
             bpDiastolicLow: number | null; bpDiastolicHigh: number | null;
             hrLow: number | null; hrHigh: number | null;
             rrLow: number | null; rrHigh: number | null;
             tempLow: number | null; tempHigh: number | null;
             uopLow: number | null; uopHigh: number | null },
): string[] {
  const breached: string[] = [];
  const check = (
    val: number | null | undefined,
    low: number | null,
    high: number | null,
    name: string,
  ): void => {
    if (val == null) return;
    if (low != null && val < low) breached.push(`${name}<${low}`);
    if (high != null && val > high) breached.push(`${name}>${high}`);
  };
  check(reading.spo2, session.spo2Low, session.spo2High, 'SpO2');
  check(reading.bpSystolic, session.bpSystolicLow, session.bpSystolicHigh, 'BPsys');
  check(reading.bpDiastolic, session.bpDiastolicLow, session.bpDiastolicHigh, 'BPdia');
  check(reading.hr, session.hrLow, session.hrHigh, 'HR');
  check(reading.rr, session.rrLow, session.rrHigh, 'RR');
  check(reading.tempF, session.tempLow, session.tempHigh, 'Temp');
  check(reading.uopMl, session.uopLow, session.uopHigh, 'UOP');
  return breached;
}

export const addReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.id;
    const body = req.body as CreateReadingBody;

    const session = await prisma.dayCareSession.findUnique({ where: { id: sessionId } });
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (body.ivPatency && !VALID_IV_PATENCY.includes(body.ivPatency)) {
      res.status(400).json({ error: `ivPatency must be one of: ${VALID_IV_PATENCY.join(', ')}` });
      return;
    }
    if (body.consciousnessLevel != null && (body.consciousnessLevel < 1 || body.consciousnessLevel > 4)) {
      res.status(400).json({ error: 'consciousnessLevel must be 1..4' });
      return;
    }

    const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      res.status(400).json({ error: 'recordedAt must be a valid ISO timestamp' });
      return;
    }

    const alerts = computeAlerts(body, session);

    const row = await prisma.dayCareReading.create({
      data: {
        sessionId,
        recordedAt,
        spo2: body.spo2 ?? null,
        bpSystolic: body.bpSystolic ?? null,
        bpDiastolic: body.bpDiastolic ?? null,
        hr: body.hr ?? null,
        rr: body.rr ?? null,
        tempF: body.tempF ?? null,
        uopMl: body.uopMl ?? null,
        ivPatency: body.ivPatency ?? null,
        consciousnessLevel: body.consciousnessLevel ?? null,
        remarks: body.remarks ?? null,
        alertsTriggered: alerts.length > 0 ? JSON.stringify(alerts) : null,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    if (alerts.length > 0) {
      await auditLog(req, {
        module: 'day-care',
        action: 'THRESHOLD_BREACH',
        entityType: 'DayCareReading',
        entityId: row.id,
        payload: { sessionId, breached: alerts },
      });
    }

    res.status(201).json(row);
  } catch (error) {
    console.error('[day-care] addReading failed:', error);
    res.status(500).json({ error: 'Failed to add reading' });
  }
};

export const deleteReading = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.dayCareReading.delete({ where: { id: req.params.readingId } });
    res.status(204).send();
  } catch (error) {
    console.error('[day-care] deleteReading failed:', error);
    res.status(500).json({ error: 'Failed to delete reading' });
  }
};
