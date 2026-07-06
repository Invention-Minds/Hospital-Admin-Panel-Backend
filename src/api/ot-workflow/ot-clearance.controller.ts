import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.1c — OT Clearance (UHJ/IPS/F-32).
//
// One row per OtSchedule. Billing fills payment mode + remarks and then
// marks status='cleared'. Schedule cannot transition BOOKED → CONFIRMED
// until clearance is 'cleared' — see confirmSchedule() in
// ot-schedule.controller.ts. Bypass allowed when urgency='emergency'
// AND a bypassReason is supplied; the override is audit-logged.

const VALID_PAYMENT_MODES = ['cash', 'insurance', 'corporate', 'other'];

interface UpsertClearanceBody {
  paymentMode?: string | null;
  billingNotes?: string | null;
  remarks?: string | null;
}

export const getClearance = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const row = await prisma.otClearance.findUnique({ where: { scheduleId } });
    // Return 200 + null when no row — the editor uses null to render a
    // first-time form. (Same pattern as initial-assessment.controller.)
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-clearance] get failed:', error);
    res.status(500).json({ message: 'Failed to load clearance' });
  }
};

export const upsertClearance = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const schedule = await prisma.otSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) { res.status(404).json({ message: 'OT schedule not found' }); return; }

    const body = req.body as UpsertClearanceBody;
    if (body.paymentMode && !VALID_PAYMENT_MODES.includes(body.paymentMode)) {
      res.status(400).json({ message: `paymentMode must be one of: ${VALID_PAYMENT_MODES.join(', ')}` });
      return;
    }

    const row = await prisma.otClearance.upsert({
      where: { scheduleId },
      update: {
        ...(body.paymentMode !== undefined && { paymentMode: body.paymentMode }),
        ...(body.billingNotes !== undefined && { billingNotes: body.billingNotes }),
        ...(body.remarks !== undefined && { remarks: body.remarks }),
      },
      create: {
        scheduleId,
        paymentMode: body.paymentMode ?? null,
        billingNotes: body.billingNotes ?? null,
        remarks: body.remarks ?? null,
        clearanceStatus: 'pending',
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-clearance] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save clearance' });
  }
};

interface ClearBody {
  signatureId?: string;
  clearedBy?: string;
}

export const clearForOt = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const body = req.body as ClearBody;
    const existing = await prisma.otClearance.findUnique({ where: { scheduleId } });
    if (!existing) {
      res.status(404).json({ message: 'Clearance row not found — fill the form first' });
      return;
    }
    if (existing.clearanceStatus === 'cleared') {
      res.status(409).json({ message: 'Already cleared' });
      return;
    }

    const updated = await prisma.otClearance.update({
      where: { scheduleId },
      data: {
        clearanceStatus: 'cleared',
        clearedBy: body.clearedBy ?? req.user?.username ?? null,
        clearedById: typeof req.user?.id === 'number' ? req.user.id : null,
        clearedAt: new Date(),
        clearedSignatureId: body.signatureId ?? null,
      },
    });

    await auditLog(req, {
      module: 'ot-clearance',
      action: 'STATUS_CHANGE',
      entityType: 'OtClearance',
      entityId: updated.id,
      payload: { scheduleId, from: existing.clearanceStatus, to: 'cleared' },
    });

    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[ot-clearance] clear failed:', error);
    res.status(500).json({ message: 'Failed to clear' });
  }
};

interface RejectBody {
  reason: string;
}

