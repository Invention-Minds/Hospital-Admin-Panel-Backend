import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Form 5 (Phase 8) — UHJ/EMR/F-01 sub-entity CRUD.
//
// Four parallel resources hanging off /api/emergency/:id:
//   - investigations  (blood / imaging / ECG order-sent-report chain)
//   - treatments      (drug intervention rows)
//   - procedures      (IV access / RT / Foley's etc.)
//   - specimens       (material preserved chain of custody for MLC)
//
// Each resource exposes list / create / update / delete. We keep the
// shape minimal — the printed form is the source of truth, the API
// just stores the columns. No status-machine, no audit trail beyond
// createdBy / updatedAt — auditLog is wired into Emergency itself.

const parseEmergencyId = (req: Request, res: Response): number | null => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'Invalid emergency id' });
    return null;
  }
  return id;
};

// ─── EmergencyInvestigation ─────────────────────────────────────────────

const VALID_INVESTIGATION_CATEGORIES = ['blood', 'imaging', 'ecg', 'other'];

export const listInvestigations = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const rows = await prisma.emergencyInvestigation.findMany({
      where: { emergencyId },
      orderBy: { orderedAt: 'desc' },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[emergency-investigation] list failed:', error);
    res.status(500).json({ message: 'Failed to list investigations' });
  }
};

