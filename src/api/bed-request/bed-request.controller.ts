import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 3 — IPD bed request controller (WF-2 admission handshake).
 *
 * Three-party flow:
 *   PRE / billing → POST /api/bed-request                     (status REQUESTED)
 *   NS nurse     → POST /api/bed-request/:id/accept           (status ACCEPTED)
 *                  POST /api/bed-request/:id/hold             (status HELD)
 *                  POST /api/bed-request/:id/reject           (status REJECTED)
 *   PRE bedside  → POST /api/bed-request/:id/attender-accept  (status ATTENDER_ACCEPTED → CLOSED)
 *
 * On final attender-accept the linked IpdAdmission flips to status='admitted'
 * and the bed flips to status='occupied'. NS sign + attender sign FKs propagate
 * back to the IpdAdmission row for the audit pack.
 */

interface CreateRequestBody {
  admissionId: string;
  wardId?: string;
  preferredBedType?: string;
  urgency?: 'routine' | 'urgent' | 'emergency';
}

interface AcceptBody {
  nsAcceptanceSignatureId: string; // captured via <app-e-sign> by nurse-in-charge
  // Phase 3 (WF-2) — NS must pick the actual bed at accept time, otherwise the
  // admission row never gets `wardId/bedId` set and the patient stays "no bed".
  wardId: string;
  bedId: string;
}

interface HoldBody {
  holdReason: string;
}

interface RejectBody {
  rejectReason: string;
}

interface AttenderAcceptBody {
  attenderName: string;
  attenderRelation: string;
  attenderFacilitySignatureId: string; // captured at the bedside
  consentSignatureIds?: string[]; // ConsentSignature ids from the consent bundle
}

