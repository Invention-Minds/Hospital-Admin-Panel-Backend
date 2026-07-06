import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 7 — Staff handover / contingency reassignment controller.
 *
 * One row per handover event with a signature chain:
 *   Originator (outgoing)   → POST /api/staff-handover                      (OPEN)
 *   Receiver  (incoming)    → POST /api/staff-handover/:id/acknowledge      (ACKNOWLEDGED)
 *                             POST /api/staff-handover/:id/decline          (DECLINED)
 *   Supervisor (ratio breach only)
 *                           → POST /api/staff-handover/:id/supervisor-sign  (stamps supervisorSignatureId)
 *   Charge nurse / supervisor closes once both signs done:
 *                             POST /api/staff-handover/:id/close            (CLOSED)
 *
 * Field names mirror StaffHandover schema columns 1:1 so frontend payloads
 * line up with no renaming (`eventType`, `shift`, `originatorSignatureId`,
 * `receiverSignatureId`, `supervisorSignatureId`, `patientsAffected`, etc.).
 */

interface PatientsAffectedItem {
  admissionId: string;
  prn?: string;
  summary?: string;
}

interface CreateHandoverBody {
  eventType: 'PLANNED_SHIFT' | 'UNPLANNED_ABSENCE' | 'RATIO_BREACH' | 'DOCTOR_UNAVAILABLE';
  shift: 'morning' | 'evening' | 'night' | 'adhoc';
  department?: string;
  wardId?: string;
  originatorName: string;
  originatorRole?: string;
  originatorSignatureId?: string;
  rationale: string;
  patientsAffected?: PatientsAffectedItem[];
  pendingTasks?: string;
}

interface AcknowledgeBody {
  receiverName: string;
  receiverRole?: string;
  receiverSignatureId: string;
}

interface DeclineBody {
  receiverName: string;
  receiverRole?: string;
  declineReason: string;
}

interface SupervisorSignBody {
  supervisorName: string;
  supervisorSignatureId: string;
}

interface CloseBody {
  // No body — pure status transition.
}

/** POST /api/staff-handover */
export const createHandover = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateHandoverBody;
    if (!['PLANNED_SHIFT', 'UNPLANNED_ABSENCE', 'RATIO_BREACH', 'DOCTOR_UNAVAILABLE'].includes(body.eventType)) {
      res.status(400).json({ error: 'eventType is invalid' });
      return;
    }
    if (!['morning', 'evening', 'night', 'adhoc'].includes(body.shift)) {
      res.status(400).json({ error: 'shift is invalid' });
      return;
    }
    if (!body.originatorName || body.originatorName.trim().length < 2) {
      res.status(400).json({ error: 'originatorName is required' });
      return;
    }
    if (!body.rationale || body.rationale.trim().length < 10) {
      res.status(400).json({ error: 'rationale (min 10 chars) is required' });
      return;
    }

    const created = await prisma.staffHandover.create({
      data: {
        eventType: body.eventType,
        shift: body.shift,
        department: body.department ?? null,
        wardId: body.wardId ?? null,
        status: 'OPEN',
        originatorName: body.originatorName.trim(),
        originatorRole: body.originatorRole ?? null,
        originatorBy: req.user?.username ?? null,
        originatorById: typeof req.user?.id === 'number' ? req.user.id : null,
        originatorSignatureId: body.originatorSignatureId ?? null,
        rationale: body.rationale.trim(),
        patientsAffected: body.patientsAffected ? JSON.stringify(body.patientsAffected) : null,
        pendingTasks: body.pendingTasks?.trim() || null,
      },
    });

    await auditLog(req, {
      module: 'staff-handover',
      action: 'CREATE',
      entityType: 'StaffHandover',
      entityId: created.id,
      payload: { eventType: body.eventType, shift: body.shift, wardId: body.wardId ?? null },
      notes: body.rationale.trim().slice(0, 200),
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('[staff-handover] createHandover failed:', error);
    res.status(500).json({ error: 'Failed to create handover' });
  }
};

/** POST /api/staff-handover/:id/acknowledge */
export const acknowledgeHandover = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AcknowledgeBody;
    if (!body.receiverName || body.receiverName.trim().length < 2) {
      res.status(400).json({ error: 'receiverName is required' });
      return;
    }
    if (!body.receiverSignatureId) {
      res.status(400).json({ error: 'receiverSignatureId is required' });
      return;
    }
    const row = await prisma.staffHandover.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Handover not found' });
      return;
    }
    if (row.status !== 'OPEN') {
      res.status(400).json({ error: `Cannot acknowledge in status=${row.status}` });
      return;
    }

    const updated = await prisma.staffHandover.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        receiverName: body.receiverName.trim(),
        receiverRole: body.receiverRole ?? null,
        receiverBy: req.user?.username ?? null,
        receiverById: typeof req.user?.id === 'number' ? req.user.id : null,
        receiverSignatureId: body.receiverSignatureId,
      },
    });

    await auditLog(req, {
      module: 'staff-handover',
      action: 'STATUS_CHANGE',
      entityType: 'StaffHandover',
      entityId: updated.id,
      payload: { from: 'OPEN', to: 'ACKNOWLEDGED' },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[staff-handover] acknowledgeHandover failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge handover' });
  }
};

