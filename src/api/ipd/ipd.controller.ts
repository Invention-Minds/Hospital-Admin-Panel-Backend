import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { createHmisAuditLog } from '../hmis-sync/hmis-audit';
import {
  pushIpdAdmission,
  pushIPDDischarge,
  pushIpdTransfer,
} from '../hmis-sync/hmis-client';
import { syncWithHmis } from '../hmis-sync/hmis-sync-wrapper';
import { generateAndStreamDischargePDF } from './discharge-pdf-generator';
import { createFollowUpAppointment, FollowUpResult } from './follow-up-automation';
import { getClinicalActor } from '../../middleware/audit-guard';

/** Sprint 4a Phase 1c — concise human-readable summary for the discharge response. */
const summarizeFollowUp = (r: FollowUpResult): string => {
  switch (r.status) {
    case 'created':
      return `Follow-up appointment scheduled for ${r.appointmentDate.toISOString().split('T')[0]}.`;
    case 'skipped':
      switch (r.reason) {
        case 'no-follow-up-date': return 'No follow-up date provided; no appointment scheduled.';
        case 'past-date':         return 'Follow-up skipped — date is in the past.';
        case 'duplicate':         return 'Follow-up skipped — patient already has an appointment on that date.';
      }
      return 'Follow-up skipped.';
    case 'failed':
      return `Follow-up could not be scheduled — ${r.reason}.`;
  }
};

/**
 * Shape sent to HMIS ADT for a new IPD admission.
 * Exposed (not default) so tests can assert the exact payload without re-deriving it.
 */
export interface IpdHmisPushPayload {
  admissionNo: string;
  prn: string;
  admissionType: string;
  sourceModule: string;
  doctorName: string;
  department: string;
  diagnosis: string;
}

export const buildIpdHmisPushPayload = (admission: {
  admissionNo: string;
  prn: string;
  admissionType: string;
  sourceModule: string;
  admittingDoctor: string;
  department: string;
  diagnosis: string;
}): IpdHmisPushPayload => ({
  admissionNo: admission.admissionNo,
  prn: admission.prn,
  admissionType: admission.admissionType,
  sourceModule: admission.sourceModule,
  doctorName: admission.admittingDoctor,
  department: admission.department,
  diagnosis: admission.diagnosis,
});

/**
 * Shape sent to HMIS ADT for a new IPD discharge.
 */
export interface IpdDischargeHmisPayload {
  admissionId: string;
  prn: string;
  dischargeDate: string;
  finalDiagnosis: string;
  dischargeSummary: string;
}

export const buildIpdDischargeHmisPayload = (
  discharge: {
    admissionId: string;
    dischargeDate: Date;
    finalDiagnosis: string;
    dischargeSummary: string;
  },
  admissionPrn: string
): IpdDischargeHmisPayload => ({
  admissionId: discharge.admissionId,
  prn: admissionPrn,
  dischargeDate: discharge.dischargeDate.toISOString(),
  finalDiagnosis: discharge.finalDiagnosis,
  dischargeSummary: discharge.dischargeSummary,
});

/**
 * Shape sent to HMIS ADT for a bed transfer (ward + bed change during an admission).
 */
export interface IpdTransferHmisPayload {
  admissionId: string;
  prn: string;
  fromBedId: string;
  toBedId: string;
  fromWardId: string;
  toWardId: string;
  reason: string | null;
}

export const buildIpdTransferHmisPayload = (input: {
  admissionId: string;
  prn: string;
  fromBedId: string;
  toBedId: string;
  fromWardId: string;
  toWardId: string;
  reason?: string | null;
}): IpdTransferHmisPayload => ({
  admissionId: input.admissionId,
  prn: input.prn,
  fromBedId: input.fromBedId,
  toBedId: input.toBedId,
  fromWardId: input.fromWardId,
  toWardId: input.toWardId,
  reason: input.reason ?? null,
});

/**
 * Create IPD Admission
 * Can be created from OPD, Emergency, or direct admission
 */