export const createInvestigation = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const { category, name, orderedBy, sentAt, sentBy, reportedAt, reportedBy, resultNotes } = req.body;
    if (!category || !name) {
      res.status(400).json({ message: 'category and name are required' });
      return;
    }
    if (!VALID_INVESTIGATION_CATEGORIES.includes(category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_INVESTIGATION_CATEGORIES.join(', ')}` });
      return;
    }
    const row = await prisma.emergencyInvestigation.create({
      data: {
        emergencyId,
        category,
        name,
        orderedBy: orderedBy ?? req.user?.username ?? null,
        sentAt: sentAt ? new Date(sentAt) : null,
        sentBy: sentBy ?? null,
        reportedAt: reportedAt ? new Date(reportedAt) : null,
        reportedBy: reportedBy ?? null,
        resultNotes: resultNotes ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[emergency-investigation] create failed:', error);
    res.status(500).json({ message: 'Failed to create investigation' });
  }
};

export const updateInvestigation = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    const { sentAt, sentBy, reportedAt, reportedBy, resultNotes } = req.body;
    const row = await prisma.emergencyInvestigation.update({
      where: { id: rowId },
      data: {
        ...(sentAt !== undefined && { sentAt: sentAt ? new Date(sentAt) : null }),
        ...(sentBy !== undefined && { sentBy }),
        ...(reportedAt !== undefined && { reportedAt: reportedAt ? new Date(reportedAt) : null }),
        ...(reportedBy !== undefined && { reportedBy }),
        ...(resultNotes !== undefined && { resultNotes }),
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[emergency-investigation] update failed:', error);
    res.status(500).json({ message: 'Failed to update investigation' });
  }
};

export const deleteInvestigation = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.emergencyInvestigation.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[emergency-investigation] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete investigation' });
  }
};

// ─── EmergencyTreatment ─────────────────────────────────────────────────

export const listTreatments = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const rows = await prisma.emergencyTreatment.findMany({
      where: { emergencyId },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[emergency-treatment] list failed:', error);
    res.status(500).json({ message: 'Failed to list treatments' });
  }
};

export const createTreatment = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const { drug, dose, route, frequency, givenAt, givenBy, signedBy, signedAt } = req.body;
    if (!drug) {
      res.status(400).json({ message: 'drug is required' });
      return;
    }
    const row = await prisma.emergencyTreatment.create({
      data: {
        emergencyId,
        drug,
        dose: dose ?? null,
        route: route ?? null,
        frequency: frequency ?? null,
        givenAt: givenAt ? new Date(givenAt) : null,
        givenBy: givenBy ?? null,
        signedBy: signedBy ?? req.user?.username ?? null,
        signedAt: signedAt ? new Date(signedAt) : new Date(),
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[emergency-treatment] create failed:', error);
    res.status(500).json({ message: 'Failed to create treatment' });
  }
};

export const updateTreatment = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    const { dose, route, frequency, givenAt, givenBy, signedBy } = req.body;
    const row = await prisma.emergencyTreatment.update({
      where: { id: rowId },
      data: {
        ...(dose !== undefined && { dose }),
        ...(route !== undefined && { route }),
        ...(frequency !== undefined && { frequency }),
        ...(givenAt !== undefined && { givenAt: givenAt ? new Date(givenAt) : null }),
        ...(givenBy !== undefined && { givenBy }),
        ...(signedBy !== undefined && { signedBy }),
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[emergency-treatment] update failed:', error);
    res.status(500).json({ message: 'Failed to update treatment' });
  }
};

export const deleteTreatment = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.emergencyTreatment.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[emergency-treatment] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete treatment' });
  }
};

// ─── EmergencyProcedure ─────────────────────────────────────────────────

export const listProcedures = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const rows = await prisma.emergencyProcedure.findMany({
      where: { emergencyId },
      orderBy: { performedAt: 'desc' },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[emergency-procedure] list failed:', error);
    res.status(500).json({ message: 'Failed to list procedures' });
  }
};

export const createProcedure = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const { procedure, performedAt, performedBy, signatureId, notes } = req.body;
    if (!procedure) {
      res.status(400).json({ message: 'procedure is required' });
      return;
    }
    const row = await prisma.emergencyProcedure.create({
      data: {
        emergencyId,
        procedure,
        performedAt: performedAt ? new Date(performedAt) : new Date(),
        performedBy: performedBy ?? req.user?.username ?? null,
        signatureId: signatureId ?? null,
        notes: notes ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[emergency-procedure] create failed:', error);
    res.status(500).json({ message: 'Failed to create procedure' });
  }
};

export const deleteProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.emergencyProcedure.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[emergency-procedure] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete procedure' });
  }
};

// ─── EmergencySpecimen ──────────────────────────────────────────────────

export const listSpecimens = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const rows = await prisma.emergencySpecimen.findMany({
      where: { emergencyId },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[emergency-specimen] list failed:', error);
    res.status(500).json({ message: 'Failed to list specimens' });
  }
};

export const createSpecimen = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const { container, amount, nurseSign, doctorSign, handedOverTo, handedOverSign, handedOverAt, notes } = req.body;
    const row = await prisma.emergencySpecimen.create({
      data: {
        emergencyId,
        container: container ?? null,
        amount: amount ?? null,
        nurseSign: nurseSign ?? req.user?.username ?? null,
        doctorSign: doctorSign ?? null,
        handedOverTo: handedOverTo ?? null,
        handedOverSign: handedOverSign ?? null,
        handedOverAt: handedOverAt ? new Date(handedOverAt) : null,
        notes: notes ?? null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[emergency-specimen] create failed:', error);
    res.status(500).json({ message: 'Failed to create specimen' });
  }
};

export const updateSpecimen = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    const { handedOverTo, handedOverSign, handedOverAt, doctorSign, notes } = req.body;
    const row = await prisma.emergencySpecimen.update({
      where: { id: rowId },
      data: {
        ...(handedOverTo !== undefined && { handedOverTo }),
        ...(handedOverSign !== undefined && { handedOverSign }),
        ...(handedOverAt !== undefined && { handedOverAt: handedOverAt ? new Date(handedOverAt) : null }),
        ...(doctorSign !== undefined && { doctorSign }),
        ...(notes !== undefined && { notes }),
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[emergency-specimen] update failed:', error);
    res.status(500).json({ message: 'Failed to update specimen' });
  }
};

export const deleteSpecimen = async (req: Request, res: Response): Promise<void> => {
  try {
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(rowId)) { res.status(400).json({ message: 'Invalid row id' }); return; }
    await prisma.emergencySpecimen.delete({ where: { id: rowId } });
    res.status(204).end();
  } catch (error) {
    console.error('[emergency-specimen] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete specimen' });
  }
};
