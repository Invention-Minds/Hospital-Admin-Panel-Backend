import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { assertClearanceForConfirm, recordEmergencyBypass } from './ot-clearance.controller';

/**
 * Phase 11 — OT scheduling controller.
 *
 * Endpoints:
 *   POST   /api/ot/rooms                          — create OT room (admin)
 *   GET    /api/ot/rooms                          — list OT rooms
 *   PUT    /api/ot/rooms/:id/status               — flip room status (in-use|cleaning|maintenance|available)
 *
 *   POST   /api/ot/schedules                      — book a slot
 *   GET    /api/ot/schedules?date=&status=&otRoomId=  — list slots (board view)
 *   GET    /api/ot/schedules/:id                  — full slot detail (with all children)
 *   PUT    /api/ot/schedules/:id                  — edit booking
 *   POST   /api/ot/schedules/:id/cancel           — cancel with reason
 *   POST   /api/ot/schedules/:id/reschedule       — clone to a new slot
 *   POST   /api/ot/schedules/:id/start            — flip to IN_PROGRESS, stamp actualStart
 *   POST   /api/ot/schedules/:id/end              — flip to CLOSED, stamp actualEnd
 *
 * Field names mirror the schema columns 1:1.
 */

interface CreateRoomBody {
  name: string;
  code: string;
  type: 'major' | 'minor' | 'cath-lab' | 'endoscopy';
  equipmentClass?: string;
  hepaFiltered?: boolean;
}

interface UpdateRoomStatusBody {
  status: 'available' | 'in-use' | 'cleaning' | 'maintenance';
}

interface CreateScheduleBody {
  otRoomId: string;
  estimationId?: string;
  admissionId?: string;
  prn?: string;
  patientName?: string;
  date: string; // ISO date
  plannedStart: string; // ISO datetime
  plannedEnd: string;
  surgeonId?: number;
  surgeonName?: string;
  anaesthesiologistId?: number;
  anaesthesiologistName?: string;
  scrubNurseId?: number;
  scrubNurseName?: string;
  runnerId?: number;
  runnerName?: string;
  procedureName: string;
  procedureCode?: string;
  urgency?: 'elective' | 'urgent' | 'emergency';
  // Phase 9.1a — Surgery Track Sheet (UHJ/OTS/F-04) timestamps + requisition link
  otAdmissionAt?: string;
  otDischargeAt?: string;
  inductionAt?: string;
  extubationAt?: string;
  requisitionId?: string;
}

interface CancelScheduleBody {
  cancelReason: string;
}

interface RescheduleBody {
  date: string;
  plannedStart: string;
  plannedEnd: string;
  cancelReason: string;
}

// ─── OT Room CRUD ───────────────────────────────────────────────────

export const createOtRoom = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateRoomBody;
    if (!body.name || !body.code || !body.type) {
      res.status(400).json({ error: 'name, code, type are required' });
      return;
    }
    if (!['major', 'minor', 'cath-lab', 'endoscopy'].includes(body.type)) {
      res.status(400).json({ error: 'type must be one of: major, minor, cath-lab, endoscopy' });
      return;
    }
    const created = await prisma.otRoom.create({
      data: {
        name: body.name.trim(),
        code: body.code.trim().toUpperCase(),
        type: body.type,
        equipmentClass: body.equipmentClass?.trim() || null,
        hepaFiltered: body.hepaFiltered ?? false,
        status: 'available',
      },
    });
    await auditLog(req, {
      module: 'ot-room',
      action: 'CREATE',
      entityType: 'OtRoom',
      entityId: created.id,
      payload: { code: created.code, type: created.type },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[ot-schedule] createOtRoom failed:', error);
    res.status(500).json({ error: 'Failed to create OT room' });
  }
};