export const createIpdAdmission = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      prn,
      admissionType,
      sourceModule,
      referralOpdId,
      referralEmergencyId,
      referralMlcId,
      referringDoctor,
      admittingDoctor,
      department,
      wardId,
      bedId,
      roomType = 'general',
      diagnosis,
    } = req.body;

    // Validate required fields
    if (!prn || !admittingDoctor || !wardId || !bedId || !diagnosis) {
      res.status(400).json({
        message:
          'Missing required fields: prn, admittingDoctor, wardId, bedId, diagnosis',
      });
      return;
    }

    // Check if bed exists and is available
    const bed = await prisma.ipdBed.findUnique({
      where: { id: bedId },
    });

    if (!bed) {
      res.status(404).json({ message: 'Bed not found' });
      return;
    }

    if (bed.status === 'occupied') {
      res.status(409).json({ message: 'Bed is already occupied' });
      return;
    }

    // Generate admission number
    const lastAdmission = await prisma.ipdAdmission.findFirst({
      orderBy: { id: 'desc' },
      select: { admissionNo: true },
    });

    let nextNumber = 1;
    if (lastAdmission?.admissionNo) {
      const match = lastAdmission.admissionNo.match(/IPD-(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }
    const admissionNo = `JMRH-IPD-${String(nextNumber).padStart(4, '0')}`;

    // Create admission
    const admission = await prisma.ipdAdmission.create({
      data: {
        admissionNo,
        prn,
        admissionDate: new Date(),
        admissionTime: new Date().toLocaleTimeString(),
        admissionType: admissionType || 'routine',
        sourceModule: sourceModule || 'direct',
        referralOpdId,
        referralEmergencyId,
        referralMlcId,
        referringDoctor,
        admittingDoctor,
        department: department || 'General',
        wardId,
        bedId,
        roomType,
        diagnosis,
        status: 'admitted',
        createdBy: req.user?.username || 'system',
      },
      include: {
        bed: true,
        ward: true,
      },
    });

    // Mark bed as occupied
    await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'occupied' },
    });

    // Push to HMIS ADT via the audit-wrapped pipeline.
    // Wrapper writes success AND failure audit logs; swallowErrors defaults to true
    // because the bed is already occupied — HMIS failure must not break the admission.
    const hmisOutcome = await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'admission',
      action: 'admission_created',
      payload: admission,
      operation: () => pushIpdAdmission(buildIpdHmisPushPayload(admission)),
    });

    let finalAdmission = admission;
    if (hmisOutcome.success && hmisOutcome.result) {
      const hmisResult = hmisOutcome.result as { id?: string | number };
      if (hmisResult.id !== undefined && hmisResult.id !== null) {
        finalAdmission = await prisma.ipdAdmission.update({
          where: { id: admission.id },
          data: { hmisAdmissionId: String(hmisResult.id) },
          include: { bed: true, ward: true },
        });
      }
    }

    res.status(201).json({
      message: 'IPD admission created successfully',
      data: finalAdmission,
    });
  } catch (error) {
    console.error('Error creating IPD admission:', error);
    res.status(500).json({
      message: 'Error creating IPD admission',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get IPD Admission by ID
 */
export const getIpdAdmission = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const admission = await prisma.ipdAdmission.findUnique({
      where: { id },
      include: {
        bed: true,
        ward: true,
        progressNotes: {
          orderBy: { date: 'desc' },
        },
        discharge: true,
        prescriptions: {
          where: { status: { not: 'discontinued' } },
        },
      },
    });

    if (!admission) {
      res.status(404).json({ message: 'IPD admission not found' });
      return;
    }

    res.status(200).json({
      message: 'IPD admission retrieved successfully',
      data: admission,
    });
  } catch (error) {
    console.error('Error fetching IPD admission:', error);
    res.status(500).json({
      message: 'Error fetching IPD admission',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get all active IPD admissions (with filters)
 */
export const getIpdAdmissions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { status = 'admitted', wardId, page = 1, limit = 10 } = req.query;

    const where: any = { status };
    if (wardId) where.wardId = wardId;

    const admissions = await prisma.ipdAdmission.findMany({
      where,
      include: {
        bed: true,
        ward: true,
        progressNotes: {
          take: 1,
          orderBy: { date: 'desc' },
        },
      },
      orderBy: { admissionDate: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string),
    });

    const total = await prisma.ipdAdmission.count({ where });

    res.status(200).json({
      message: 'IPD admissions retrieved successfully',
      data: admissions,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error('Error fetching IPD admissions:', error);
    res.status(500).json({
      message: 'Error fetching IPD admissions',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Update IPD Admission (mainly for status changes)
 */
export const updateIpdAdmission = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, updatedField } = req.body;

    const validStatuses = ['admitted', 'transferred', 'discharged', 'LAMA', 'DAMA', 'expired'];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    const admission = await prisma.ipdAdmission.update({
      where: { id },
      data: {
        ...req.body,
        updatedBy: req.user?.username || 'system',
      },
    });

    await createHmisAuditLog({
      direction: 'push',
      module: 'ipd',
      action: 'admission_updated',
      payload: JSON.stringify({ id, status }),
      status: 'success',
    });

    res.status(200).json({
      message: 'IPD admission updated successfully',
      data: admission,
    });
  } catch (error) {
    console.error('Error updating IPD admission:', error);
    res.status(500).json({
      message: 'Error updating IPD admission',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Add Progress Note (SOAP) to IPD Admission
 */
export const addProgressNote = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Sprint 4a Phase 1b — NABH MRD.1 inline guard (belt-and-suspenders: the
    // route middleware runs first; this inline check makes the handler
    // self-defending + unit-testable without booting Express).
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { admissionId } = req.params;
    const {
      doctorName,
      subjective,
      objective,
      assessment,
      plan,
      nursingNotes,
      vitalsBP,
      vitalsHR,
      vitalsTemp,
      vitalsSpO2,
      vitalsRR,
    } = req.body;

    // Validate required fields
    if (!doctorName || !subjective || !objective || !assessment || !plan) {
      res.status(400).json({
        message:
          'Missing required fields: doctorName, subjective, objective, assessment, plan',
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

    const progressNote = await prisma.ipdProgressNote.create({
      data: {
        admissionId,
        date: new Date(),
        doctorName,
        subjective,
        objective,
        assessment,
        plan,
        nursingNotes,
        vitalsBP,
        vitalsHR,
        vitalsTemp,
        vitalsSpO2,
        vitalsRR,
        // Sprint 4a Phase 1b — NABH MRD.1 coexistence stamping.
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    res.status(201).json({
      message: 'Progress note added successfully',
      data: progressNote,
    });
  } catch (error) {
    console.error('Error adding progress note:', error);
    res.status(500).json({
      message: 'Error adding progress note',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get Progress Notes for an admission
 */
export const getProgressNotes = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const progressNotes = await prisma.ipdProgressNote.findMany({
      where: { admissionId },
      orderBy: { date: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string),
    });

    const total = await prisma.ipdProgressNote.count({ where: { admissionId } });

    res.status(200).json({
      message: 'Progress notes retrieved successfully',
      data: progressNotes,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error('Error fetching progress notes:', error);
    res.status(500).json({
      message: 'Error fetching progress notes',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Create IPD Discharge Summary
 */
export const createDischarge = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Sprint 4a Phase 1b — NABH MRD.1 inline guard.
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { admissionId } = req.params;
    const {
      dischargeType,
      finalDiagnosis,
      proceduresDone,
      conditionAtDischarge,
      dischargeSummary,
      followUpDate,
      followUpDoctor,
      medications,
      advice,
    } = req.body;

    // Validate required fields
    if (!dischargeType || !finalDiagnosis || !conditionAtDischarge || !dischargeSummary) {
      res.status(400).json({
        message:
          'Missing required fields: dischargeType, finalDiagnosis, conditionAtDischarge, dischargeSummary',
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

    // Guard against double-discharge (admission flag OR existing discharge row).
    if (admission.status === 'discharged') {
      res.status(409).json({ message: 'Admission is already discharged' });
      return;
    }
    const existingDischarge = await prisma.ipdDischarge.findUnique({
      where: { admissionId },
    });
    if (existingDischarge) {
      res.status(409).json({ message: 'Discharge record already exists for this admission' });
      return;
    }

    // Sprint 4a Phase 1b — NABH MRD.1 coexistence stamping.
    const discharge = await prisma.ipdDischarge.create({
      data: {
        admissionId,
        dischargeDate: new Date(),
        dischargeTime: new Date().toLocaleTimeString(),
        dischargeType,
        finalDiagnosis,
        proceduresDone,
        conditionAtDischarge,
        dischargeSummary,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        followUpDoctor,
        medications: JSON.stringify(medications || []),
        advice,
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    // Update admission status
    await prisma.ipdAdmission.update({
      where: { id: admissionId },
      data: {
        status: 'discharged',
        updatedBy: req.user!.username,
      },
    });

    // Mark bed as available (NABH ACC.5, plan workflow step 8)
    await prisma.ipdBed.update({
      where: { id: admission.bedId },
      data: { status: 'available' },
    });

    // Push to HMIS ADT via the audit-wrapped pipeline (inline-await per Sprint 2 latency policy).
    // Wrapper writes success AND failure audit logs; swallowErrors defaults to true because
    // the discharge side-effects (status flip + bed freed) are already committed.
    const hmisOutcome = await syncWithHmis({
      direction: 'push',
      module: 'discharge',
      entityType: 'discharge',
      action: 'discharge_created',
      payload: discharge,
      operation: () =>
        pushIPDDischarge(buildIpdDischargeHmisPayload(discharge, admission.prn)),
    });

    let finalDischarge = discharge;
    if (hmisOutcome.success && hmisOutcome.result) {
      const hmisResult = hmisOutcome.result as { id?: string | number };
      if (hmisResult.id !== undefined && hmisResult.id !== null) {
        finalDischarge = await prisma.ipdDischarge.update({
          where: { id: discharge.id },
          data: { hmisDischargeId: String(hmisResult.id) },
        });
      }
    }

    // Sprint 4a Phase 1c — auto-create follow-up Appointment. The helper
    // returns a tagged status; we surface it in the discharge response so
    // the UI can inform the clinician whether the follow-up was created,
    // skipped (with reason), or failed. Discharge ALWAYS succeeds regardless.
    let followUpSummary: string;
    try {
      const followUpResult = await createFollowUpAppointment(
        finalDischarge.id,
        admissionId,
        finalDischarge.followUpDate ? new Date(finalDischarge.followUpDate) : null,
        undefined,
        `Follow-up after ${finalDischarge.finalDiagnosis}`,
        finalDischarge.createdById ?? null
      );
      followUpSummary = summarizeFollowUp(followUpResult);
    } catch (error) {
      console.error('Error creating follow-up appointment:', error);
      followUpSummary = 'Follow-up auto-creation crashed — see audit log.';
    }

    res.status(201).json({
      message: `IPD discharge summary created successfully. ${followUpSummary}`,
      data: finalDischarge,
    });
  } catch (error) {
    console.error('Error creating discharge:', error);
    res.status(500).json({
      message: 'Error creating discharge',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get Discharge Summary
 */
export const getDischarge = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    const discharge = await prisma.ipdDischarge.findUnique({
      where: { admissionId },
    });

    if (!discharge) {
      res.status(404).json({ message: 'Discharge record not found' });
      return;
    }

    res.status(200).json({
      message: 'Discharge summary retrieved successfully',
      data: discharge,
    });
  } catch (error) {
    console.error('Error fetching discharge:', error);
    res.status(500).json({
      message: 'Error fetching discharge',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Transfer patient to another bed/ward
 */
export const transferPatient = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const { newBedId, newWardId, reason } = req.body;

    if (!newBedId || !newWardId) {
      res.status(400).json({
        message: 'Missing required fields: newBedId, newWardId',
      });
      return;
    }

    // Verify admission exists
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      include: { bed: true },
    });

    if (!admission) {
      res.status(404).json({ message: 'IPD admission not found' });
      return;
    }

    // Guard: admission must be in transferable state
    if (admission.status !== 'admitted') {
      res.status(409).json({
        message: `Admission is not in a transferable state (current status: ${admission.status})`,
      });
      return;
    }

    // Guard: cannot transfer to the same bed
    if (newBedId === admission.bedId) {
      res.status(409).json({
        message: 'Target bed is the same as the current bed',
      });
      return;
    }

    // Verify new bed exists and is available
    const newBed = await prisma.ipdBed.findUnique({
      where: { id: newBedId },
    });

    if (!newBed || newBed.status === 'occupied') {
      res.status(409).json({ message: 'New bed is not available' });
      return;
    }

    const fromBedId = admission.bedId;
    const fromWardId = admission.wardId;

    // Atomic bed flips + admission update. Either all three commit or none do —
    // prevents orphan state where admission points at the new bed but beds are in wrong status.
    // Using an interactive transaction (not the array form) to preserve the include<> type on updated.
    const updated = await prisma.$transaction(async (tx) => {
      const updatedAdmission = await tx.ipdAdmission.update({
        where: { id: admissionId },
        data: {
          bedId: newBedId,
          wardId: newWardId,
          updatedBy: req.user?.username || 'system',
        },
        include: { bed: true, ward: true },
      });
      await tx.ipdBed.update({
        where: { id: fromBedId },
        data: { status: 'available' },
      });
      await tx.ipdBed.update({
        where: { id: newBedId },
        data: { status: 'occupied' },
      });
      return updatedAdmission;
    });

    // Push to HMIS ADT via the audit-wrapped pipeline (inline-await per Sprint 2 latency policy).
    // Local transaction already committed; HMIS failure does not roll back bed state.
    const hmisOutcome = await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'transfer',
      action: 'bed_transfer',
      payload: {
        admissionId,
        prn: admission.prn,
        fromBedId,
        toBedId: newBedId,
        fromWardId,
        toWardId: newWardId,
        reason: reason ?? null,
      },
      operation: () =>
        pushIpdTransfer(
          buildIpdTransferHmisPayload({
            admissionId,
            prn: admission.prn,
            fromBedId,
            toBedId: newBedId,
            fromWardId,
            toWardId: newWardId,
            reason,
          })
        ),
    });

    let finalAdmission = updated;
    if (hmisOutcome.success && hmisOutcome.result) {
      const hmisResult = hmisOutcome.result as { id?: string | number };
      if (hmisResult.id !== undefined && hmisResult.id !== null) {
        finalAdmission = await prisma.ipdAdmission.update({
          where: { id: admissionId },
          data: { hmisTransferId: String(hmisResult.id) },
          include: { bed: true, ward: true },
        });
      }
    }

    res.status(200).json({
      message: 'Patient transferred successfully',
      data: finalAdmission,
    });
  } catch (error) {
    console.error('Error transferring patient:', error);
    res.status(500).json({
      message: 'Error transferring patient',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * IPD statistics (admissions, occupancy, ALOS)
 */
export const getIpdStats = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromDate, toDate } = req.query;
    const where: any = {};
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.admissionDate = { gte: start, lte: end };
    }

    const [total, admitted, discharged, lama, dama, expired, transferred, elective, emergency, direct] =
      await Promise.all([
        prisma.ipdAdmission.count({ where }),
        prisma.ipdAdmission.count({ where: { ...where, status: 'admitted' } }),
        prisma.ipdAdmission.count({ where: { ...where, status: 'discharged' } }),
        prisma.ipdAdmission.count({ where: { ...where, status: 'LAMA' } }),
        prisma.ipdAdmission.count({ where: { ...where, status: 'DAMA' } }),
        prisma.ipdAdmission.count({ where: { ...where, status: 'expired' } }),
        prisma.ipdAdmission.count({ where: { ...where, status: 'transferred' } }),
        prisma.ipdAdmission.count({ where: { ...where, admissionType: 'elective' } }),
        prisma.ipdAdmission.count({ where: { ...where, admissionType: 'emergency' } }),
        prisma.ipdAdmission.count({ where: { ...where, sourceModule: 'direct' } }),
      ]);

    // Average Length of Stay (ALOS) — for discharged admissions in range
    const dischargedAdmissions = await prisma.ipdAdmission.findMany({
      where: { ...where, status: 'discharged' },
      include: { discharge: true },
    });

    let totalDays = 0;
    let countForAlos = 0;
    dischargedAdmissions.forEach((a) => {
      if (a.discharge) {
        const days =
          (new Date(a.discharge.dischargeDate).getTime() - new Date(a.admissionDate).getTime()) /
          (1000 * 60 * 60 * 24);
        if (days >= 0) {
          totalDays += days;
          countForAlos++;
        }
      }
    });
    const alos = countForAlos ? +(totalDays / countForAlos).toFixed(1) : 0;

    res.status(200).json({
      message: 'IPD statistics retrieved',
      data: {
        total,
        byStatus: { admitted, discharged, lama, dama, expired, transferred },
        byType: { elective, emergency, direct },
        averageLengthOfStay: alos,
      },
    });
  } catch (error) {
    console.error('Error fetching IPD stats:', error);
    res.status(500).json({
      message: 'Error fetching IPD stats',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Download discharge summary as PDF
 * Generates professional PDF with patient info, diagnosis, medications, follow-up, etc.
 */
export const downloadDischargePDF = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId } = req.params;

    // Verify admission and discharge exist
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
    });

    if (!admission) {
      res.status(404).json({ message: 'IPD admission not found' });
      return;
    }

    const discharge = await prisma.ipdDischarge.findUnique({
      where: { admissionId },
    });

    if (!discharge) {
      res.status(404).json({ message: 'Discharge record not found' });
      return;
    }

    // Generate and stream PDF
    await generateAndStreamDischargePDF(admissionId, res);
  } catch (error) {
    console.error('Error downloading discharge PDF:', error);
    res.status(500).json({
      message: 'Error generating discharge PDF',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