/** POST /api/staff-handover/:id/decline */
export const declineHandover = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as DeclineBody;
    if (!body.declineReason || body.declineReason.trim().length < 5) {
      res.status(400).json({ error: 'declineReason (min 5 chars) is required' });
      return;
    }
    const row = await prisma.staffHandover.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Handover not found' });
      return;
    }
    if (row.status !== 'OPEN') {
      res.status(400).json({ error: `Cannot decline in status=${row.status}` });
      return;
    }

    const updated = await prisma.staffHandover.update({
      where: { id },
      data: {
        status: 'DECLINED',
        receiverName: body.receiverName?.trim() ?? null,
        receiverRole: body.receiverRole ?? null,
        receiverBy: req.user?.username ?? null,
        receiverById: typeof req.user?.id === 'number' ? req.user.id : null,
        declineReason: body.declineReason.trim(),
      },
    });

    await auditLog(req, {
      module: 'staff-handover',
      action: 'STATUS_CHANGE',
      entityType: 'StaffHandover',
      entityId: updated.id,
      payload: { from: 'OPEN', to: 'DECLINED' },
      notes: body.declineReason.trim().slice(0, 200),
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[staff-handover] declineHandover failed:', error);
    res.status(500).json({ error: 'Failed to decline handover' });
  }
};

/**
 * POST /api/staff-handover/:id/supervisor-sign — for RATIO_BREACH escalation.
 * Stamps supervisorSignatureId; doesn't change overall status (close still required).
 */
export const supervisorSign = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as SupervisorSignBody;
    if (!body.supervisorName || !body.supervisorSignatureId) {
      res.status(400).json({ error: 'supervisorName and supervisorSignatureId are required' });
      return;
    }
    const row = await prisma.staffHandover.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Handover not found' });
      return;
    }
    if (row.eventType !== 'RATIO_BREACH') {
      res.status(400).json({ error: 'Supervisor sign only applies to RATIO_BREACH events' });
      return;
    }
    if (row.status === 'CLOSED' || row.status === 'DECLINED') {
      res.status(400).json({ error: `Cannot supervisor-sign in status=${row.status}` });
      return;
    }

    const updated = await prisma.staffHandover.update({
      where: { id },
      data: {
        supervisorName: body.supervisorName.trim(),
        supervisorBy: req.user?.username ?? null,
        supervisorById: typeof req.user?.id === 'number' ? req.user.id : null,
        supervisorSignatureId: body.supervisorSignatureId,
      },
    });

    await auditLog(req, {
      module: 'staff-handover',
      action: 'UPDATE',
      entityType: 'StaffHandover',
      entityId: updated.id,
      payload: { supervisorSigned: true },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[staff-handover] supervisorSign failed:', error);
    res.status(500).json({ error: 'Failed to record supervisor signature' });
  }
};

/** POST /api/staff-handover/:id/close */
export const closeHandover = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const _body = req.body as CloseBody;

    const row = await prisma.staffHandover.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Handover not found' });
      return;
    }
    if (row.status !== 'ACKNOWLEDGED') {
      res.status(400).json({ error: `Cannot close in status=${row.status}` });
      return;
    }
    // For RATIO_BREACH, supervisor signature is required before close.
    if (row.eventType === 'RATIO_BREACH' && !row.supervisorSignatureId) {
      res.status(400).json({
        error: 'Supervisor signature is required before closing a RATIO_BREACH handover',
      });
      return;
    }

    const updated = await prisma.staffHandover.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: req.user?.username ?? null,
      },
    });

    await auditLog(req, {
      module: 'staff-handover',
      action: 'STATUS_CHANGE',
      entityType: 'StaffHandover',
      entityId: updated.id,
      payload: { from: 'ACKNOWLEDGED', to: 'CLOSED' },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[staff-handover] closeHandover failed:', error);
    res.status(500).json({ error: 'Failed to close handover' });
  }
};

/** GET /api/staff-handover?status=&eventType=&wardId= */
export const listHandovers = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const wardId = req.query.wardId as string | undefined;
    const rows = await prisma.staffHandover.findMany({
      where: {
        ...(status && { status }),
        ...(eventType && { eventType }),
        ...(wardId && { wardId }),
      },
      orderBy: [{ raisedAt: 'desc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[staff-handover] listHandovers failed:', error);
    res.status(500).json({ error: 'Failed to list handovers' });
  }
};

/** GET /api/staff-handover/:id */
export const getHandover = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.staffHandover.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Handover not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[staff-handover] getHandover failed:', error);
    res.status(500).json({ error: 'Failed to fetch handover' });
  }
};