export const listOtRooms = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const rows = await prisma.otRoom.findMany({
      where: { ...(status && { status }) },
      orderBy: [{ code: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[ot-schedule] listOtRooms failed:', error);
    res.status(500).json({ error: 'Failed to list OT rooms' });
  }
};

export const updateOtRoomStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as UpdateRoomStatusBody;
    if (!['available', 'in-use', 'cleaning', 'maintenance'].includes(body.status)) {
      res.status(400).json({ error: 'status must be one of: available, in-use, cleaning, maintenance' });
      return;
    }
    const room = await prisma.otRoom.findUnique({ where: { id } });
    if (!room) {
      res.status(404).json({ error: 'OT room not found' });
      return;
    }
    const updated = await prisma.otRoom.update({
      where: { id },
      data: { status: body.status },
    });
    await auditLog(req, {
      module: 'ot-room',
      action: 'STATUS_CHANGE',
      entityType: 'OtRoom',
      entityId: id,
      payload: { from: room.status, to: body.status },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-schedule] updateOtRoomStatus failed:', error);
    res.status(500).json({ error: 'Failed to update OT room status' });
  }
};

// Full OT room update — name / type / equipmentClass / hepaFiltered. Used by
// the unified Masters admin page. Status is handled by `updateOtRoomStatus`
// above so the active-OT lifecycle stays untouched by an admin rename.
export const updateOtRoom = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as CreateRoomBody;
    if (!body.name?.trim() || !body.type) {
      res.status(400).json({ error: 'name and type are required' });
      return;
    }
    if (!['major', 'minor', 'cath-lab', 'endoscopy'].includes(body.type)) {
      res.status(400).json({ error: 'type must be one of: major, minor, cath-lab, endoscopy' });
      return;
    }
    const existing = await prisma.otRoom.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'OT room not found' });
      return;
    }
    const updated = await prisma.otRoom.update({
      where: { id },
      data: {
        name: body.name.trim(),
        type: body.type,
        equipmentClass: body.equipmentClass?.trim() || null,
        hepaFiltered: body.hepaFiltered ?? false,
      },
    });
    await auditLog(req, {
      module: 'ot-room',
      action: 'UPDATE',
      entityType: 'OtRoom',
      entityId: id,
      payload: { code: updated.code, type: updated.type },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-schedule] updateOtRoom failed:', error);
    res.status(500).json({ error: 'Failed to update OT room' });
  }
};

// ─── OT Schedule CRUD + lifecycle ───────────────────────────────────

