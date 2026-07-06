import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Scheduling controller — shift master, roster CRUD, duty acknowledgement.
 *
 * The audit anchor here is `DutyAcknowledgement`: every signed acknowledgement
 * points at a `StaffShiftAssignment` (so we know which shift on which date)
 * and a `SignatureBlob` (so we have the pen-equivalent evidence). The
 * `whoWasOnDuty` query joins these to answer the auditor's first question
 * after any incident: "who was on the floor at <ward, time>?".
 *
 * Acknowledgement window per session decision: 30 min before shift start →
 * 60 min after shift start. Outside that window the API rejects with 422.
 */

// ─── Constants ──────────────────────────────────────────────────────

const ACK_WINDOW_PRE_MS = 30 * 60 * 1000;        // 30 minutes early ok
const ACK_WINDOW_POST_MS = 60 * 60 * 1000;       // 60 minutes late ok
const VALID_ASSIGN_STATUSES = ['SCHEDULED', 'ACKNOWLEDGED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;
type AssignStatus = (typeof VALID_ASSIGN_STATUSES)[number];

/** The JWT payload only carries id+username. For role-based bypasses we look
 *  up the actor row from the DB so we never trust a stale or forged claim. */
async function actorIsSuperAdmin(userId: number | undefined): Promise<boolean> {
  if (typeof userId !== 'number') return false;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return u?.role === 'super_admin';
}

// ─── Shift definitions ──────────────────────────────────────────────

export const listShifts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.shiftDefinition.findMany({
      orderBy: [{ sequence: 'asc' }, { startTime: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[scheduling] listShifts failed:', error);
    res.status(500).json({ error: 'Failed to list shifts' });
  }
};

interface ShiftBody {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  sequence?: number;
  isActive?: boolean;
}

export const upsertShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as ShiftBody;
    if (!body.name?.trim() || !body.code?.trim() || !body.startTime || !body.endTime) {
      res.status(400).json({ error: 'name, code, startTime and endTime are required' });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(body.startTime) || !/^\d{2}:\d{2}$/.test(body.endTime)) {
      res.status(400).json({ error: 'startTime / endTime must be HH:mm' });
      return;
    }
    const data = {
      name: body.name.trim(),
      code: body.code.trim().toUpperCase(),
      startTime: body.startTime,
      endTime: body.endTime,
      sequence: body.sequence ?? 0,
      isActive: body.isActive ?? true,
    };
    const row = id
      ? await prisma.shiftDefinition.update({ where: { id }, data })
      : await prisma.shiftDefinition.create({ data });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[scheduling] upsertShift failed:', error);
    res.status(500).json({
      error: 'Failed to save shift',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Roster (StaffShiftAssignment) ──────────────────────────────────

interface ListAssignmentsQuery {
  from?: string;        // ISO date — inclusive
  to?: string;          // ISO date — inclusive
  wardId?: string;
  userId?: string;
  shiftId?: string;
  status?: string;
}

export const listAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as ListAssignmentsQuery;
    const where: Record<string, unknown> = {};
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(`${q.from}T00:00:00`);
      if (q.to) range.lte = new Date(`${q.to}T23:59:59.999`);
      where.date = range;
    }
    if (q.wardId) where.wardId = q.wardId;
    if (q.userId) where.userId = Number.parseInt(q.userId, 10);
    if (q.shiftId) where.shiftId = q.shiftId;
    if (q.status) where.status = q.status;

    const rows = await prisma.staffShiftAssignment.findMany({
      where,
      include: {
        shift: true,
        ward: { select: { id: true, wardName: true, wardCode: true } },
        user: { select: { id: true, username: true, employeeId: true, role: true, subAdminType: true } },
        acknowledgements: {
          select: { id: true, acknowledgedAt: true, source: true, signatureId: true },
          orderBy: { acknowledgedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ date: 'asc' }, { shift: { sequence: 'asc' } }],
      take: 2000,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[scheduling] listAssignments failed:', error);
    res.status(500).json({ error: 'Failed to list assignments' });
  }
};

interface UpsertAssignmentBody {
  userId: number;
  shiftId: string;
  wardId?: string | null;
  date: string;            // YYYY-MM-DD
  status?: AssignStatus;
  notes?: string;
}

export const upsertAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as UpsertAssignmentBody;
    if (!body.userId || !body.shiftId || !body.date) {
      res.status(400).json({ error: 'userId, shiftId and date are required' });
      return;
    }
    const date = new Date(`${body.date}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    if (body.status && !VALID_ASSIGN_STATUSES.includes(body.status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_ASSIGN_STATUSES.join(', ')}` });
      return;
    }
    const data = {
      userId: body.userId,
      shiftId: body.shiftId,
      wardId: body.wardId ?? null,
      date,
      status: body.status ?? 'SCHEDULED',
      notes: body.notes ?? null,
      createdBy: id ? undefined : (req.user?.username ?? null),
      createdById: id ? undefined : (typeof req.user?.id === 'number' ? req.user.id : null),
    };
    const row = id
      ? await prisma.staffShiftAssignment.update({ where: { id }, data })
      : await prisma.staffShiftAssignment.create({ data });

    await auditLog(req, {
      module: 'scheduling',
      action: id ? 'UPDATE' : 'CREATE',
      entityType: 'StaffShiftAssignment',
      entityId: row.id,
      payload: { userId: row.userId, shiftId: row.shiftId, wardId: row.wardId, date: row.date },
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error: unknown) {
    // P2002 — unique constraint (userId, date, shiftId) — user double-booked.
    if ((error as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'This user is already rostered for that shift on that date' });
      return;
    }
    console.error('[scheduling] upsertAssignment failed:', error);
    res.status(500).json({
      error: 'Failed to save assignment',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

export const deleteAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.staffShiftAssignment.findUnique({
      where: { id },
      include: { acknowledgements: { take: 1 } },
    });
    if (!existing) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    if (existing.acknowledgements.length > 0) {
      // Acked assignments are evidence — don't hard-delete. Cancel instead.
      const updated = await prisma.staffShiftAssignment.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await auditLog(req, {
        module: 'scheduling',
        action: 'STATUS_CHANGE',
        entityType: 'StaffShiftAssignment',
        entityId: id,
        payload: { from: existing.status, to: 'CANCELLED', reason: 'delete-attempted-on-acked' },
      });
      res.status(200).json({ ...updated, message: 'Acked assignment cancelled instead of deleted (audit retention).' });
      return;
    }
    await prisma.staffShiftAssignment.delete({ where: { id } });
    await auditLog(req, {
      module: 'scheduling',
      action: 'DELETE',
      entityType: 'StaffShiftAssignment',
      entityId: id,
      payload: { userId: existing.userId, date: existing.date },
    });
    res.status(204).send();
  } catch (error) {
    console.error('[scheduling] deleteAssignment failed:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
};

// ─── Duty acknowledgement ───────────────────────────────────────────

interface AckBody {
  signatureId?: string;
  notes?: string;
  source?: 'MODAL' | 'KIOSK';
}

/**
 * Helper: parse "HH:mm" + a calendar date into a Date in the server TZ. Handles
 * wrap-around night shifts (endTime < startTime → endTime is next day).
 */
function shiftWindowForDate(
  date: Date,
  startTime: string,
  endTime: string,
): { start: Date; end: Date } {
  const [sh, sm] = startTime.split(':').map((s) => Number.parseInt(s, 10));
  const [eh, em] = endTime.split(':').map((s) => Number.parseInt(s, 10));
  const start = new Date(date);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(date);
  end.setHours(eh, em, 0, 0);
  if (end.getTime() <= start.getTime()) {
    // Wrap-around: end is on the next calendar day.
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

export const acknowledgeAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AckBody;

    const assignment = await prisma.staffShiftAssignment.findUnique({
      where: { id },
      include: { shift: true },
    });
    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }
    if (assignment.status === 'CANCELLED') {
      res.status(409).json({ error: 'Cannot acknowledge a cancelled assignment' });
      return;
    }

    // Identity check — the logged-in user must match the assignment's user.
    // Super-admins can ack on behalf (e.g. helping a nurse who's having tech
    // trouble at the kiosk); audited via the `source` and `notes` fields.
    const isSuper = await actorIsSuperAdmin(req.user?.id);
    if (req.user?.id !== assignment.userId && !isSuper) {
      res.status(403).json({ error: 'You can only acknowledge your own assignments' });
      return;
    }

    // Window check — 30 min before shift start → 60 min after.
    const { start } = shiftWindowForDate(
      assignment.date,
      assignment.shift.startTime,
      assignment.shift.endTime,
    );
    const now = new Date();
    const lower = start.getTime() - ACK_WINDOW_PRE_MS;
    const upper = start.getTime() + ACK_WINDOW_POST_MS;
    const inWindow = now.getTime() >= lower && now.getTime() <= upper;
    if (!inWindow && !isSuper) {
      res.status(422).json({
        error: 'Outside acknowledgement window',
        detail: `Acknowledgement allowed from ${new Date(lower).toISOString()} to ${new Date(upper).toISOString()}.`,
      });
      return;
    }

    const ack = await prisma.$transaction(async (tx) => {
      const created = await tx.dutyAcknowledgement.create({
        data: {
          assignmentId: id,
          userId: assignment.userId,
          signatureId: body.signatureId ?? null,
          source: body.source ?? 'MODAL',
          notes: body.notes ?? null,
        },
      });
      await tx.staffShiftAssignment.update({
        where: { id },
        data: { status: 'ACKNOWLEDGED' },
      });
      return created;
    });

    await auditLog(req, {
      module: 'scheduling',
      action: 'ACKNOWLEDGE',
      entityType: 'StaffShiftAssignment',
      entityId: id,
      payload: { ackId: ack.id, source: ack.source, userId: ack.userId, late: now.getTime() > start.getTime() },
    });

    res.status(201).json(ack);
  } catch (error) {
    console.error('[scheduling] acknowledgeAssignment failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge' });
  }
};

/**
 * GET /api/scheduling/my-pending-ack
 *
 * For the logged-in user, return the assignments in their current ack window
 * that haven't been signed yet. Drives the post-login modal.
 */
export const myPendingAck = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    // Look across yesterday/today/tomorrow to catch night-shift wrap-arounds
    // and early acks for tomorrow's morning shift.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const candidates = await prisma.staffShiftAssignment.findMany({
      where: {
        userId: req.user.id,
        date: { gte: yesterday, lte: tomorrow },
        status: 'SCHEDULED',
      },
      include: { shift: true, ward: { select: { id: true, wardName: true, wardCode: true } } },
    });

    const now = new Date();
    const pending = candidates.filter((a) => {
      const { start } = shiftWindowForDate(a.date, a.shift.startTime, a.shift.endTime);
      const lower = start.getTime() - ACK_WINDOW_PRE_MS;
      const upper = start.getTime() + ACK_WINDOW_POST_MS;
      return now.getTime() >= lower && now.getTime() <= upper;
    });

    res.status(200).json(pending);
  } catch (error) {
    console.error('[scheduling] myPendingAck failed:', error);
    res.status(500).json({ error: 'Failed to load pending acknowledgements' });
  }
};

