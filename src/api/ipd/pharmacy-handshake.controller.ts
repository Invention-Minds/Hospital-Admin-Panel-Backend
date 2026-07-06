import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { resolveTargetRole } from '../../service/role-alias';

// Phase P — Pharmacy coordinator + nurse handshake.
//
// Pharmacy lifecycle:
//   sentToPharmacyAt → pharmacyAckAt → dispensedAt → nurseCollectedAt
// Rejection / return reset the chain to the prior actor with a typed reason.

type NotifyKind =
  | 'pharmacy_ack' | 'pharmacy_rejected_to_doctor' | 'pharmacy_dispensed'
  | 'nurse_rx_ready' | 'nurse_returned_to_pharmacy';

async function notifyRx(opts: {
  kind: NotifyKind;
  rxId: string;
  title: string;
  message: string;
  targetRole?: string | null;
  isCritical?: boolean;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: opts.kind,
        title: opts.title,
        message: opts.message,
        status: 'unread',
        targetRole: opts.targetRole ?? undefined,
        isCritical: !!opts.isCritical,
        entityId: 0,
        entityType: `IpdPrescription:${opts.rxId}`,
      },
    });
  } catch (err) {
    console.warn('[pharmacy:notify] failed:', (err as Error).message);
  }
}

/** GET /pharmacy/queue
 * Lists prescriptions awaiting pharmacy action: not yet acked, or acked but
 * not yet fully dispensed. STAT items pinned to the top. */
export const pharmacyQueue = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.ipdPrescription.findMany({
      where: {
        sentToPharmacyAt: { not: null },
        status: 'active',
        pharmacyRejectedAt: null,
        // Either not yet acked, or acked but not fully dispensed.
        // Nurse-returned scripts also re-appear because we null out dispensedAt
        // in nurseReturn (which is correct — pharmacy must re-dispense).
        dispensedAt: null,
      },
      include: {
        admission: {
          select: {
            id: true, admissionNo: true, prn: true, admittingDoctor: true,
            ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
          },
        },
      },
      orderBy: [{ isStatBypass: 'desc' }, { sentToPharmacyAt: 'asc' }],
      take: 300,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[pharmacy] queue failed:', error);
    res.status(500).json({ error: 'Failed to load pharmacy queue' });
  }
};

/** POST /pharmacy/:rxId/ack — pharmacy coordinator claims the script. */
export const pharmacyAck = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rxId } = req.params;
    const rx = await prisma.ipdPrescription.findUnique({ where: { id: rxId } });
    if (!rx) { res.status(404).json({ error: 'Prescription not found' }); return; }
    if (rx.pharmacyAckAt) { res.status(409).json({ error: 'Already acknowledged' }); return; }
    if (rx.pharmacyRejectedAt) { res.status(409).json({ error: 'Script was rejected; doctor must re-prescribe' }); return; }

    const updated = await prisma.ipdPrescription.update({
      where: { id: rxId },
      data: {
        pharmacyAckAt: new Date(),
        pharmacyAckBy: req.user?.username ?? null,
        pharmacyAckById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'pharmacy-handshake', action: 'ACK', entityType: 'IpdPrescription',
      entityId: rxId, payload: { genericName: rx.genericName },
    });
    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[pharmacy] ack failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge prescription' });
  }
};

interface RejectBody { reason: string }

/** POST /pharmacy/:rxId/reject — bounce back to doctor (out of stock /
 * dose unsafe / generic unavailable). Reason required. */
export const pharmacyReject = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rxId } = req.params;
    const body = req.body as RejectBody;
    if (!body.reason || body.reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required' }); return;
    }
    const rx = await prisma.ipdPrescription.findUnique({
      where: { id: rxId },
      include: { admission: { select: { admittingDoctor: true, admissionNo: true } } },
    });
    if (!rx) { res.status(404).json({ error: 'Prescription not found' }); return; }
    if (rx.dispensedAt) { res.status(409).json({ error: 'Already dispensed; cannot reject' }); return; }

    const updated = await prisma.ipdPrescription.update({
      where: { id: rxId },
      data: {
        pharmacyRejectedAt: new Date(),
        pharmacyRejectedBy: req.user?.username ?? null,
        pharmacyRejectedById: typeof req.user?.id === 'number' ? req.user.id : null,
        pharmacyRejectedReason: body.reason.trim(),
        status: 'paused',
      },
    });
    await auditLog(req, {
      module: 'pharmacy-handshake', action: 'REJECT', entityType: 'IpdPrescription',
      entityId: rxId, payload: { reason: body.reason, genericName: rx.genericName },
    });

    // Notify the prescribing doctor.
    const docRole = await resolveTargetRole(rx.admission.admittingDoctor ?? 'doctor');
    void notifyRx({
      kind: 'pharmacy_rejected_to_doctor', rxId,
      title: `Rx rejected · ${rx.genericName}`,
      message: `Pharmacy bounced ${rx.genericName} for admission ${rx.admission.admissionNo}: ${body.reason.trim()}`,
      targetRole: docRole, isCritical: true,
    });

    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[pharmacy] reject failed:', error);
    res.status(500).json({ error: 'Failed to reject prescription' });
  }
};