export const createSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateScheduleBody;
    if (!body.otRoomId || !body.date || !body.plannedStart || !body.plannedEnd || !body.procedureName) {
      res.status(400).json({ error: 'otRoomId, date, plannedStart, plannedEnd, procedureName are required' });
      return;
    }

    // Room availability — refuse booking into a room that is not available
    // (e.g. cleaning / maintenance / in-use).
    const room = await prisma.otRoom.findUnique({ where: { id: body.otRoomId } });
    if (!room) {
      res.status(404).json({ error: 'OT room not found' });
      return;
    }
    if (room.status !== 'available') {
      res.status(409).json({ error: `OT room is currently ${room.status}` });
      return;
    }

    // Conflict check — refuse if the requested slot overlaps with another
    // non-CANCELLED booking in the same OT room.
    const plannedStart = new Date(body.plannedStart);
    const plannedEnd = new Date(body.plannedEnd);
    if (Number.isNaN(plannedStart.getTime()) || Number.isNaN(plannedEnd.getTime())) {
      res.status(400).json({ error: 'plannedStart / plannedEnd must be valid ISO datetimes' });
      return;
    }
    if (plannedEnd <= plannedStart) {
      res.status(400).json({ error: 'plannedEnd must be after plannedStart' });
      return;
    }

    const overlapping = await prisma.otSchedule.findFirst({
      where: {
        otRoomId: body.otRoomId,
        status: { in: ['BOOKED', 'CONFIRMED', 'IN_PROGRESS'] },
        AND: [
          { plannedStart: { lt: plannedEnd } },
          { plannedEnd: { gt: plannedStart } },
        ],
      },
    });
    if (overlapping) {
      res.status(409).json({
        error: 'Slot overlaps with an existing booking in this OT room',
        conflictId: overlapping.id,
      });
      return;
    }

    // When this booking is scheduled from a requisition, inherit its linked
    // context (estimation / PRN / patient) so downstream actions like
    // "Order Surgeries" and emergency surcharges can resolve the estimation.
    // Callers scheduling a requisition typically send only requisitionId.
    let estimationId = body.estimationId ?? null;
    let prn = body.prn ?? null;
    let patientName = body.patientName ?? null;
    if (body.requisitionId) {
      const reqRow = await prisma.otRequisition.findUnique({
        where: { id: body.requisitionId },
        select: { estimationId: true, prn: true, patientName: true },
      });
      if (reqRow) {
        estimationId = estimationId ?? reqRow.estimationId ?? null;
        prn = prn ?? reqRow.prn ?? null;
        patientName = patientName ?? reqRow.patientName ?? null;
      }
    }

    const created = await prisma.otSchedule.create({
      data: {
        otRoomId: body.otRoomId,
        estimationId,
        admissionId: body.admissionId ?? null,
        prn,
        patientName,
        date: new Date(body.date),
        plannedStart,
        plannedEnd,
        surgeonId: body.surgeonId ?? null,
        surgeonName: body.surgeonName ?? null,
        anaesthesiologistId: body.anaesthesiologistId ?? null,
        anaesthesiologistName: body.anaesthesiologistName ?? null,
        scrubNurseId: body.scrubNurseId ?? null,
        scrubNurseName: body.scrubNurseName ?? null,
        runnerId: body.runnerId ?? null,
        runnerName: body.runnerName ?? null,
        procedureName: body.procedureName,
        procedureCode: body.procedureCode ?? null,
        urgency: body.urgency || 'elective',
        // Phase 9.1a — Surgery Track Sheet timestamps + requisition link
        otAdmissionAt: body.otAdmissionAt ? new Date(body.otAdmissionAt) : null,
        otDischargeAt: body.otDischargeAt ? new Date(body.otDischargeAt) : null,
        inductionAt: body.inductionAt ? new Date(body.inductionAt) : null,
        extubationAt: body.extubationAt ? new Date(body.extubationAt) : null,
        requisitionId: body.requisitionId ?? null,
        status: 'BOOKED',
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    // Phase 9.1a — when this booking came from a requisition queue row,
    // flip that requisition's status so the OT board doesn't show it
    // as still pending. Failure here is non-fatal (audit log captures
    // the schedule create either way).
    if (body.requisitionId) {
      try {
        await prisma.otRequisition.update({
          where: { id: body.requisitionId },
          data: { status: 'scheduled' },
        });
      } catch (linkError) {
        console.error('[ot-schedule] failed to mark requisition scheduled:', linkError);
      }
    }

    await auditLog(req, {
      module: 'ot-schedule',
      action: 'CREATE',
      entityType: 'OtSchedule',
      entityId: created.id,
      payload: {
        otRoomId: created.otRoomId,
        plannedStart: created.plannedStart,
        procedureName: created.procedureName,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('[ot-schedule] createSchedule failed:', error);
    res.status(500).json({ error: 'Failed to create OT schedule' });
  }
};

export const listSchedules = async (req: Request, res: Response): Promise<void> => {
  try {
    const date = req.query.date as string | undefined;
    const status = req.query.status as string | undefined;
    const otRoomId = req.query.otRoomId as string | undefined;
    const prn = req.query.prn as string | undefined;
    const excludeId = req.query.excludeId as string | undefined;

    const where: Record<string, unknown> = {};
    if (otRoomId) where['otRoomId'] = otRoomId;
    if (status) where['status'] = status;
    if (prn) where['prn'] = prn;
    if (excludeId) where['id'] = { not: excludeId };
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      where['date'] = { gte: start, lte: end };
    }

    const rows = await prisma.otSchedule.findMany({
      where,
      orderBy: [{ plannedStart: 'asc' }],
      include: { otRoom: true },
      take: 500,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[ot-schedule] listSchedules failed:', error);
    res.status(500).json({ error: 'Failed to list OT schedules' });
  }
};

export const getSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.otSchedule.findUnique({
      where: { id: req.params.id },
      include: {
        otRoom: true,
        preOpChecklist: true,
        safetyChecklist: true,
        // Phase 9.1c — relation went 1:1 → 1:N. Sorted by noteNumber so
        // legacy single-note readers can use `intraOpNotes[0]`.
        intraOpNotes: { orderBy: { noteNumber: 'asc' } },
        pacuRecord: { include: { vitals: { orderBy: { timestamp: 'asc' } } } },
        outcome: true,
        anaesthesiaChart: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!row) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[ot-schedule] getSchedule failed:', error);
    res.status(500).json({ error: 'Failed to fetch OT schedule' });
  }
};

export const updateSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const row = await prisma.otSchedule.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    if (row.status === 'CLOSED' || row.status === 'CANCELLED') {
      res.status(409).json({ error: `Cannot edit a ${row.status} schedule` });
      return;
    }

    const body = req.body as Partial<CreateScheduleBody>;
    const data: Record<string, unknown> = {};
    if (body.plannedStart) data['plannedStart'] = new Date(body.plannedStart);
    if (body.plannedEnd) data['plannedEnd'] = new Date(body.plannedEnd);
    if (body.surgeonName !== undefined) data['surgeonName'] = body.surgeonName;
    if (body.anaesthesiologistName !== undefined) data['anaesthesiologistName'] = body.anaesthesiologistName;
    if (body.scrubNurseName !== undefined) data['scrubNurseName'] = body.scrubNurseName;
    if (body.runnerName !== undefined) data['runnerName'] = body.runnerName;
    if (body.procedureName) data['procedureName'] = body.procedureName;
    if (body.procedureCode !== undefined) data['procedureCode'] = body.procedureCode;
    if (body.urgency) data['urgency'] = body.urgency;
    // Phase 9.1a — Surgery Track Sheet timestamps. Pass empty string to clear.
    if (body.otAdmissionAt !== undefined) data['otAdmissionAt'] = body.otAdmissionAt ? new Date(body.otAdmissionAt) : null;
    if (body.otDischargeAt !== undefined) data['otDischargeAt'] = body.otDischargeAt ? new Date(body.otDischargeAt) : null;
    if (body.inductionAt !== undefined) data['inductionAt'] = body.inductionAt ? new Date(body.inductionAt) : null;
    if (body.extubationAt !== undefined) data['extubationAt'] = body.extubationAt ? new Date(body.extubationAt) : null;

    const updated = await prisma.otSchedule.update({ where: { id }, data });
    await auditLog(req, {
      module: 'ot-schedule',
      action: 'UPDATE',
      entityType: 'OtSchedule',
      entityId: id,
      payload: data,
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-schedule] updateSchedule failed:', error);
    res.status(500).json({ error: 'Failed to update OT schedule' });
  }
};

export const cancelSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as CancelScheduleBody;
    if (!body.cancelReason || body.cancelReason.trim().length < 5) {
      res.status(400).json({ error: 'cancelReason (min 5 chars) is required' });
      return;
    }
    const row = await prisma.otSchedule.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    if (row.status === 'CLOSED' || row.status === 'CANCELLED') {
      res.status(409).json({ error: `Cannot cancel a ${row.status} schedule` });
      return;
    }
    const updated = await prisma.otSchedule.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: body.cancelReason.trim() },
    });
    await auditLog(req, {
      module: 'ot-schedule',
      action: 'STATUS_CHANGE',
      entityType: 'OtSchedule',
      entityId: id,
      payload: { from: row.status, to: 'CANCELLED' },
      notes: body.cancelReason.trim().slice(0, 200),
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-schedule] cancelSchedule failed:', error);
    res.status(500).json({ error: 'Failed to cancel OT schedule' });
  }
};

