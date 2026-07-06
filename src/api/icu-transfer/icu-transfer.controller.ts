import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 5 (WF-4) — IPD ICU Transfer controller.
 *
 * Three-signature chain (NABH COP.5):
 *   Proposing doctor   → POST /api/icu-transfer                 (PROPOSED)
 *   Intensivist        → POST /api/icu-transfer/:id/acknowledge (ACKNOWLEDGED | DECLINED)
 *   ICU charge nurse   → POST /api/icu-transfer/:id/accept      (ACCEPTED)
 *                        POST /api/icu-transfer/:id/in-transit  (IN_TRANSIT)
 *                        POST /api/icu-transfer/:id/complete    (COMPLETED → flips admission ward+bed)
 *
 * On COMPLETED: the IpdAdmission row is updated to point at the ICU ward+bed,
 * the source bed is freed, and the destination bed is marked occupied. Audit
 * logs are written at every step. Field names mirror the schema columns
 * (`proposerSignatureId`, `intensivistSignatureId`, `receiverSignatureId`,
 * `handoverSignatureId`) so the frontend payload shapes line up 1:1.
 */

interface ProposeBody {
  admissionId: string;
  toWardId?: string;
  rationale: string;
  vitalsSnapshot?: string;
  linesAndDrains?: string;
  codeStatus?: string;
  sedationPlan?: string;
  proposerName?: string;
  proposerSignatureId: string;
}

interface AcknowledgeBody {
  outcome: 'ACKNOWLEDGED' | 'DECLINED';
  intensivistName?: string;
  intensivistSignatureId?: string;
  declineReason?: string;
}

interface AcceptBody {
  toBedId: string;
  toWardId?: string;
  receiverSignatureId: string;
}

interface InTransitBody {
  // No body — pure status transition.
}

interface CompleteBody {
  handoverSignatureId: string;
}