interface DispenseBody {
  dispensedQty?: number;
  substitutedBrand?: string;
  substitutedReason?: string;
}

/** POST /pharmacy/:rxId/dispense
 * Records dispense. Supports partial: pass dispensedQty < rx.quantity; the
 * row stays open with the partial total. Once total >= quantity the script
 * is marked fully dispensed and the nurse inbox lights up. */
export const pharmacyDispense = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rxId } = req.params;
    const body = req.body as DispenseBody;
    const rx = await prisma.ipdPrescription.findUnique({
      where: { id: rxId },
      include: { admission: { select: { admissionNo: true, ward: { select: { wardName: true } } } } },
    });
    if (!rx) { res.status(404).json({ error: 'Prescription not found' }); return; }
    if (rx.pharmacyRejectedAt) { res.status(409).json({ error: 'Script was rejected' }); return; }
    if (!rx.pharmacyAckAt && !rx.isStatBypass) {
      res.status(409).json({ error: 'Acknowledge the script before dispensing' }); return;
    }

    const requested = Number(body.dispensedQty);
    const newTotal = Number.isFinite(requested) && requested > 0
      ? (rx.dispensedQty ?? 0) + requested
      : rx.quantity;
    if (newTotal > rx.quantity) {
      res.status(400).json({ error: `Cannot dispense ${newTotal} — exceeds prescribed quantity ${rx.quantity}` });
      return;
    }
    const fullyDispensed = newTotal >= rx.quantity;

    const updated = await prisma.ipdPrescription.update({
      where: { id: rxId },
      data: {
        dispensedQty: newTotal,
        dispensedAt: fullyDispensed ? new Date() : rx.dispensedAt,
        dispensedBy: req.user?.username ?? null,
        dispensedById: typeof req.user?.id === 'number' ? req.user.id : null,
        substitutedBrand: body.substitutedBrand?.trim() || rx.substitutedBrand,
        substitutedReason: body.substitutedReason?.trim() || rx.substitutedReason,
      },
    });
    await auditLog(req, {
      module: 'pharmacy-handshake', action: fullyDispensed ? 'DISPENSED_FULL' : 'DISPENSED_PARTIAL',
      entityType: 'IpdPrescription', entityId: rxId,
      payload: { genericName: rx.genericName, dispensedQty: newTotal, of: rx.quantity, substitutedBrand: body.substitutedBrand },
    });

    // Notify the nurse-in-charge for THIS bed's ward.
    const nurseRole = await resolveTargetRole(`nurse_ward_${(rx.admission.ward?.wardName ?? '').toLowerCase().replace(/\s+/g, '_')}`);
    void notifyRx({
      kind: 'nurse_rx_ready', rxId,
      title: `Medication ready · ${rx.genericName}`,
      message: `Pharmacy dispensed ${newTotal}/${rx.quantity}${body.substitutedBrand ? ` (substituted: ${body.substitutedBrand})` : ''} for ${rx.admission.admissionNo}.`,
      targetRole: nurseRole,
    });

    res.status(200).json({ data: updated, fullyDispensed });
  } catch (error) {
    console.error('[pharmacy] dispense failed:', error);
    res.status(500).json({ error: 'Failed to record dispense' });
  }
};

// ─── Nurse-side ──────────────────────────────────────────────────────────

/** GET /nurse/medication-inbox
 * Lists scripts dispensed by pharmacy and not yet collected by the ward.
 * Optionally filter by wardId (handover use case). */