/** POST /api/bed-request — PRE / billing creates a new bed-request. */
export const createBedRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateRequestBody;
    if (!body.admissionId) {
      res.status(400).json({ error: 'admissionId is required' });
      return;
    }
    const admission = await prisma.ipdAdmission.findUnique({ where: { id: body.admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }
    if (admission.status === 'admitted' || admission.status === 'discharged') {
      res
        .status(400)
        .json({ error: `Admission is already in status=${admission.status}; cannot raise a new bed request` });
      return;
    }

    const created = await prisma.ipdBedRequest.create({
      data: {
        admissionId: admission.id,
        wardId: body.wardId ?? admission.wardId,
        preferredBedType: body.preferredBedType ?? admission.roomType,
        urgency: body.urgency ?? 'routine',
        status: 'REQUESTED',
        requestedBy: req.user?.username ?? null,
        requestedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await prisma.ipdAdmission.update({
      where: { id: admission.id },
      data: { status: 'BED_REQUESTED', updatedBy: req.user?.username ?? null },
    });

    await auditLog(req, {
      module: 'bed-request',
      action: 'CREATE',
      entityType: 'IpdBedRequest',
      entityId: created.id,
      payload: { admissionId: admission.id, wardId: created.wardId, urgency: created.urgency },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('[bed-request] createBedRequest failed:', error);
    res.status(500).json({ error: 'Failed to create bed request' });
  }
};

/** POST /api/bed-request/:id/accept — NS nurse accepts. */
export const acceptBedRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AcceptBody;
    if (!body.nsAcceptanceSignatureId) {
      res.status(400).json({ error: 'nsAcceptanceSignatureId is required' });
      return;
    }
    if (!body.wardId || !body.bedId) {
      res.status(400).json({ error: 'wardId and bedId are required — pick the actual bed when accepting' });
      return;
    }
    const reqRow = await prisma.ipdBedRequest.findUnique({ where: { id } });
    if (!reqRow) {
      res.status(404).json({ error: 'Bed request not found' });
      return;
    }
    if (reqRow.status !== 'REQUESTED' && reqRow.status !== 'HELD') {
      res.status(400).json({ error: `Cannot accept bed request in status=${reqRow.status}` });
      return;
    }

    // Validate the bed is available before reserving.
    const bed = await prisma.ipdBed.findUnique({ where: { id: body.bedId } });
    if (!bed) {
      res.status(404).json({ error: 'Bed not found' });
      return;
    }
    if (bed.status === 'occupied') {
      res.status(409).json({ error: 'Bed is already occupied — pick another' });
      return;
    }
    if (bed.wardId !== body.wardId) {
      res.status(400).json({ error: 'bedId does not belong to wardId' });
      return;
    }

    // Atomic: stamp the bed-request, the admission (with wardId+bedId), and
    // flip the bed to `reserved` so a parallel attempt can't grab it. The bed
    // becomes `occupied` only at attender bedside-acceptance time.
    const updated = await prisma.$transaction(async (tx) => {
      const updatedReq = await tx.ipdBedRequest.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptedBy: req.user?.username ?? null,
          acceptedById: typeof req.user?.id === 'number' ? req.user.id : null,
          nsAcceptanceSignatureId: body.nsAcceptanceSignatureId,
          wardId: body.wardId,
        },
      });

      await tx.ipdAdmission.update({
        where: { id: reqRow.admissionId },
        data: {
          status: 'BED_ACCEPTED',
          wardId: body.wardId,
          bedId: body.bedId,
          nsAcceptanceSignatureId: body.nsAcceptanceSignatureId,
          updatedBy: req.user?.username ?? null,
        },
      });

      await tx.ipdBed.update({
        where: { id: body.bedId },
        data: { status: 'reserved' },
      });

      return updatedReq;
    });

    await auditLog(req, {
      module: 'bed-request',
      action: 'STATUS_CHANGE',
      entityType: 'IpdBedRequest',
      entityId: updated.id,
      payload: { from: reqRow.status, to: 'ACCEPTED', admissionId: reqRow.admissionId },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[bed-request] acceptBedRequest failed:', error);
    res.status(500).json({ error: 'Failed to accept bed request' });
  }
};

/** POST /api/bed-request/:id/hold — NS holds (awaiting cleaning, equipment, etc.). */
export const holdBedRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as HoldBody;
    if (!body.holdReason || body.holdReason.trim().length < 5) {
      res.status(400).json({ error: 'holdReason (min 5 chars) is required' });
      return;
    }
    const reqRow = await prisma.ipdBedRequest.findUnique({ where: { id } });
    if (!reqRow) {
      res.status(404).json({ error: 'Bed request not found' });
      return;
    }
    if (reqRow.status !== 'REQUESTED') {
      res.status(400).json({ error: `Cannot hold bed request in status=${reqRow.status}` });
      return;
    }
    const updated = await prisma.ipdBedRequest.update({
      where: { id },
      data: { status: 'HELD', holdReason: body.holdReason.trim() },
    });
    await auditLog(req, {
      module: 'bed-request',
      action: 'STATUS_CHANGE',
      entityType: 'IpdBedRequest',
      entityId: updated.id,
      payload: { from: 'REQUESTED', to: 'HELD' },
      notes: body.holdReason.trim(),
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[bed-request] holdBedRequest failed:', error);
    res.status(500).json({ error: 'Failed to hold bed request' });
  }
};

/** POST /api/bed-request/:id/reject — NS rejects (no bed, wrong ward, etc.). */
export const rejectBedRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as RejectBody;
    if (!body.rejectReason || body.rejectReason.trim().length < 5) {
      res.status(400).json({ error: 'rejectReason (min 5 chars) is required' });
      return;
    }
    const reqRow = await prisma.ipdBedRequest.findUnique({ where: { id } });
    if (!reqRow) {
      res.status(404).json({ error: 'Bed request not found' });
      return;
    }
    if (reqRow.status === 'CLOSED' || reqRow.status === 'REJECTED') {
      res.status(400).json({ error: `Cannot reject in status=${reqRow.status}` });
      return;
    }
    const updated = await prisma.ipdBedRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: body.rejectReason.trim() },
    });
    // Roll the admission back to PROPOSED so PRE can re-request elsewhere.
    await prisma.ipdAdmission.update({
      where: { id: reqRow.admissionId },
      data: { status: 'PROPOSED' },
    });
    await auditLog(req, {
      module: 'bed-request',
      action: 'STATUS_CHANGE',
      entityType: 'IpdBedRequest',
      entityId: updated.id,
      payload: { from: reqRow.status, to: 'REJECTED' },
      notes: body.rejectReason.trim(),
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[bed-request] rejectBedRequest failed:', error);
    res.status(500).json({ error: 'Failed to reject bed request' });
  }
};

