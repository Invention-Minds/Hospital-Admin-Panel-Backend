import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Medication Reconciliation (Phase 4a — NABH MOM.1.c / IPSG.3).
 *
 * At admission the admitting team reviews each home medication and the
 * pre-admission prescriptions, then records a per-row decision: CONTINUE,
 * CHANGE, HOLD, DISCONTINUE, or RECONCILE (= already aligned).
 *
 * This controller exposes two endpoints — list the reconciliation queue for
 * an admission, and set the action on a prescription row.
 */

const VALID_PRESCRIPTION_TYPES = ['STAT', 'VARIABLE', 'REGULAR'];
const VALID_ACTIONS = ['CONTINUE', 'CHANGE', 'HOLD', 'DISCONTINUE', 'RECONCILE'];

/** GET /api/ipd/admission/:admissionId/medication-reconciliation
 *
 *  Lists every prescription on the admission — both the active inpatient
 *  ones and any pre-admission rows carried over — with their reconciliation
 *  state. Used by the reconciliation panel to render the decision grid.
 */
export const listReconciliation = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const rows = await prisma.ipdPrescription.findMany({
      where: { admissionId },
      orderBy: [{ isCarryOver: 'desc' }, { createdAt: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[medication-reconciliation] list failed:', error);
    res.status(500).json({ error: 'Failed to load reconciliation list' });
  }
};

interface SetActionBody {
  prescriptionType?: 'STAT' | 'VARIABLE' | 'REGULAR' | null;
  reconciliationAction?: 'CONTINUE' | 'CHANGE' | 'HOLD' | 'DISCONTINUE' | 'RECONCILE' | null;
  reconciliationReason?: string | null;
}

/** POST /api/ipd/admission/:admissionId/medication-reconciliation/:prescriptionId
 *
 *  Sets the reconciliation action on a single prescription. Audited so the
 *  NABH MOM.1.c trail records who made each decision and when.
 */
export const setReconciliationAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId, prescriptionId } = req.params;
    const body = req.body as SetActionBody;

    if (body.prescriptionType != null && !VALID_PRESCRIPTION_TYPES.includes(body.prescriptionType)) {
      res.status(400).json({ error: `prescriptionType must be one of: ${VALID_PRESCRIPTION_TYPES.join(', ')}` });
      return;
    }
    if (body.reconciliationAction != null && !VALID_ACTIONS.includes(body.reconciliationAction)) {
      res.status(400).json({ error: `reconciliationAction must be one of: ${VALID_ACTIONS.join(', ')}` });
      return;
    }
    // HOLD / DISCONTINUE / CHANGE require a reason — that's the NABH
    // requirement so the auditor sees why the team deviated from home meds.
    if (['HOLD', 'DISCONTINUE', 'CHANGE'].includes(body.reconciliationAction ?? '')
        && !body.reconciliationReason?.trim()) {
      res.status(400).json({ error: 'reconciliationReason is required for HOLD / DISCONTINUE / CHANGE' });
      return;
    }

    const existing = await prisma.ipdPrescription.findUnique({ where: { id: prescriptionId } });
    if (!existing || existing.admissionId !== admissionId) {
      res.status(404).json({ error: 'Prescription not found for this admission' });
      return;
    }

    const data: Record<string, unknown> = {
      updatedBy: req.user?.username ?? null,
      updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
    };
    if (body.prescriptionType !== undefined) data.prescriptionType = body.prescriptionType;
    if (body.reconciliationAction !== undefined) {
      data.reconciliationAction = body.reconciliationAction;
      // Stamp who/when whenever an action transitions to a non-null value.
      if (body.reconciliationAction !== null) {
        data.reconciledAt = new Date();
        data.reconciledBy = req.user?.username ?? null;
        data.reconciledById = typeof req.user?.id === 'number' ? req.user.id : null;
      }
    }
    if (body.reconciliationReason !== undefined) data.reconciliationReason = body.reconciliationReason;

    // HOLD / DISCONTINUE actions also flip the prescription's IPD status so
    // the MAR doesn't keep showing it as due.
    if (body.reconciliationAction === 'HOLD') data.status = 'paused';
    if (body.reconciliationAction === 'DISCONTINUE') data.status = 'discontinued';
    if (body.reconciliationAction === 'CONTINUE' || body.reconciliationAction === 'RECONCILE') {
      if (existing.status !== 'active') data.status = 'active';
    }

    const updated = await prisma.ipdPrescription.update({
      where: { id: prescriptionId },
      data,
    });
    await auditLog(req, {
      module: 'ipd',
      action: 'RECONCILE_MEDICATION',
      entityType: 'IpdPrescription',
      entityId: prescriptionId,
      payload: {
        admissionId,
        action: body.reconciliationAction,
        prescriptionType: body.prescriptionType,
        reason: body.reconciliationReason,
      },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[medication-reconciliation] setAction failed:', error);
    res.status(500).json({ error: 'Failed to set reconciliation action' });
  }
};
