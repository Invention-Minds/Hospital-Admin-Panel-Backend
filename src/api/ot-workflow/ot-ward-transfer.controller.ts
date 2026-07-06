import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.12 — UHJ "Pre-Operative Surgical Safety Checklist (Ward → OT)".
//
// Routes (under /api/ot/...):
//   GET  /schedules/:scheduleId/ward-transfer            — fetch (or null)
//   PUT  /schedules/:scheduleId/ward-transfer            — upsert checklist items
//   POST /schedules/:scheduleId/ward-transfer/sign/:role — sign (ward | ot-receiving)
//   GET  /ward-transfer/by-admission/:admissionId        — schedules + checklist
//                                                          for an IPD admission
//
// One row per OtSchedule. The ward nurse fills sections A+B and signs;
// the OT receiving nurse fills section C and signs.

// All boolean checklist columns — the PUT handler only writes keys in this
// allow-list, so an unexpected body key can't poke arbitrary columns.
const CHECKLIST_BOOLEANS = [
  // Section A — ward (25)
  'identityBandChecked', 'surgeryConsentSigned', 'anaesthesiaConsentSigned',
  'surgicalSiteMarked', 'preOpAssessmentCompleted', 'allergyStatusChecked',
  'investigationsAvailable', 'bloodGroupCrossMatchDone', 'bloodProductsArranged',
  'vitalSignsRecorded', 'ivLineSecured', 'preOpMedicationsGiven',
  'antibioticAdministered', 'fastingConfirmed', 'dentureRemoved',
  'jewelleryRemoved', 'nailPolishMakeupRemoved', 'contactLensRemoved',
  'prosthesisHearingAidRemoved', 'urinaryCatheterSecured', 'skinPreparationCompleted',
  'operativeSiteCleanedShaved', 'personalBelongingsHandedOver', 'caseSheetReportsSent',
  'patientShiftedOnTrolleySafely',
  // Section B — transfer (5)
  'sideRailsSecured', 'oxygenSupportProvided', 'emergencyDrugsEquipmentAccompanied',
  'patientMonitoredDuringTransfer', 'handoverGivenToOtNurse',
  // Section C — OT receiving (15)
  'otrIdentityReconfirmed', 'otrSurgerySiteConfirmed', 'otrConsentVerified',
  'otrAllergyChecked', 'otrNbmReconfirmed', 'otrInvestigationsAvailable',
  'otrImplantsBloodConfirmed', 'otrVitalSignsChecked', 'otrIvAccessPatent',
  'otrPreOpMedicationsCompleted', 'otrSurgicalSiteMarkingVisible',
  'otrJewelleryDentureRemoved', 'otrFoleyCatheterDrainsChecked',
  'otrSkinPreparationAdequate', 'otrPatientShiftedToOtTableSafely',
] as const;

const CHECKLIST_TEXT = ['wardRemarks', 'transferRemarks', 'otReceivingRemarks'] as const;

async function requireSchedule(scheduleId: string) {
  return prisma.otSchedule.findUnique({ where: { id: scheduleId } });
}

async function ensureChecklistRow(scheduleId: string, createdBy: string | null) {
  const existing = await prisma.otWardToOtChecklist.findUnique({ where: { scheduleId } });
  if (existing) return existing;
  return prisma.otWardToOtChecklist.create({ data: { scheduleId, createdBy } });
}

// ─── GET ────────────────────────────────────────────────────────────────

export const getWardTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const row = await prisma.otWardToOtChecklist.findUnique({
      where: { scheduleId },
      include: {
        schedule: {
          select: {
            id: true, prn: true, patientName: true, procedureName: true,
            admissionId: true, plannedStart: true, surgeonName: true,
            otRoom: { select: { name: true } },
          },
        },
      },
    });
    // null is a legitimate "not started yet" state — return 200 with data:null.
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-ward-transfer] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch ward-transfer checklist' });
  }
};

