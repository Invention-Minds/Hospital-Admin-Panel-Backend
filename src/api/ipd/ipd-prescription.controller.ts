import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { createHmisAuditLog } from '../hmis-sync/hmis-audit';
import {
  pushIpdPrescription,
  pushIpdPrescriptionDiscontinue,
  pushIpdMedicationAdmin,
} from '../hmis-sync/hmis-client';
import { syncWithHmis } from '../hmis-sync/hmis-sync-wrapper';
import { getClinicalActor } from '../../middleware/audit-guard';

/**
 * Typed payload shapes sent to HMIS for IPD pharmacy events.
 * Exported so tests can assert exact payloads without re-deriving them.
 */
export interface IpdPrescriptionHmisPayload {
  admissionId: string;
  prescriptionId: string;
  prescribedBy: string;
  genericName: string;
  brandName: string | null;
  dose: string;
  frequency: string;
  duration: string;
  route: string;
  instructions: string | null;
  quantity: number;
  isCarryOver: boolean;
  carryOverFrom: string | null;
  event: 'continued' | 'modified' | 'created';
}

export const buildIpdPrescriptionPayload = (
  rx: {
    id: string;
    admissionId: string;
    prescribedBy: string;
    genericName: string;
    brandName: string | null;
    dose: string;
    frequency: string;
    duration: string;
    route: string;
    instructions: string | null;
    quantity: number;
    isCarryOver: boolean;
    carryOverFrom: string | null;
  },
  event: 'continued' | 'modified' | 'created'
): IpdPrescriptionHmisPayload => ({
  admissionId: rx.admissionId,
  prescriptionId: rx.id,
  prescribedBy: rx.prescribedBy,
  genericName: rx.genericName,
  brandName: rx.brandName,
  dose: rx.dose,
  frequency: rx.frequency,
  duration: rx.duration,
  route: rx.route,
  instructions: rx.instructions,
  quantity: rx.quantity,
  isCarryOver: rx.isCarryOver,
  carryOverFrom: rx.carryOverFrom,
  event,
});

export interface IpdPrescriptionDiscontinuePayload {
  admissionId: string;
  prescriptionId: string;
  reason: string | null;
  discontinuedBy: string;
}

export const buildIpdPrescriptionDiscontinuePayload = (input: {
  admissionId: string;
  prescriptionId: string;
  reason?: string | null;
  discontinuedBy: string;
}): IpdPrescriptionDiscontinuePayload => ({
  admissionId: input.admissionId,
  prescriptionId: input.prescriptionId,
  reason: input.reason ?? null,
  discontinuedBy: input.discontinuedBy,
});

export interface IpdMedicationAdminPayload {
  admissionId: string;
  prescriptionId: string;
  marLogId: string;
  administeredBy: string;
  administeredAt: string;
  quantity: number;
  route: string;
  remarks: string | null;
}

export const buildIpdMedicationAdminPayload = (input: {
  admissionId: string;
  prescriptionId: string;
  marLogId: string;
  administeredBy: string;
  administeredAt: Date;
  quantity: number;
  route: string;
  remarks?: string | null;
}): IpdMedicationAdminPayload => ({
  admissionId: input.admissionId,
  prescriptionId: input.prescriptionId,
  marLogId: input.marLogId,
  administeredBy: input.administeredBy,
  administeredAt: input.administeredAt.toISOString(),
  quantity: input.quantity,
  route: input.route,
  remarks: input.remarks ?? null,
});

/**
 * Review OPD/Emergency prescriptions for carryover to IPD
 */
export const reviewCarryoverPrescriptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    // Get admission with patient PRN
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
    });

    if (!admission) {
      res.status(404).json({ message: 'IPD admission not found' });
      return;
    }

    // Fetch pending prescriptions from OPD/Emergency (last 7 days).
    // Sprint 3c: include child `tablets` so the frontend can render per-tablet
    // carryover rows (genericName/brandName/frequency/route/quantity/instructions).
    // The pre-3c shape returned only {prescriptionId, prescribedBy, prescribedDate}
    // which was too thin to render the clinical review table.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const pendingPrescriptions = await prisma.prescription.findMany({
      where: {
        prn: admission.prn,
        prescribedDate: {
          gte: sevenDaysAgo,
        },
      },
      include: { tablets: true },
    });

    // Return each OPD/Emergency prescription with its full tablet array.
    // Frontend flattens to one row per tablet.
    const carryoverOptions = pendingPrescriptions.map((prescription) => ({
      prescriptionId: prescription.prescriptionId,
      prescribedBy: prescription.prescribedBy,
      prescribedDate: prescription.prescribedDate,
      patientName: prescription.patientName,
      tablets: prescription.tablets,
    }));

    res.status(200).json({
      message: 'Carryover prescriptions retrieved for review',
      data: carryoverOptions,
    });
  } catch (error) {
    console.error('Error reviewing carryover prescriptions:', error);
    res.status(500).json({
      message: 'Error reviewing carryover prescriptions',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Continue existing OPD/Emergency prescription in IPD
 */
export const continuePrescription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { admissionId } = req.params;
    const {
      prescriptionId,
      genericName,
      brandName,
      dose,
      frequency,
      duration,
      route = 'oral',
      instructions,
      quantity,
      prescribedBy,
    } = req.body;

    // Validate required fields
    if (!genericName || !dose || !frequency || !duration || !prescribedBy) {
      res.status(400).json({
        message:
          'Missing required fields: genericName, dose, frequency, duration, prescribedBy',
      });
      return;
    }

    // Verify admission exists
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
    });

    if (!admission) {
      res.status(404).json({ message: 'IPD admission not found' });
      return;
    }

    // Create IPD prescription (carryover) — NABH MRD.1 coexistence stamping.
    const ipdPrescription = await prisma.ipdPrescription.create({
      data: {
        admissionId,
        prescriptionId,
        prescribedBy,
        prescribedDate: new Date(),
        carryOverFrom: 'opd', // or 'emergency' - could be passed in body
        genericName,
        brandName,
        dose,
        frequency,
        duration,
        route,
        instructions,
        quantity,
        isCarryOver: true,
        status: 'active',
        adminStatus: 'pending',
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    // Respond immediately — HMIS push is fire-and-forget (Sprint 2 latency policy
    // for high-frequency pharmacy events). Wrapper writes HmisAuditLog on success
    // AND failure on its own timeline; hourly retry cron handles failed rows.
    res.status(201).json({
      message: 'Prescription continued in IPD',
      data: ipdPrescription,
    });

    syncWithHmis({
      direction: 'push',
      module: 'ipd-pharmacy',
      entityType: 'prescription',
      action: 'ipd_prescription_continued',
      payload: ipdPrescription,
      operation: () =>
        pushIpdPrescription(buildIpdPrescriptionPayload(ipdPrescription, 'continued')),
    }).catch((err) => {
      console.error('HMIS pharmacy wrapper crashed (continue):', err);
    });
  } catch (error) {
    console.error('Error continuing prescription:', error);
    res.status(500).json({
      message: 'Error continuing prescription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Modify IPD prescription (change dose/frequency)
 */
export const modifyPrescription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { prescriptionId } = req.params;
    const { dose, frequency, duration, route, instructions } = req.body;

    const prescription = await prisma.ipdPrescription.update({
      where: { id: prescriptionId },
      data: {
        ...(dose && { dose }),
        ...(frequency && { frequency }),
        ...(duration && { duration }),
        ...(route && { route }),
        ...(instructions && { instructions }),
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    res.status(200).json({
      message: 'Prescription modified successfully',
      data: prescription,
    });

    // Fire-and-forget HMIS push.
    syncWithHmis({
      direction: 'push',
      module: 'ipd-pharmacy',
      entityType: 'prescription',
      action: 'ipd_prescription_modified',
      payload: prescription,
      operation: () =>
        pushIpdPrescription(buildIpdPrescriptionPayload(prescription, 'modified')),
    }).catch((err) => {
      console.error('HMIS pharmacy wrapper crashed (modify):', err);
    });
  } catch (error) {
    console.error('Error modifying prescription:', error);
    res.status(500).json({
      message: 'Error modifying prescription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Discontinue IPD prescription
 */
export const discontinuePrescription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { prescriptionId } = req.params;
    const { reason } = req.body;

    const prescription = await prisma.ipdPrescription.update({
      where: { id: prescriptionId },
      data: {
        status: 'discontinued',
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    res.status(200).json({
      message: 'Prescription discontinued successfully',
      data: prescription,
    });

    // Fire-and-forget HMIS push.
    syncWithHmis({
      direction: 'push',
      module: 'ipd-pharmacy',
      entityType: 'prescription',
      action: 'ipd_prescription_discontinued',
      payload: { prescription, reason: reason ?? null },
      operation: () =>
        pushIpdPrescriptionDiscontinue(
          buildIpdPrescriptionDiscontinuePayload({
            admissionId: prescription.admissionId,
            prescriptionId: prescription.id,
            reason,
            discontinuedBy: req.user!.username,
          })
        ),
    }).catch((err) => {
      console.error('HMIS pharmacy wrapper crashed (discontinue):', err);
    });
  } catch (error) {
    console.error('Error discontinuing prescription:', error);
    res.status(500).json({
      message: 'Error discontinuing prescription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Create new IPD prescription (not carryover)
 */
export const createNewPrescription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { admissionId } = req.params;
    const {
      prescribedBy,
      genericName,
      brandName,
      dose,
      frequency,
      duration,
      route = 'oral',
      instructions,
      quantity,
    } = req.body;

    // Validate required fields
    if (!prescribedBy || !genericName || !dose || !frequency || !duration) {
      res.status(400).json({
        message:
          'Missing required fields: prescribedBy, genericName, dose, frequency, duration',
      });
      return;
    }

    // Verify admission exists
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
    });

    if (!admission) {
      res.status(404).json({ message: 'IPD admission not found' });
      return;
    }

    // Create new IPD prescription
    const prescription = await prisma.ipdPrescription.create({
      data: {
        admissionId,
        prescribedBy,
        prescribedDate: new Date(),
        carryOverFrom: null,
        genericName,
        brandName,
        dose,
        frequency,
        duration,
        route,
        instructions,
        quantity,
        isCarryOver: false,
        status: 'active',
        adminStatus: 'pending',
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    // Log to audit trail
    await createHmisAuditLog({
      direction: 'push',
      module: 'pharmacy',
      action: 'ipd_prescription_created',
      payload: JSON.stringify({
        admissionId,
        genericName,
        prescribedBy,
      }),
      status: 'success',
    });

    res.status(201).json({
      message: 'New IPD prescription created',
      data: prescription,
    });
  } catch (error) {
    console.error('Error creating new prescription:', error);
    res.status(500).json({
      message: 'Error creating new prescription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get pending medications for administration
 */
export const getPendingMedications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    const pendingMeds = await prisma.ipdPrescription.findMany({
      where: {
        admissionId,
        status: 'active',
        adminStatus: 'pending',
      },
      orderBy: { nextAdminTime: 'asc' },
    });

    res.status(200).json({
      message: 'Pending medications retrieved',
      data: pendingMeds,
    });
  } catch (error) {
    console.error('Error fetching pending medications:', error);
    res.status(500).json({
      message: 'Error fetching pending medications',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Mark medication as administered (MAR - Medication Administration Record)
 */
export const administerMedication = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { prescriptionId } = req.params;
    const { quantity, route, remarks } = req.body;

    // Get prescription to find admission
    const prescription = await prisma.ipdPrescription.findUnique({
      where: { id: prescriptionId },
    });

    if (!prescription) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }

    // Update prescription admin status
    const updated = await prisma.ipdPrescription.update({
      where: { id: prescriptionId },
      data: {
        lastAdminTime: new Date(),
        adminStatus: 'administered',
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    // Create MAR log entry — NABH MRD.1 coexistence stamping on the log.
    const marLog = await prisma.ipdMedicationLog.create({
      data: {
        prescriptionId,
        admissionId: prescription.admissionId,
        administeredAt: new Date(),
        administeredBy: req.user!.username,
        quantity: quantity || prescription.quantity,
        route: route || prescription.route,
        remarks,
        createdById: actorId,
      },
    });

    res.status(200).json({
      message: 'Medication administered and logged',
      data: {
        prescription: updated,
        marLog,
      },
    });

    // Fire-and-forget HMIS push for MAR (MOM.4). Highest-volume pharmacy event.
    syncWithHmis({
      direction: 'push',
      module: 'ipd-mar',
      entityType: 'medication-admin',
      action: 'medication_administered',
      payload: marLog,
      operation: () =>
        pushIpdMedicationAdmin(
          buildIpdMedicationAdminPayload({
            admissionId: marLog.admissionId,
            prescriptionId: marLog.prescriptionId,
            marLogId: marLog.id,
            administeredBy: marLog.administeredBy,
            administeredAt: marLog.administeredAt,
            quantity: marLog.quantity,
            route: marLog.route,
            remarks: marLog.remarks,
          })
        ),
    }).catch((err) => {
      console.error('HMIS pharmacy wrapper crashed (administer):', err);
    });
  } catch (error) {
    console.error('Error administering medication:', error);
    res.status(500).json({
      message: 'Error administering medication',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get Medication Administration Record (MAR) for admission
 */
export const getMedicationAdministrationRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const marLogs = await prisma.ipdMedicationLog.findMany({
      where: { admissionId },
      orderBy: { administeredAt: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string),
    });

    const total = await prisma.ipdMedicationLog.count({ where: { admissionId } });

    // Sprint 3c: enrich each MAR row with its parent prescription's drug
    // identity. `IpdMedicationLog` has a `prescriptionId` FK column but no
    // Prisma relation field, so `include` isn't available — we batch-fetch
    // distinct prescription ids and stitch in JS (branch c of the Sprint 3c
    // backend brief). Single extra query per page, O(distinct-ids) memory.
    const distinctPrescriptionIds = Array.from(
      new Set(marLogs.map((log) => log.prescriptionId))
    );
    const prescriptions =
      distinctPrescriptionIds.length > 0
        ? await prisma.ipdPrescription.findMany({
            where: { id: { in: distinctPrescriptionIds } },
            select: {
              id: true,
              genericName: true,
              brandName: true,
              frequency: true,
              route: true,
            },
          })
        : [];
    const rxById = new Map(prescriptions.map((rx) => [rx.id, rx]));
    const enrichedLogs = marLogs.map((log) => ({
      ...log,
      prescription: rxById.get(log.prescriptionId) ?? null,
    }));

    res.status(200).json({
      message: 'Medication administration records retrieved',
      data: enrichedLogs,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error('Error fetching MAR:', error);
    res.status(500).json({
      message: 'Error fetching medication administration records',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Skip a medication administration
 */
export const skipMedication = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { prescriptionId } = req.params;
    const { reason } = req.body;

    const prescription = await prisma.ipdPrescription.findUnique({
      where: { id: prescriptionId },
    });
    if (!prescription) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }

    const updated = await prisma.ipdPrescription.update({
      where: { id: prescriptionId },
      data: {
        adminStatus: 'skipped',
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    await prisma.ipdMedicationLog.create({
      data: {
        prescriptionId,
        admissionId: prescription.admissionId,
        administeredAt: new Date(),
        administeredBy: req.user!.username,
        quantity: 0,
        route: prescription.route,
        remarks: `Skipped: ${reason || 'no reason provided'}`,
        createdById: actorId,
      },
    });

    await createHmisAuditLog({
      direction: 'push',
      module: 'pharmacy',
      action: 'medication_skipped',
      payload: JSON.stringify({ prescriptionId, reason }),
      status: 'success',
    });

    res.status(200).json({ message: 'Medication skipped', data: updated });
  } catch (error) {
    console.error('Error skipping medication:', error);
    res.status(500).json({
      message: 'Error skipping medication',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get single prescription by ID
 */
export const getPrescription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { prescriptionId } = req.params;

    const prescription = await prisma.ipdPrescription.findUnique({
      where: { id: prescriptionId },
      include: { admission: true },
    });

    if (!prescription) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }

    res.status(200).json({ message: 'Prescription retrieved', data: prescription });
  } catch (error) {
    console.error('Error fetching prescription:', error);
    res.status(500).json({
      message: 'Error fetching prescription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get MAR report for date range
 */
export const getMarReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const { fromDate, toDate } = req.query;

    const where: any = { admissionId };
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.administeredAt = { gte: start, lte: end };
    }

    const logs = await prisma.ipdMedicationLog.findMany({
      where,
      orderBy: { administeredAt: 'desc' },
    });

    // Summary stats
    const total = logs.length;
    const administered = logs.filter((l) => !l.remarks?.startsWith('Skipped')).length;
    const skipped = total - administered;

    res.status(200).json({
      message: 'MAR report retrieved',
      data: {
        summary: { total, administered, skipped },
        logs,
      },
    });
  } catch (error) {
    console.error('Error fetching MAR report:', error);
    res.status(500).json({
      message: 'Error fetching MAR report',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get prescription history for admission (including discontinued)
 */
export const getPrescriptionHistory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    const prescriptions = await prisma.ipdPrescription.findMany({
      where: { admissionId },
      orderBy: { prescribedDate: 'desc' },
    });

    res.status(200).json({ message: 'Prescription history retrieved', data: prescriptions });
  } catch (error) {
    console.error('Error fetching prescription history:', error);
    res.status(500).json({
      message: 'Error fetching prescription history',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Download medication list as CSV
 */
export const downloadMedicationList = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    const prescriptions = await prisma.ipdPrescription.findMany({
      where: { admissionId },
      orderBy: { prescribedDate: 'desc' },
    });

    const headers = ['Generic', 'Brand', 'Dose', 'Frequency', 'Duration', 'Route', 'Qty', 'Status', 'AdminStatus', 'PrescribedBy', 'PrescribedDate'];
    const rows = prescriptions.map((p) => [
      p.genericName,
      p.brandName || '',
      p.dose,
      p.frequency,
      p.duration,
      p.route,
      p.quantity,
      p.status,
      p.adminStatus,
      p.prescribedBy,
      new Date(p.prescribedDate).toISOString(),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="medication-list-${admissionId}.csv"`
    );
    res.status(200).send(csv);
  } catch (error) {
    console.error('Error downloading medication list:', error);
    res.status(500).json({
      message: 'Error downloading medication list',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Sync prescription with HMIS (logs attempt)
 */
export const syncPrescriptionWithHmis = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { prescriptionId } = req.params;

    const prescription = await prisma.ipdPrescription.findUnique({
      where: { id: prescriptionId },
    });

    if (!prescription) {
      res.status(404).json({ message: 'Prescription not found' });
      return;
    }

    await createHmisAuditLog({
      direction: 'push',
      module: 'pharmacy',
      action: 'prescription_sync',
      payload: JSON.stringify(prescription),
      status: 'success',
    });

    res.status(200).json({
      message: 'Prescription synced with HMIS',
      data: prescription,
    });
  } catch (error) {
    console.error('Error syncing prescription:', error);
    res.status(500).json({
      message: 'Error syncing prescription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get all active prescriptions for an admission
 */
export const getAdmissionPrescriptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    const prescriptions = await prisma.ipdPrescription.findMany({
      where: {
        admissionId,
        status: { not: 'discontinued' },
      },
      orderBy: { prescribedDate: 'desc' },
    });

    res.status(200).json({
      message: 'Prescriptions retrieved',
      data: prescriptions,
    });
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    res.status(500).json({
      message: 'Error fetching prescriptions',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
