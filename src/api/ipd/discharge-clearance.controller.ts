import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { resolveTargetRole } from '../../service/role-alias';
import {
  DISCHARGE_DEPARTMENTS,
  DischargeDepartment,
  evaluateDischargeGate,
  finalizeDischargeIfReady,
  abandonDischargeChain,
} from '../../service/discharge-clearance';

// Phase D — Discharge clearance HTTP layer.
//
// Routes are mounted under /api/ipd/admission/:admissionId/discharge/...
// and /api/discharge/... for the per-department queues.

type NotifyKind = 'discharge_clearance_cleared' | 'discharge_clearance_rejected' | 'discharge_finalized' | 'discharge_chain_abandoned';

async function notifyDischarge(opts: {
  kind: NotifyKind;
  admissionId: string;
  department?: string;
  message: string;
  targetRole?: string | null;
  userId?: number | null;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: opts.kind,
        title: `Discharge · ${opts.department ?? 'Admission'}`,
        message: opts.message,
        status: 'unread',
        userId: opts.userId ?? undefined,
        targetRole: opts.targetRole ?? undefined,
        entityId: 0,
        entityType: `IpdAdmission:${opts.admissionId}`,
      },
    });
  } catch (err) {
    console.warn('[discharge:notify] failed:', (err as Error).message);
  }
}

function isDept(s: string): s is DischargeDepartment {
  return (DISCHARGE_DEPARTMENTS as readonly string[]).includes(s);
}

/** GET /admission/:admissionId/discharge/clearances —
 * Returns every clearance row + the gate evaluation. UI uses this on the
 * discharge board and to toggle the Front Desk "Discharge" button. */
export const listClearances = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const gate = await evaluateDischargeGate(admissionId);
    const rows = await prisma.dischargeClearance.findMany({
      where: { admissionId },
      orderBy: { department: 'asc' },
    });
    res.status(200).json({ data: { gate, rows } });
  } catch (error) {
    console.error('[discharge-clearance] list failed:', error);
    res.status(500).json({ error: 'Failed to load clearances' });
  }
};

interface ClearBody {
  notes?: string;
  signatureId?: string;
}

/** POST /admission/:admissionId/discharge/clearances/:dept/clear */
export const clearDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const dept = req.params.dept?.toUpperCase();
    if (!dept || !isDept(dept)) {
      res.status(400).json({ error: `dept must be one of: ${DISCHARGE_DEPARTMENTS.join(', ')}` });
      return;
    }
    const body = req.body as ClearBody;

    const row = await prisma.dischargeClearance.findUnique({
      where: { admissionId_department: { admissionId, department: dept } },
    });
    if (!row) { res.status(404).json({ error: 'Clearance row not found' }); return; }
    if (row.status === 'cleared') { res.status(409).json({ error: 'Already cleared' }); return; }

    const updated = await prisma.dischargeClearance.update({
      where: { id: row.id },
      data: {
        status: 'cleared',
        clearedAt: new Date(),
        clearedBy: req.user?.username ?? null,
        clearedById: typeof req.user?.id === 'number' ? req.user.id : null,
        clearedNotes: body.notes?.trim() || null,
        clearedSignatureId: body.signatureId || null,
        blockingReason: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectedById: null,
      },
    });

    await auditLog(req, {
      module: 'discharge-clearance', action: 'CLEAR', entityType: 'DischargeClearance',
      entityId: updated.id, payload: { admissionId, department: dept },
    });

    // If all gates now pass, ping Front Desk so they can finalize.
    const gate = await evaluateDischargeGate(admissionId);
    if (gate.eligible) {
      const fd = await resolveTargetRole('front_desk');
      void notifyDischarge({
        kind: 'discharge_finalized', admissionId, targetRole: fd,
        message: 'All clearances complete — patient ready for discharge.',
      });
    }

    res.status(200).json({ data: updated, gate });
  } catch (error) {
    console.error('[discharge-clearance] clear failed:', error);
    res.status(500).json({ error: 'Failed to clear department' });
  }
};

interface RejectBody { reason: string }