export const nurseInbox = async (req: Request, res: Response): Promise<void> => {
  try {
    const wardId = req.query.wardId as string | undefined;
    const rows = await prisma.ipdPrescription.findMany({
      where: {
        dispensedAt: { not: null },
        nurseCollectedAt: null,
        nurseReturnedAt: null,
        status: 'active',
        ...(wardId ? { admission: { wardId } } : {}),
      },
      include: {
        admission: {
          select: {
            id: true, admissionNo: true, prn: true, admittingDoctor: true,
            ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
          },
        },
      },
      orderBy: [{ isStatBypass: 'desc' }, { dispensedAt: 'asc' }],
      take: 300,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[nurse] inbox failed:', error);
    res.status(500).json({ error: 'Failed to load nurse inbox' });
  }
};

interface CollectBody { collectedQty?: number }

/** POST /nurse/:rxId/collect — nurse confirms receipt. Per-item partial
 * allowed; only when collectedQty >= dispensedQty does the row leave the
 * inbox and become available to MAR for administration. */
export const nurseCollect = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rxId } = req.params;
    const body = req.body as CollectBody;
    const rx = await prisma.ipdPrescription.findUnique({ where: { id: rxId } });
    if (!rx) { res.status(404).json({ error: 'Prescription not found' }); return; }
    if (!rx.dispensedAt) { res.status(409).json({ error: 'Not yet dispensed by pharmacy' }); return; }
    if (rx.nurseCollectedAt) { res.status(409).json({ error: 'Already collected' }); return; }

    const requested = Number(body.collectedQty);
    const newTotal = Number.isFinite(requested) && requested > 0
      ? (rx.nurseCollectedQty ?? 0) + requested
      : (rx.dispensedQty ?? rx.quantity);
    const dispensed = rx.dispensedQty ?? rx.quantity;
    if (newTotal > dispensed) {
      res.status(400).json({ error: `Cannot collect ${newTotal} — pharmacy only dispensed ${dispensed}` });
      return;
    }
    const fullyCollected = newTotal >= dispensed;

    const updated = await prisma.ipdPrescription.update({
      where: { id: rxId },
      data: {
        nurseCollectedQty: newTotal,
        nurseCollectedAt: fullyCollected ? new Date() : rx.nurseCollectedAt,
        nurseCollectedBy: req.user?.username ?? null,
        nurseCollectedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'pharmacy-handshake', action: fullyCollected ? 'COLLECTED_FULL' : 'COLLECTED_PARTIAL',
      entityType: 'IpdPrescription', entityId: rxId,
      payload: { genericName: rx.genericName, collectedQty: newTotal, of: dispensed },
    });

    res.status(200).json({ data: updated, fullyCollected });
  } catch (error) {
    console.error('[nurse] collect failed:', error);
    res.status(500).json({ error: 'Failed to record collection' });
  }
};

interface ReturnBody { reason: string }

/** POST /nurse/:rxId/return — nurse pushes back to pharmacy with a typed
 * reason (wrong patient, wrong dose, expired stock). Resets the dispense
 * markers so pharmacy queue picks it back up. */
export const nurseReturn = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rxId } = req.params;
    const body = req.body as ReturnBody;
    if (!body.reason || body.reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required' }); return;
    }
    const rx = await prisma.ipdPrescription.findUnique({
      where: { id: rxId },
      include: { admission: { select: { admissionNo: true } } },
    });
    if (!rx) { res.status(404).json({ error: 'Prescription not found' }); return; }
    if (!rx.dispensedAt) { res.status(409).json({ error: 'Not yet dispensed' }); return; }

    const updated = await prisma.ipdPrescription.update({
      where: { id: rxId },
      data: {
        nurseReturnedAt: new Date(),
        nurseReturnedBy: req.user?.username ?? null,
        nurseReturnedById: typeof req.user?.id === 'number' ? req.user.id : null,
        nurseReturnReason: body.reason.trim(),
        // Reset dispense markers so pharmacy queue picks it back up.
        dispensedAt: null,
        dispensedQty: null,
      },
    });
    await auditLog(req, {
      module: 'pharmacy-handshake', action: 'NURSE_RETURN', entityType: 'IpdPrescription',
      entityId: rxId, payload: { reason: body.reason, genericName: rx.genericName },
    });

    const pharmacyRole = await resolveTargetRole('pharmacy_coordinator');
    void notifyRx({
      kind: 'nurse_returned_to_pharmacy', rxId,
      title: `Rx returned · ${rx.genericName}`,
      message: `Nurse returned ${rx.genericName} for ${rx.admission.admissionNo}: ${body.reason.trim()}`,
      targetRole: pharmacyRole, isCritical: true,
    });

    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[nurse] return failed:', error);
    res.status(500).json({ error: 'Failed to return prescription' });
  }
};