/**
 * POST /api/bed-request/:id/attender-accept — bedside step.
 * Closes the handshake and flips the admission to 'admitted'.
 */
export const attenderAccept = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as AttenderAcceptBody;
    if (!body.attenderName || !body.attenderRelation || !body.attenderFacilitySignatureId) {
      res.status(400).json({
        error: 'attenderName, attenderRelation, attenderFacilitySignatureId are all required',
      });
      return;
    }
    const reqRow = await prisma.ipdBedRequest.findUnique({ where: { id } });
    if (!reqRow) {
      res.status(404).json({ error: 'Bed request not found' });
      return;
    }
    if (reqRow.status !== 'ACCEPTED') {
      res.status(400).json({ error: `Cannot record attender acceptance in status=${reqRow.status}` });
      return;
    }

    const now = new Date();

    const updated = await prisma.ipdBedRequest.update({
      where: { id },
      data: {
        status: 'CLOSED',
        attenderAcceptedAt: now,
        attenderName: body.attenderName.trim(),
        attenderRelation: body.attenderRelation.trim(),
        attenderFacilitySignatureId: body.attenderFacilitySignatureId,
      },
    });

    // Promote the admission to 'admitted' and stamp the signatures + consent ids.
    const consentJson = body.consentSignatureIds && body.consentSignatureIds.length > 0
      ? JSON.stringify(body.consentSignatureIds)
      : undefined;

    await prisma.ipdAdmission.update({
      where: { id: reqRow.admissionId },
      data: {
        status: 'admitted',
        attenderFacilityAcceptanceSignatureId: body.attenderFacilitySignatureId,
        ...(consentJson && { consentSignatureIds: consentJson }),
        updatedBy: req.user?.username ?? null,
      },
    });

    // Mark the bed occupied. Best-effort — if the bed model isn't there for any
    // reason, we don't want the handshake to fail.
    try {
      const admission = await prisma.ipdAdmission.findUnique({ where: { id: reqRow.admissionId } });
      if (admission?.bedId) {
        await prisma.ipdBed.update({
          where: { id: admission.bedId },
          data: { status: 'occupied' },
        });
      }
    } catch (bedErr) {
      console.error('[bed-request] bed status update failed (non-blocking):', bedErr);
    }

    await auditLog(req, {
      module: 'bed-request',
      action: 'STATUS_CHANGE',
      entityType: 'IpdBedRequest',
      entityId: updated.id,
      payload: {
        from: 'ACCEPTED',
        to: 'CLOSED',
        admissionId: reqRow.admissionId,
        consentCount: body.consentSignatureIds?.length ?? 0,
      },
      notes: `Bedside facility-acceptance signed by ${body.attenderName} (${body.attenderRelation})`,
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[bed-request] attenderAccept failed:', error);
    res.status(500).json({ error: 'Failed to record attender acceptance' });
  }
};

/** GET /api/bed-request?status=&wardId= — NS dashboard queue. */
export const listBedRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const wardId = req.query.wardId as string | undefined;
    const rows = await prisma.ipdBedRequest.findMany({
      where: {
        ...(status && { status }),
        ...(wardId && { wardId }),
      },
      orderBy: [{ urgency: 'desc' }, { requestedAt: 'asc' }],
      include: { admission: true },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[bed-request] listBedRequests failed:', error);
    res.status(500).json({ error: 'Failed to list bed requests' });
  }
};

/** GET /api/bed-request/:id — full detail for the bedside / detail screen. */
export const getBedRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.ipdBedRequest.findUnique({
      where: { id: req.params.id },
      include: { admission: true },
    });
    if (!row) {
      res.status(404).json({ error: 'Bed request not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[bed-request] getBedRequest failed:', error);
    res.status(500).json({ error: 'Failed to fetch bed request' });
  }
};