// ─── PUT (upsert checklist items) ────────────────────────────────────────

export const upsertWardTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) {
      res.status(404).json({ message: 'OT schedule not found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    for (const key of CHECKLIST_BOOLEANS) {
      if (body[key] !== undefined) data[key] = !!body[key];
    }
    for (const key of CHECKLIST_TEXT) {
      if (body[key] !== undefined) data[key] = body[key] == null ? null : String(body[key]);
    }

    await ensureChecklistRow(scheduleId, req.user?.username ?? null);
    const row = await prisma.otWardToOtChecklist.update({
      where: { scheduleId },
      data,
    });

    await auditLog(req, {
      module: 'ot-ward-transfer',
      action: 'UPDATE',
      entityType: 'OtWardToOtChecklist',
      entityId: row.id,
      payload: { scheduleId, fieldsChanged: Object.keys(data).length },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-ward-transfer] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save ward-transfer checklist' });
  }
};

// ─── POST sign ───────────────────────────────────────────────────────────

interface SignBody {
  signatureId?: string;
  signerName?: string;
}

const VALID_ROLES = ['ward', 'ot-receiving'] as const;
type SignRole = typeof VALID_ROLES[number];

export const signWardTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const role = req.params.role as SignRole;
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    const body = (req.body ?? {}) as SignBody;
    if (!body.signatureId || !body.signerName?.trim()) {
      res.status(400).json({ message: 'signatureId and signerName are required' });
      return;
    }
    if (!(await requireSchedule(scheduleId))) {
      res.status(404).json({ message: 'OT schedule not found' });
      return;
    }
    await ensureChecklistRow(scheduleId, req.user?.username ?? null);

    const signerId = typeof req.user?.id === 'number' ? req.user.id : null;
    const data: Record<string, unknown> =
      role === 'ward'
        ? {
            wardNurseName: body.signerName.trim(),
            wardNurseSignedAt: new Date(),
            wardNurseSignedById: signerId,
            wardNurseSignatureId: body.signatureId,
            status: 'WARD_SIGNED',
          }
        : {
            otReceivingNurseName: body.signerName.trim(),
            otReceivingNurseSignedAt: new Date(),
            otReceivingNurseSignedById: signerId,
            otReceivingNurseSignatureId: body.signatureId,
            status: 'OT_RECEIVED',
          };

    const row = await prisma.otWardToOtChecklist.update({ where: { scheduleId }, data });

    await auditLog(req, {
      module: 'ot-ward-transfer',
      action: 'STATUS_CHANGE',
      entityType: 'OtWardToOtChecklist',
      entityId: row.id,
      payload: { scheduleId, role, status: row.status },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-ward-transfer] sign failed:', error);
    res.status(500).json({ message: 'Failed to record ward-transfer signature' });
  }
};

// ─── GET by admission (IPD-side entry point) ─────────────────────────────

// The ward nurse opens this from the IPD admission screen. An admission can
// have more than one OT schedule (multiple procedures), so we return all of
// them with their checklist status; the UI picks / lets the nurse choose.
export const listWardTransferByAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!admissionId) { res.status(400).json({ message: 'admissionId is required' }); return; }

    const schedules = await prisma.otSchedule.findMany({
      where: { admissionId },
      select: {
        id: true,
        prn: true,
        patientName: true,
        procedureName: true,
        status: true,
        plannedStart: true,
        surgeonName: true,
        otRoom: { select: { name: true } },
        wardTransferChecklist: {
          select: {
            id: true, status: true,
            wardNurseSignedAt: true, otReceivingNurseSignedAt: true,
          },
        },
      },
      orderBy: [{ plannedStart: 'desc' }],
    });
    res.status(200).json({ data: schedules });
  } catch (error) {
    console.error('[ot-ward-transfer] listByAdmission failed:', error);
    res.status(500).json({ message: 'Failed to list schedules for admission' });
  }
};