/** POST /admission/:admissionId/discharge/clearances/:dept/reject */
export const rejectDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const dept = req.params.dept?.toUpperCase();
    if (!dept || !isDept(dept)) {
      res.status(400).json({ error: `dept must be one of: ${DISCHARGE_DEPARTMENTS.join(', ')}` });
      return;
    }
    const body = req.body as RejectBody;
    if (!body.reason || body.reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required' }); return;
    }
    const row = await prisma.dischargeClearance.findUnique({
      where: { admissionId_department: { admissionId, department: dept } },
    });
    if (!row) { res.status(404).json({ error: 'Clearance row not found' }); return; }

    const updated = await prisma.dischargeClearance.update({
      where: { id: row.id },
      data: {
        status: 'rejected',
        blockingReason: body.reason.trim(),
        rejectedAt: new Date(),
        rejectedBy: req.user?.username ?? null,
        rejectedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await auditLog(req, {
      module: 'discharge-clearance', action: 'REJECT', entityType: 'DischargeClearance',
      entityId: updated.id, payload: { admissionId, department: dept, reason: body.reason },
    });

    // Notify the discharging doctor that something is blocking.
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: { admittingDoctor: true },
    });
    void notifyDischarge({
      kind: 'discharge_clearance_rejected', admissionId, department: dept,
      message: `${dept} blocked discharge: ${body.reason.trim()}`,
      targetRole: admission?.admittingDoctor ?? 'doctor',
    });

    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[discharge-clearance] reject failed:', error);
    res.status(500).json({ error: 'Failed to reject clearance' });
  }
};

/** GET /discharge/queue/:dept — pending rows for a department.
 * Each clearance coordinator's screen polls this to see their inbox. */
export const departmentQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    const dept = req.params.dept?.toUpperCase();
    if (!dept || !isDept(dept)) {
      res.status(400).json({ error: `dept must be one of: ${DISCHARGE_DEPARTMENTS.join(', ')}` });
      return;
    }
    const rows = await prisma.dischargeClearance.findMany({
      where: { department: dept, status: { in: ['pending', 'rejected'] } },
      include: {
        admission: {
          select: {
            id: true, admissionNo: true, prn: true, admittingDoctor: true,
            department: true, ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
            dischargeReadyAt: true,
            discharge: { select: { summaryStatus: true, clinicianSignedAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[discharge-clearance] queue failed:', error);
    res.status(500).json({ error: 'Failed to load queue' });
  }
};

/** POST /admission/:admissionId/discharge/finalize —
 * Front Desk button. Re-runs every gate transactionally; on pass, flips
 * admission.status='discharged' and frees the bed. Returns blockers if the
 * gate fails so the UI can list them. */
export const finalize = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const result = await finalizeDischargeIfReady({
      admissionId,
      actorUsername: req.user?.username ?? null,
    });

    if (!result.finalized) {
      res.status(409).json({ error: 'Discharge gate not met', blockers: result.blockers, clearances: result.clearances });
      return;
    }

    await auditLog(req, {
      module: 'discharge-clearance', action: 'FINALIZE', entityType: 'IpdAdmission',
      entityId: admissionId, payload: { actor: req.user?.username },
    });

    // Notify ward + doctor that the patient has physically left.
    void notifyDischarge({
      kind: 'discharge_finalized', admissionId,
      message: 'Patient discharged — bed freed.',
      targetRole: await resolveTargetRole('nursing'),
    });

    res.status(200).json({ data: { admissionId, status: 'discharged' } });
  } catch (error) {
    console.error('[discharge-clearance] finalize failed:', error);
    res.status(500).json({ error: 'Failed to finalize discharge' });
  }
};

interface ReadyBody { ready?: boolean }

/** POST /admission/:admissionId/discharge/ready —
 * Doctor toggles "ready for discharge". Triggers MT queue + diet/billing
 * pre-notify so they can start their pre-discharge work in parallel to the
 * summary drafting. Idempotent. */
export const setReadyForDischarge = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const body = req.body as ReadyBody;
    const ready = body.ready !== false; // default true

    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: { id: true, status: true, dischargeReadyAt: true, admissionNo: true, prn: true },
    });
    if (!admission) { res.status(404).json({ error: 'Admission not found' }); return; }
    if (admission.status === 'discharged') {
      res.status(409).json({ error: 'Admission already discharged' }); return;
    }

    const updated = await prisma.ipdAdmission.update({
      where: { id: admissionId },
      data: {
        dischargeReadyAt: ready ? (admission.dischargeReadyAt ?? new Date()) : null,
        dischargeReadyBy: ready ? (req.user?.username ?? null) : null,
        dischargeReadyById: ready ? (typeof req.user?.id === 'number' ? req.user.id : null) : null,
        updatedBy: req.user?.username ?? undefined,
      },
    });

    await auditLog(req, {
      module: 'discharge-clearance', action: ready ? 'READY_SET' : 'READY_CLEAR',
      entityType: 'IpdAdmission', entityId: admissionId, payload: { admissionNo: admission.admissionNo },
    });

    if (ready && !admission.dischargeReadyAt) {
      // First-time set — fan out pre-notify to MT + diet + billing.
      const mtRole = await resolveTargetRole('medical_transcriptionist');
      const dietRole = await resolveTargetRole('discharge_diet');
      const billingRole = await resolveTargetRole('discharge_billing');
      void notifyDischarge({
        kind: 'discharge_clearance_cleared', admissionId, department: 'MT_QUEUE',
        message: `Patient ${admission.admissionNo} ready for discharge — draft the summary.`,
        targetRole: mtRole,
      });
      void notifyDischarge({
        kind: 'discharge_clearance_cleared', admissionId, department: 'DIET',
        message: `Patient ${admission.admissionNo} being discharged — stop trays.`,
        targetRole: dietRole,
      });
      void notifyDischarge({
        kind: 'discharge_clearance_cleared', admissionId, department: 'BILLING',
        message: `Patient ${admission.admissionNo} being discharged — start final bill.`,
        targetRole: billingRole,
      });
    }

    res.status(200).json({ data: { admissionId, dischargeReadyAt: updated.dischargeReadyAt } });
  } catch (error) {
    console.error('[discharge-clearance] setReady failed:', error);
    res.status(500).json({ error: 'Failed to set ready-for-discharge' });
  }
};