/** POST /api/icu-transfer — proposing doctor raises a transfer request. */
export const proposeTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as ProposeBody;
    if (!body.admissionId) {
      res.status(400).json({ error: 'admissionId is required' });
      return;
    }
    if (!body.rationale || body.rationale.trim().length < 10) {
      res.status(400).json({ error: 'rationale (min 10 chars) is required' });
      return;
    }
    if (!body.proposerSignatureId) {
      res.status(400).json({ error: 'proposerSignatureId is required' });
      return;
    }

    const admission = await prisma.ipdAdmission.findUnique({ where: { id: body.admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }
    if (admission.status !== 'admitted') {
      res
        .status(400)
        .json({ error: `Admission status=${admission.status}; ICU transfer only applies to admitted patients` });
      return;
    }

    const created = await prisma.ipdIcuTransferRequest.create({
      data: {
        admissionId: body.admissionId,
        fromWardId: admission.wardId,
        fromBedId: admission.bedId,
        toWardId: body.toWardId ?? null,
        rationale: body.rationale.trim(),
        vitalsSnapshot: body.vitalsSnapshot?.trim() || null,
        linesAndDrains: body.linesAndDrains?.trim() || null,
        codeStatus: body.codeStatus ?? null,
        sedationPlan: body.sedationPlan?.trim() || null,
        status: 'PROPOSED',
        proposedBy: req.user?.username ?? null,
        proposedById: typeof req.user?.id === 'number' ? req.user.id : null,
        proposerName: body.proposerName ?? null,
        proposerSignatureId: body.proposerSignatureId,
      },
    });

    await auditLog(req, {
      module: 'icu-transfer',
      action: 'CREATE',
      entityType: 'IpdIcuTransferRequest',
      entityId: created.id,
      payload: { admissionId: body.admissionId, toWardId: body.toWardId ?? null },
      notes: body.rationale.trim().slice(0, 200),
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('[icu-transfer] proposeTransfer failed:', error);
    res.status(500).json({ error: 'Failed to propose ICU transfer' });
  }
};

/** POST /api/icu-transfer/:id/acknowledge — intensivist acknowledges or declines. */
export const acknowledgeTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AcknowledgeBody;

    if (body.outcome !== 'ACKNOWLEDGED' && body.outcome !== 'DECLINED') {
      res.status(400).json({ error: 'outcome must be ACKNOWLEDGED or DECLINED' });
      return;
    }
    if (body.outcome === 'ACKNOWLEDGED' && !body.intensivistSignatureId) {
      res.status(400).json({ error: 'intensivistSignatureId is required when ACKNOWLEDGED' });
      return;
    }
    if (body.outcome === 'DECLINED' && (!body.declineReason || body.declineReason.trim().length < 5)) {
      res.status(400).json({ error: 'declineReason (min 5 chars) is required when DECLINED' });
      return;
    }

    const row = await prisma.ipdIcuTransferRequest.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Transfer request not found' });
      return;
    }
    if (row.status !== 'PROPOSED') {
      res.status(400).json({ error: `Cannot acknowledge in status=${row.status}` });
      return;
    }

    const updated = await prisma.ipdIcuTransferRequest.update({
      where: { id },
      data: {
        status: body.outcome,
        acknowledgedAt: new Date(),
        acknowledgedBy: req.user?.username ?? null,
        acknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
        intensivistName: body.intensivistName ?? null,
        intensivistSignatureId: body.intensivistSignatureId ?? null,
        declineReason: body.declineReason?.trim() ?? null,
      },
    });

    await auditLog(req, {
      module: 'icu-transfer',
      action: 'STATUS_CHANGE',
      entityType: 'IpdIcuTransferRequest',
      entityId: updated.id,
      payload: { from: 'PROPOSED', to: body.outcome },
      notes: body.outcome === 'DECLINED' ? body.declineReason?.trim() : undefined,
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[icu-transfer] acknowledgeTransfer failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge ICU transfer' });
  }
};

/** POST /api/icu-transfer/:id/accept — ICU charge nurse confirms a bed and accepts. */
export const acceptTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AcceptBody;
    if (!body.toBedId) {
      res.status(400).json({ error: 'toBedId is required' });
      return;
    }
    if (!body.receiverSignatureId) {
      res.status(400).json({ error: 'receiverSignatureId is required' });
      return;
    }

    const row = await prisma.ipdIcuTransferRequest.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Transfer request not found' });
      return;
    }
    if (row.status !== 'ACKNOWLEDGED') {
      res.status(400).json({ error: `Cannot accept in status=${row.status}` });
      return;
    }

    const bed = await prisma.ipdBed.findUnique({ where: { id: body.toBedId } });
    if (!bed) {
      res.status(404).json({ error: 'Target ICU bed not found' });
      return;
    }
    if (bed.status === 'occupied') {
      res.status(409).json({ error: 'Target ICU bed is already occupied' });
      return;
    }

    const updated = await prisma.ipdIcuTransferRequest.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        toBedId: body.toBedId,
        toWardId: body.toWardId ?? row.toWardId ?? bed.wardId,
        acceptedAt: new Date(),
        acceptedBy: req.user?.username ?? null,
        acceptedById: typeof req.user?.id === 'number' ? req.user.id : null,
        receiverSignatureId: body.receiverSignatureId,
      },
    });

    await auditLog(req, {
      module: 'icu-transfer',
      action: 'STATUS_CHANGE',
      entityType: 'IpdIcuTransferRequest',
      entityId: updated.id,
      payload: { from: 'ACKNOWLEDGED', to: 'ACCEPTED', toBedId: body.toBedId },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[icu-transfer] acceptTransfer failed:', error);
    res.status(500).json({ error: 'Failed to accept ICU transfer' });
  }
};