export const rejectClearance = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const body = req.body as RejectBody;
    if (!body.reason?.trim()) {
      res.status(400).json({ message: 'reason is required' });
      return;
    }
    const existing = await prisma.otClearance.findUnique({ where: { scheduleId } });
    if (!existing) {
      res.status(404).json({ message: 'Clearance row not found' });
      return;
    }
    const updated = await prisma.otClearance.update({
      where: { scheduleId },
      data: {
        clearanceStatus: 'rejected',
        remarks: body.reason,
      },
    });
    await auditLog(req, {
      module: 'ot-clearance',
      action: 'STATUS_CHANGE',
      entityType: 'OtClearance',
      entityId: updated.id,
      payload: { scheduleId, from: existing.clearanceStatus, to: 'rejected', reason: body.reason },
    });
    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[ot-clearance] reject failed:', error);
    res.status(500).json({ message: 'Failed to reject' });
  }
};

// Phase 9.3d — undo a 'cleared' or 'rejected' status back to 'pending'.
// Required for cases where billing accidentally cleared the wrong row, or
// the rejection needs to be reconsidered. Audit-logged with prior status.
export const resetClearance = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const { reason } = req.body as { reason?: string };
    const existing = await prisma.otClearance.findUnique({ where: { scheduleId } });
    if (!existing) {
      res.status(404).json({ message: 'Clearance row not found' });
      return;
    }
    if (existing.clearanceStatus === 'pending') {
      res.status(409).json({ message: 'Already pending — nothing to reset' });
      return;
    }
    // Block reset once the schedule has already moved past BOOKED/CONFIRMED,
    // otherwise we leave an inconsistent state (started without clearance).
    const schedule = await prisma.otSchedule.findUnique({
      where: { id: scheduleId }, select: { status: true },
    });
    if (schedule && schedule.status !== 'BOOKED' && schedule.status !== 'CONFIRMED' && schedule.status !== 'CANCELLED') {
      res.status(409).json({
        message: `Cannot reset clearance — schedule is ${schedule.status}`,
      });
      return;
    }
    const updated = await prisma.otClearance.update({
      where: { scheduleId },
      data: {
        clearanceStatus: 'pending',
        clearedAt: null,
        clearedBy: null,
        clearedById: null,
        clearedSignatureId: null,
        bypassReason: null,
        remarks: reason ? `Reset: ${reason}` : existing.remarks,
      },
    });
    await auditLog(req, {
      module: 'ot-clearance',
      action: 'STATUS_CHANGE',
      entityType: 'OtClearance',
      entityId: updated.id,
      payload: { scheduleId, from: existing.clearanceStatus, to: 'pending', reason: reason ?? null },
    });
    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[ot-clearance] reset failed:', error);
    res.status(500).json({ message: 'Failed to reset clearance' });
  }
};

// Internal helper used by ot-schedule.controller's confirm gate.
// Returns null if cleared (allow transition); returns a reason string
// when the schedule should be blocked. Emergency bypass is handled by
// the caller, which captures the bypassReason on the OtClearance row.
export async function assertClearanceForConfirm(scheduleId: string): Promise<string | null> {
  const row = await prisma.otClearance.findUnique({ where: { scheduleId } });
  if (!row) return 'OT clearance not started — billing must complete clearance first';
  if (row.clearanceStatus !== 'cleared') {
    return `OT clearance status is '${row.clearanceStatus}' — must be 'cleared' to confirm`;
  }
  return null;
}

// Internal helper used when the emergency bypass is invoked. Creates a
// clearance row (if missing) and stamps the bypass reason — keeps the
// audit chain intact.
export async function recordEmergencyBypass(scheduleId: string, bypassReason: string, actor: { username: string | null; id: number | null }): Promise<void> {
  await prisma.otClearance.upsert({
    where: { scheduleId },
    update: {
      clearanceStatus: 'cleared',
      bypassReason,
      clearedBy: actor.username,
      clearedById: actor.id,
      clearedAt: new Date(),
      remarks: 'Emergency bypass',
    },
    create: {
      scheduleId,
      clearanceStatus: 'cleared',
      bypassReason,
      clearedBy: actor.username,
      clearedById: actor.id,
      clearedAt: new Date(),
      remarks: 'Emergency bypass',
      createdBy: actor.username,
    },
  });
}