/** POST /admission/:admissionId/discharge/mt-ack —
 * Medical transcriptionist acknowledges they're working on this case. Lets
 * the nag cron know the case is claimed even before the summary draft lands. */
export const recordMtAck = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const existing = await prisma.ipdDischarge.findUnique({ where: { admissionId } });
    if (!existing) { res.status(404).json({ error: 'Discharge row not found — create it first' }); return; }
    if (existing.mtAcknowledgedAt) { res.status(409).json({ error: 'Already acknowledged' }); return; }

    const updated = await prisma.ipdDischarge.update({
      where: { admissionId },
      data: {
        mtAcknowledgedAt: new Date(),
        mtAcknowledgedBy: req.user?.username ?? null,
        mtAcknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'discharge-clearance', action: 'MT_ACK', entityType: 'IpdDischarge',
      entityId: updated.id, payload: { admissionId },
    });
    res.status(200).json({ data: { admissionId, mtAcknowledgedAt: updated.mtAcknowledgedAt } });
  } catch (error) {
    console.error('[discharge-clearance] mtAck failed:', error);
    res.status(500).json({ error: 'Failed to record MT acknowledgement' });
  }
};

/** GET /discharge/mt-queue — Medical transcriptionist's queue.
 * Lists admissions where dischargeReadyAt is set, the discharge summary is
 * still NONE/DRAFTED/EDITED (not yet SIGNED), and MT hasn't acked. */
export const mtQueue = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.ipdAdmission.findMany({
      where: {
        dischargeReadyAt: { not: null },
        status: { notIn: ['discharged', 'LAMA', 'DAMA', 'expired'] },
        dischargeChainAbandoned: false,
        OR: [
          { discharge: null },
          { discharge: { summaryStatus: { notIn: ['SIGNED', 'DELIVERED'] } } },
        ],
      },
      select: {
        id: true, admissionNo: true, prn: true, admittingDoctor: true, department: true,
        ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
        dischargeReadyAt: true,
        discharge: { select: { summaryStatus: true, mtAcknowledgedAt: true, clinicianSignedAt: true } },
      },
      orderBy: { dischargeReadyAt: 'asc' },
      take: 100,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[discharge-clearance] mtQueue failed:', error);
    res.status(500).json({ error: 'Failed to load MT queue' });
  }
};

interface AbandonBody { reason: string }

/** POST /admission/:admissionId/discharge/abandon —
 * LAMA / DAMA bypass. Marks the chain abandoned and cancels pending rows so
 * the finalize gate no longer waits on them. Existing LAMA/DAMA controllers
 * should also call abandonDischargeChain() directly. */
export const abandonChain = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const body = req.body as AbandonBody;
    if (!body.reason || body.reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required' }); return;
    }

    await abandonDischargeChain({
      admissionId,
      reason: body.reason.trim(),
      actorUsername: req.user?.username ?? null,
      actorId: typeof req.user?.id === 'number' ? req.user.id : null,
    });

    await auditLog(req, {
      module: 'discharge-clearance', action: 'ABANDON', entityType: 'IpdAdmission',
      entityId: admissionId, payload: { reason: body.reason },
    });

    void notifyDischarge({
      kind: 'discharge_chain_abandoned', admissionId,
      message: `Discharge chain abandoned: ${body.reason.trim()}`,
      targetRole: await resolveTargetRole('admin'),
    });

    res.status(200).json({ data: { admissionId, abandoned: true } });
  } catch (error) {
    console.error('[discharge-clearance] abandon failed:', error);
    res.status(500).json({ error: 'Failed to abandon discharge chain' });
  }
};