export const rescheduleSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as RescheduleBody;
    if (!body.date || !body.plannedStart || !body.plannedEnd || !body.cancelReason) {
      res.status(400).json({ error: 'date, plannedStart, plannedEnd, cancelReason are required' });
      return;
    }
    const row = await prisma.otSchedule.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    if (row.status === 'CLOSED' || row.status === 'CANCELLED') {
      res.status(409).json({ error: `Cannot reschedule a ${row.status} schedule` });
      return;
    }

    const newSchedule = await prisma.$transaction(async (tx) => {
      // Mark current as RESCHEDULED.
      await tx.otSchedule.update({
        where: { id },
        data: { status: 'RESCHEDULED', cancelReason: body.cancelReason.trim() },
      });
      // Clone to a new slot.
      return tx.otSchedule.create({
        data: {
          otRoomId: row.otRoomId,
          estimationId: row.estimationId,
          admissionId: row.admissionId,
          prn: row.prn,
          patientName: row.patientName,
          date: new Date(body.date),
          plannedStart: new Date(body.plannedStart),
          plannedEnd: new Date(body.plannedEnd),
          surgeonId: row.surgeonId,
          surgeonName: row.surgeonName,
          anaesthesiologistId: row.anaesthesiologistId,
          anaesthesiologistName: row.anaesthesiologistName,
          scrubNurseId: row.scrubNurseId,
          scrubNurseName: row.scrubNurseName,
          runnerId: row.runnerId,
          runnerName: row.runnerName,
          procedureName: row.procedureName,
          procedureCode: row.procedureCode,
          urgency: row.urgency,
          status: 'BOOKED',
          rescheduledFromId: id,
          createdBy: req.user?.username ?? null,
          createdById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
      });
    });

    await auditLog(req, {
      module: 'ot-schedule',
      action: 'CREATE',
      entityType: 'OtSchedule',
      entityId: newSchedule.id,
      payload: { rescheduledFromId: id, plannedStart: newSchedule.plannedStart },
      notes: body.cancelReason.trim().slice(0, 200),
    });

    res.status(201).json(newSchedule);
  } catch (error) {
    console.error('[ot-schedule] rescheduleSchedule failed:', error);
    res.status(500).json({ error: 'Failed to reschedule OT schedule' });
  }
};