/** POST /api/icu-transfer/:id/in-transit — patient leaves the source ward. */
export const markInTransit = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const row = await prisma.ipdIcuTransferRequest.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Transfer request not found' });
      return;
    }
    if (row.status !== 'ACCEPTED') {
      res.status(400).json({ error: `Cannot mark in-transit in status=${row.status}` });
      return;
    }
    const updated = await prisma.ipdIcuTransferRequest.update({
      where: { id },
      data: { status: 'IN_TRANSIT', inTransitAt: new Date() },
    });
    await auditLog(req, {
      module: 'icu-transfer',
      action: 'STATUS_CHANGE',
      entityType: 'IpdIcuTransferRequest',
      entityId: updated.id,
      payload: { from: 'ACCEPTED', to: 'IN_TRANSIT' },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[icu-transfer] markInTransit failed:', error);
    res.status(500).json({ error: 'Failed to mark in-transit' });
  }
};

/**
 * POST /api/icu-transfer/:id/complete — ICU nurse confirms the patient is on
 * the ICU bed. Final step: flips the admission ward+bed, frees the source bed,
 * occupies the destination bed.
 */
export const completeTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as CompleteBody;
    if (!body.handoverSignatureId) {
      res.status(400).json({ error: 'handoverSignatureId is required' });
      return;
    }

    const row = await prisma.ipdIcuTransferRequest.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Transfer request not found' });
      return;
    }
    if (row.status !== 'IN_TRANSIT' && row.status !== 'ACCEPTED') {
      res.status(400).json({ error: `Cannot complete in status=${row.status}` });
      return;
    }
    if (!row.toBedId || !row.toWardId) {
      res.status(400).json({ error: 'Target bed/ward not set on this transfer' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedRow = await tx.ipdIcuTransferRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          handoverSignatureId: body.handoverSignatureId,
        },
      });

      // Move the admission to the ICU bed and stamp icuAdmittedAt so the
      // Phase 9.6 ICU workbench knows this admission is currently in ICU.
      await tx.ipdAdmission.update({
        where: { id: row.admissionId },
        data: {
          wardId: row.toWardId,
          bedId: row.toBedId,
          icuAdmittedAt: new Date(),
          // Clear any prior icuDischargedAt — this is a fresh ICU admission
          icuDischargedAt: null,
          updatedBy: req.user?.username ?? null,
        },
      });

      // Free the source bed if one was tracked. updateMany so a stale
      // fromBedId (bed deleted / repurposed since the proposal) doesn't
      // throw and abort the entire transfer-complete transaction.
      if (row.fromBedId) {
        await tx.ipdBed.updateMany({
          where: { id: row.fromBedId },
          data: { status: 'available' },
        });
      }
      // Occupy the destination bed (same defensive pattern).
      await tx.ipdBed.updateMany({
        where: { id: row.toBedId as string },
        data: { status: 'occupied' },
      });

      return updatedRow;
    });

    await auditLog(req, {
      module: 'icu-transfer',
      action: 'STATUS_CHANGE',
      entityType: 'IpdIcuTransferRequest',
      entityId: result.id,
      payload: {
        from: row.status,
        to: 'COMPLETED',
        admissionId: row.admissionId,
        toBedId: row.toBedId,
      },
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[icu-transfer] completeTransfer failed:', error);
    // Surface the underlying message so the operator can act on it (foreign-
    // key violation, target bed gone, etc.) without having to ask a dev.
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to complete ICU transfer', detail });
  }
};

/** GET /api/icu-transfer?admissionId=&status= */
export const listTransfers = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.query.admissionId as string | undefined;
    const status = req.query.status as string | undefined;
    const rows = await prisma.ipdIcuTransferRequest.findMany({
      where: {
        ...(admissionId && { admissionId }),
        ...(status && { status }),
      },
      orderBy: [{ proposedAt: 'desc' }],
      include: { admission: true },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[icu-transfer] listTransfers failed:', error);
    res.status(500).json({ error: 'Failed to list ICU transfers' });
  }
};

/** GET /api/icu-transfer/:id */
export const getTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.ipdIcuTransferRequest.findUnique({
      where: { id: req.params.id },
      include: { admission: true },
    });
    if (!row) {
      res.status(404).json({ error: 'Transfer request not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[icu-transfer] getTransfer failed:', error);
    res.status(500).json({ error: 'Failed to fetch ICU transfer' });
  }
};