/**
 * GET /api/scheduling/kiosk?wardId=...&date=YYYY-MM-DD
 *
 * Kiosk view — all assignments for a ward on a given date, with their ack
 * status. Used by the ward tablet sign-in page.
 */
export const kioskList = async (req: Request, res: Response): Promise<void> => {
  try {
    const wardId = req.query.wardId as string | undefined;
    const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateParam}T00:00:00`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999`);
    const where: Record<string, unknown> = { date: { gte: dayStart, lte: dayEnd } };
    if (wardId) where.wardId = wardId;

    const rows = await prisma.staffShiftAssignment.findMany({
      where,
      include: {
        shift: true,
        user: { select: { id: true, username: true, employeeId: true, role: true, subAdminType: true } },
        ward: { select: { id: true, wardName: true, wardCode: true } },
        acknowledgements: { take: 1, orderBy: { acknowledgedAt: 'desc' } },
      },
      orderBy: [{ shift: { sequence: 'asc' } }, { user: { username: 'asc' } }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[scheduling] kioskList failed:', error);
    res.status(500).json({ error: 'Failed to load kiosk list' });
  }
};

/**
 * GET /api/scheduling/who-was-on-duty?wardId=...&at=ISO
 *
 * Audit query. Returns the list of users whose acknowledged assignment
 * covered the given ward at the given timestamp. NABH-grade evidence —
 * used when reconciling an incident, MAR row, or signature against the
 * actual rostered + signed staff for that moment.
 */
export const whoWasOnDuty = async (req: Request, res: Response): Promise<void> => {
  try {
    const wardId = req.query.wardId as string | undefined;
    const atIso = req.query.at as string | undefined;
    if (!atIso) {
      res.status(400).json({ error: 'at (ISO timestamp) is required' });
      return;
    }
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) {
      res.status(400).json({ error: 'at must be a valid ISO timestamp' });
      return;
    }
    // Candidate set: assignments for the day-of and the day-before (night
    // shifts wrap into the next day's morning).
    const dayBefore = new Date(at); dayBefore.setDate(at.getDate() - 1); dayBefore.setHours(0, 0, 0, 0);
    const dayAfter = new Date(at); dayAfter.setDate(at.getDate() + 1); dayAfter.setHours(23, 59, 59, 999);

    const candidates = await prisma.staffShiftAssignment.findMany({
      where: {
        date: { gte: dayBefore, lte: dayAfter },
        status: 'ACKNOWLEDGED',
        ...(wardId ? { wardId } : {}),
      },
      include: {
        shift: true,
        user: { select: { id: true, username: true, employeeId: true, role: true, subAdminType: true } },
        ward: { select: { id: true, wardName: true, wardCode: true } },
        acknowledgements: { take: 1, orderBy: { acknowledgedAt: 'desc' } },
      },
    });

    const covering = candidates.filter((a) => {
      const { start, end } = shiftWindowForDate(a.date, a.shift.startTime, a.shift.endTime);
      return at.getTime() >= start.getTime() && at.getTime() <= end.getTime();
    });

    res.status(200).json({
      at: at.toISOString(),
      wardId: wardId ?? null,
      onDuty: covering.map((a) => ({
        userId: a.userId,
        username: a.user.username,
        employeeId: a.user.employeeId,
        role: a.user.role,
        subAdminType: a.user.subAdminType,
        shift: { code: a.shift.code, name: a.shift.name },
        ward: a.ward,
        acknowledgedAt: a.acknowledgements[0]?.acknowledgedAt ?? null,
        signatureId: a.acknowledgements[0]?.signatureId ?? null,
      })),
    });
  } catch (error) {
    console.error('[scheduling] whoWasOnDuty failed:', error);
    res.status(500).json({ error: 'Failed to run on-duty query' });
  }
};

// ─── Staff picker (for the roster UI) ───────────────────────────────

/**
 * GET /api/scheduling/staff
 *
 * Returns the list of clinical staff (Users with role doctor or sub_admin)
 * who can be rostered. Used by the roster create-assignment dialog.
 */
export const listStaff = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: 'doctor' },
          { role: 'sub_admin' },
        ],
      },
      select: { id: true, username: true, employeeId: true, role: true, subAdminType: true },
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      take: 1000,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[scheduling] listStaff failed:', error);
    res.status(500).json({ error: 'Failed to list staff' });
  }
};