export const startSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const row = await prisma.otSchedule.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    if (row.status !== 'BOOKED' && row.status !== 'CONFIRMED') {
      res.status(409).json({ error: `Cannot start a ${row.status} schedule` });
      return;
    }

    // Phase 9.1c — OT clearance gate (UHJ/IPS/F-32). Block start until
    // billing has marked clearance='cleared'. Emergency bypass: when
    // urgency='emergency' AND req.body.bypassReason is supplied, we
    // record the bypass on the clearance row + audit log and proceed.
    const bypassReason = (req.body?.bypassReason ?? '').trim();
    const clearanceBlock = await assertClearanceForConfirm(id);
    if (clearanceBlock) {
      const isEmergency = row.urgency === 'emergency';
      if (!isEmergency || !bypassReason) {
        res.status(409).json({
          error: clearanceBlock,
          clearanceIssue: true,
          canBypass: isEmergency,
          urgency: row.urgency,
        });
        return;
      }
      await recordEmergencyBypass(id, bypassReason, {
        username: req.user?.username ?? null,
        id: typeof req.user?.id === 'number' ? req.user.id : null,
      });
      await auditLog(req, {
        module: 'ot-schedule',
        action: 'CLEARANCE_BYPASS',
        entityType: 'OtSchedule',
        entityId: id,
        payload: { reason: bypassReason, urgency: row.urgency },
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const sch = await tx.otSchedule.update({
        where: { id },
        data: { status: 'IN_PROGRESS', actualStart: new Date() },
      });
      await tx.otRoom.update({
        where: { id: row.otRoomId },
        data: { status: 'in-use' },
      });
      return sch;
    });
    await auditLog(req, {
      module: 'ot-schedule',
      action: 'STATUS_CHANGE',
      entityType: 'OtSchedule',
      entityId: id,
      payload: { from: row.status, to: 'IN_PROGRESS' },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-schedule] startSchedule failed:', error);
    res.status(500).json({ error: 'Failed to start OT schedule' });
  }
};

export const endSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const row = await prisma.otSchedule.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    if (row.status !== 'IN_PROGRESS') {
      res.status(409).json({ error: `Cannot end a ${row.status} schedule` });
      return;
    }
    const updated = await prisma.$transaction(async (tx) => {
      const sch = await tx.otSchedule.update({
        where: { id },
        data: { status: 'CLOSED', actualEnd: new Date() },
      });
      await tx.otRoom.update({
        where: { id: row.otRoomId },
        data: { status: 'cleaning' },
      });
      return sch;
    });
    await auditLog(req, {
      module: 'ot-schedule',
      action: 'STATUS_CHANGE',
      entityType: 'OtSchedule',
      entityId: id,
      payload: { from: 'IN_PROGRESS', to: 'CLOSED' },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-schedule] endSchedule failed:', error);
    res.status(500).json({ error: 'Failed to end OT schedule' });
  }
};
