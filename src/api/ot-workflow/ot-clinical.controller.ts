import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 11 — OT clinical-record controllers.
 *
 * Routes (all under /api/ot/schedules/:scheduleId/...):
 *   POST/PUT  /pre-op            — pre-anaesthesia checklist (COP.13.b)
 *   POST      /safety/sign-in    — WHO sign-in (before induction)
 *   POST      /safety/time-out   — WHO time-out (before incision)
 *   POST      /safety/sign-out   — WHO sign-out (before leaving OT)  COP.14.d
 *   POST/PUT  /intra-op          — operative note + implants (COP.14.e / MOM.10.d)
 *   POST      /anaesthesia       — append a vital-trend tick (COP.13.e)
 *   GET       /anaesthesia       — fetch chart
 *   POST/PUT  /pacu              — PACU record
 *   POST      /pacu/vital        — append a PACU vital tick
 *   POST      /pacu/discharge    — sign-off PACU discharge with criteria
 *   POST/PUT  /outcome           — outcome row (PSQ.3 KPI feed)
 *
 * Field names mirror schema columns 1:1.
 */

// ─── Helpers ────────────────────────────────────────────────────────

async function requireSchedule(scheduleId: string) {
  const sch = await prisma.otSchedule.findUnique({ where: { id: scheduleId } });
  if (!sch) return null;
  return sch;
}

// ─── Pre-op checklist (COP.13.b) ────────────────────────────────────

interface UpsertPreOpBody {
  fasting?: boolean;
  fastingHours?: number;
  consentSignatureId?: string;
  groupTyped?: boolean;
  crossMatched?: boolean;
  bloodReservedUnits?: number;
  internalUnitsReserved?: number;
  externalUnitsReserved?: number;
  preOpHemoglobin?: number;
  surgeryClass?: string;
  anticipatedBloodLossMl?: number;
  antibioticPlanned?: boolean;
  antibioticName?: string;
  prophylaxisGiven?: boolean;
  surgicalSiteMarked?: boolean;
  allergiesReviewed?: boolean;
  allergiesNote?: string;
  fitnessCleared?: boolean;
  fitnessClearedBy?: string;
  preAnaesthesiaNotes?: string;
  signatureId?: string;
}

export const upsertPreOp = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const sch = await requireSchedule(scheduleId);
    if (!sch) { res.status(404).json({ error: 'OT schedule not found' }); return; }

    const body = req.body as UpsertPreOpBody;
    const data: Record<string, unknown> = {
      fasting: body.fasting ?? false,
      fastingHours: body.fastingHours ?? null,
      consentSignatureId: body.consentSignatureId ?? null,
      groupTyped: body.groupTyped ?? false,
      crossMatched: body.crossMatched ?? false,
      internalUnitsReserved: body.internalUnitsReserved ?? null,
      externalUnitsReserved: body.externalUnitsReserved ?? null,
      // Keep the legacy total in sync as internal + external.
      bloodReservedUnits:
        body.internalUnitsReserved != null || body.externalUnitsReserved != null
          ? (body.internalUnitsReserved ?? 0) + (body.externalUnitsReserved ?? 0)
          : body.bloodReservedUnits ?? null,
      preOpHemoglobin: body.preOpHemoglobin ?? null,
      surgeryClass: body.surgeryClass ?? null,
      anticipatedBloodLossMl: body.anticipatedBloodLossMl ?? null,
      antibioticPlanned: body.antibioticPlanned ?? false,
      antibioticName: body.antibioticName ?? null,
      prophylaxisGiven: body.prophylaxisGiven ?? false,
      surgicalSiteMarked: body.surgicalSiteMarked ?? false,
      allergiesReviewed: body.allergiesReviewed ?? false,
      allergiesNote: body.allergiesNote ?? null,
      fitnessCleared: body.fitnessCleared ?? false,
      fitnessClearedBy: body.fitnessClearedBy ?? null,
      preAnaesthesiaNotes: body.preAnaesthesiaNotes ?? null,
    };

    if (body.signatureId) {
      data['signatureId'] = body.signatureId;
      data['signedAt'] = new Date();
      data['signedBy'] = req.user?.username ?? null;
      data['signedById'] = typeof req.user?.id === 'number' ? req.user.id : null;
    }

    const upserted = await prisma.otPreOpChecklist.upsert({
      where: { scheduleId },
      create: { scheduleId, ...(data as object) } as Parameters<typeof prisma.otPreOpChecklist.create>[0]['data'],
      update: data,
    });

    await auditLog(req, {
      module: 'ot-pre-op',
      action: 'UPDATE',
      entityType: 'OtPreOpChecklist',
      entityId: upserted.id,
      payload: { scheduleId, signed: !!body.signatureId },
    });

    res.status(200).json(upserted);
  } catch (error) {
    console.error('[ot-clinical] upsertPreOp failed:', error);
    res.status(500).json({ error: 'Failed to save pre-op checklist' });
  }
};

// ─── WHO Surgical Safety Checklist (COP.14.d) ───────────────────────

interface SignInBody {
  patientIdentityConfirmed: boolean;
  siteMarked: boolean;
  anaesthesiaSafetyChecked: boolean;
  pulseOximeterFunctional: boolean;
  knownAllergies: boolean;
  difficultAirwayRisk: boolean;
  bloodLossRisk: boolean;
  signInBy: string;
  signInSignatureId: string;
  // Phase 9.1c — UHJ/OTS/F-01 sign-in additions
  consentConfirmed?: boolean;
  preopMedicationTaken?: boolean;
  anaesthEquipSpo2?: boolean;
  anaesthEquipNibp?: boolean;
  anaesthEquipEcg?: boolean;
  anaesthEquipBis?: boolean;
  hypothermiaRisk?: boolean;
  warmerInPlace?: boolean;
  equipmentImplantsAvailable?: boolean;
  allergyDescription?: string;
  bloodLossArrangement?: string;
  airwayRiskArrangement?: string;
  // Phase 9.12 — UHJ Nursing Safety Checklist sign-in additions
  fastingStatusConfirmed?: boolean;
  ivLineSecured?: boolean;
  bloodAvailabilityChecked?: boolean;
}

interface TimeOutBody {
  teamIntroduced: boolean;
  procedureConfirmed: boolean;
  antibioticAdministered: boolean;
  imagingDisplayed: boolean;
  criticalEventsAnticipated: boolean;
  timeOutBy: string;
  timeOutSignatureId: string;
  // Phase 9.1c — UHJ/OTS/F-01 time-out additions
  antibioticName?: string;
  vteProphylaxisProvided?: boolean;
  anticipatedDurationMins?: number;
  anticipatedBloodLossMl?: number;
  bloodAvailable?: boolean;
  glycemicControl?: string;
  sterilityConcerns?: string;
  anaesthetistConcerns?: string;
  // Phase 9.12 — UHJ Nursing Safety Checklist time-out additions
  correctPatientConfirmed?: boolean;
  correctSiteConfirmed?: boolean;
  sterilityConfirmed?: boolean;
  instrumentsAvailable?: boolean;
  spongeNeedleCountDone?: boolean;
}

interface SignOutBody {
  procedureRecordedName: string;
  swabCount: boolean;
  swabCountInitial?: number;
  swabCountFinal?: number;
  instrumentCount: boolean;
  instrumentCountInitial?: number;
  instrumentCountFinal?: number;
  specimenLabelled: boolean;
  equipmentIssues?: string;
  recoveryConcerns?: string;
  signOutBy: string;
  signOutSignatureId: string;
  // Phase 9.1c — UHJ/OTS/F-01 sign-out additions
  correctiveAction?: string;
  // Phase 9.12 — UHJ Nursing Safety Checklist sign-out additions
  procedureCompletedConfirmed?: boolean;
  postOpInstructionsGiven?: boolean;
  patientShiftedSafely?: boolean;
}

async function ensureSafetyRow(scheduleId: string) {
  const existing = await prisma.otSafetyChecklist.findUnique({ where: { scheduleId } });
  if (existing) return existing;
  return prisma.otSafetyChecklist.create({ data: { scheduleId } });
}

export const signIn = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }
    const body = req.body as SignInBody;
    if (!body.signInSignatureId || !body.signInBy) {
      res.status(400).json({ error: 'signInBy and signInSignatureId are required' });
      return;
    }
    await ensureSafetyRow(scheduleId);
    const updated = await prisma.otSafetyChecklist.update({
      where: { scheduleId },
      data: {
        patientIdentityConfirmed: body.patientIdentityConfirmed ?? false,
        siteMarked: body.siteMarked ?? false,
        anaesthesiaSafetyChecked: body.anaesthesiaSafetyChecked ?? false,
        pulseOximeterFunctional: body.pulseOximeterFunctional ?? false,
        knownAllergies: body.knownAllergies ?? false,
        difficultAirwayRisk: body.difficultAirwayRisk ?? false,
        bloodLossRisk: body.bloodLossRisk ?? false,
        // Phase 9.1c — F-01 additions
        ...(body.consentConfirmed !== undefined && { consentConfirmed: body.consentConfirmed }),
        ...(body.preopMedicationTaken !== undefined && { preopMedicationTaken: body.preopMedicationTaken }),
        ...(body.anaesthEquipSpo2 !== undefined && { anaesthEquipSpo2: body.anaesthEquipSpo2 }),
        ...(body.anaesthEquipNibp !== undefined && { anaesthEquipNibp: body.anaesthEquipNibp }),
        ...(body.anaesthEquipEcg !== undefined && { anaesthEquipEcg: body.anaesthEquipEcg }),
        ...(body.anaesthEquipBis !== undefined && { anaesthEquipBis: body.anaesthEquipBis }),
        ...(body.hypothermiaRisk !== undefined && { hypothermiaRisk: body.hypothermiaRisk }),
        ...(body.warmerInPlace !== undefined && { warmerInPlace: body.warmerInPlace }),
        ...(body.equipmentImplantsAvailable !== undefined && { equipmentImplantsAvailable: body.equipmentImplantsAvailable }),
        ...(body.allergyDescription !== undefined && { allergyDescription: body.allergyDescription }),
        ...(body.bloodLossArrangement !== undefined && { bloodLossArrangement: body.bloodLossArrangement }),
        ...(body.airwayRiskArrangement !== undefined && { airwayRiskArrangement: body.airwayRiskArrangement }),
        // Phase 9.12 — UHJ Nursing Safety Checklist additions
        ...(body.fastingStatusConfirmed !== undefined && { fastingStatusConfirmed: body.fastingStatusConfirmed }),
        ...(body.ivLineSecured !== undefined && { ivLineSecured: body.ivLineSecured }),
        ...(body.bloodAvailabilityChecked !== undefined && { bloodAvailabilityChecked: body.bloodAvailabilityChecked }),
        signInAt: new Date(),
        signInBy: body.signInBy,
        signInSignatureId: body.signInSignatureId,
      },
    });
    await auditLog(req, {
      module: 'ot-safety',
      action: 'UPDATE',
      entityType: 'OtSafetyChecklist',
      entityId: updated.id,
      payload: { scheduleId, stage: 'sign-in' },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-clinical] signIn failed:', error);
    res.status(500).json({ error: 'Failed to record WHO sign-in' });
  }
};

export const timeOut = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }
    const body = req.body as TimeOutBody;
    if (!body.timeOutSignatureId || !body.timeOutBy) {
      res.status(400).json({ error: 'timeOutBy and timeOutSignatureId are required' });
      return;
    }
    await ensureSafetyRow(scheduleId);
    const updated = await prisma.otSafetyChecklist.update({
      where: { scheduleId },
      data: {
        teamIntroduced: body.teamIntroduced ?? false,
        procedureConfirmed: body.procedureConfirmed ?? false,
        antibioticAdministered: body.antibioticAdministered ?? false,
        imagingDisplayed: body.imagingDisplayed ?? false,
        criticalEventsAnticipated: body.criticalEventsAnticipated ?? false,
        // Phase 9.1c — F-01 additions
        ...(body.antibioticName !== undefined && { antibioticName: body.antibioticName }),
        ...(body.vteProphylaxisProvided !== undefined && { vteProphylaxisProvided: body.vteProphylaxisProvided }),
        ...(body.anticipatedDurationMins !== undefined && { anticipatedDurationMins: body.anticipatedDurationMins }),
        ...(body.anticipatedBloodLossMl !== undefined && { anticipatedBloodLossMl: body.anticipatedBloodLossMl }),
        ...(body.bloodAvailable !== undefined && { bloodAvailable: body.bloodAvailable }),
        ...(body.glycemicControl !== undefined && { glycemicControl: body.glycemicControl }),
        ...(body.sterilityConcerns !== undefined && { sterilityConcerns: body.sterilityConcerns }),
        ...(body.anaesthetistConcerns !== undefined && { anaesthetistConcerns: body.anaesthetistConcerns }),
        // Phase 9.12 — UHJ Nursing Safety Checklist additions
        ...(body.correctPatientConfirmed !== undefined && { correctPatientConfirmed: body.correctPatientConfirmed }),
        ...(body.correctSiteConfirmed !== undefined && { correctSiteConfirmed: body.correctSiteConfirmed }),
        ...(body.sterilityConfirmed !== undefined && { sterilityConfirmed: body.sterilityConfirmed }),
        ...(body.instrumentsAvailable !== undefined && { instrumentsAvailable: body.instrumentsAvailable }),
        ...(body.spongeNeedleCountDone !== undefined && { spongeNeedleCountDone: body.spongeNeedleCountDone }),
        timeOutAt: new Date(),
        timeOutBy: body.timeOutBy,
        timeOutSignatureId: body.timeOutSignatureId,
      },
    });
    await auditLog(req, {
      module: 'ot-safety',
      action: 'UPDATE',
      entityType: 'OtSafetyChecklist',
      entityId: updated.id,
      payload: { scheduleId, stage: 'time-out' },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-clinical] timeOut failed:', error);
    res.status(500).json({ error: 'Failed to record WHO time-out' });
  }
};

// Phase 9.4b — Multi-role 4-signer chain endpoint.
// Roles: surgeon (legacy column) | anaesthetist | nurse | technician
// Phases: signIn | timeOut | signOut
// One endpoint handles 12 (phase × role) combos by writing to the right
// column triple. The existing signIn/timeOut/signOut endpoints stay
// (they target the surgeon-row in the legacy columns).

const VALID_SAFETY_PHASES = ['signIn', 'timeOut', 'signOut'] as const;
const VALID_SAFETY_ROLES = ['surgeon', 'anaesthetist', 'nurse', 'technician'] as const;
type SafetyPhase = typeof VALID_SAFETY_PHASES[number];
type SafetyRole = typeof VALID_SAFETY_ROLES[number];

interface SignSafetyRoleBody {
  signatureId: string;
  signerName: string;
}

/**
 * Returns the trio of column names that hold (at, by, signatureId) for
 * the given phase + role. Surgeon role uses the legacy single-signer
 * columns (signInAt / timeOutAt / signOutAt); other roles use the new
 * Phase 9.4b columns.
 */
function safetyColumnsFor(phase: SafetyPhase, role: SafetyRole): { atCol: string; byCol: string; sigCol: string } {
  if (role === 'surgeon') {
    return { atCol: `${phase}At`, byCol: `${phase}By`, sigCol: `${phase}SignatureId` };
  }
  const roleCap = role.charAt(0).toUpperCase() + role.slice(1);
  return {
    atCol: `${phase}${roleCap}At`,
    byCol: `${phase}${roleCap}By`,
    sigCol: `${phase}${roleCap}SignatureId`,
  };
}

export const signSafetyRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const phase = req.params.phase as SafetyPhase;
    const role = req.params.role as SafetyRole;
    if (!VALID_SAFETY_PHASES.includes(phase)) {
      res.status(400).json({ error: `phase must be one of: ${VALID_SAFETY_PHASES.join(', ')}` });
      return;
    }
    if (!VALID_SAFETY_ROLES.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${VALID_SAFETY_ROLES.join(', ')}` });
      return;
    }
    const body = req.body as SignSafetyRoleBody;
    if (!body.signatureId || !body.signerName?.trim()) {
      res.status(400).json({ error: 'signatureId and signerName are required' });
      return;
    }
    if (!(await requireSchedule(scheduleId))) {
      res.status(404).json({ error: 'OT schedule not found' });
      return;
    }
    // Ensure the safety row exists before stamping
    const existing = await prisma.otSafetyChecklist.findUnique({ where: { scheduleId } });
    if (!existing) await prisma.otSafetyChecklist.create({ data: { scheduleId } });

    const cols = safetyColumnsFor(phase, role);
    const updated = await prisma.otSafetyChecklist.update({
      where: { scheduleId },
      data: {
        [cols.atCol]: new Date(),
        [cols.byCol]: body.signerName.trim(),
        [cols.sigCol]: body.signatureId,
      } as Record<string, unknown>,
    });
    await auditLog(req, {
      module: 'ot-safety',
      action: 'STATUS_CHANGE',
      entityType: 'OtSafetyChecklist',
      entityId: updated.id,
      payload: { scheduleId, phase, role },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-clinical] signSafetyRole failed:', error);
    res.status(500).json({ error: 'Failed to record safety signature' });
  }
};

export const signOut = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }
    const body = req.body as SignOutBody;
    if (!body.signOutSignatureId || !body.signOutBy) {
      res.status(400).json({ error: 'signOutBy and signOutSignatureId are required' });
      return;
    }
    // Refuse sign-out unless swab + instrument counts match (NABH safety rule).
    if (!body.swabCount || !body.instrumentCount) {
      res.status(400).json({
        error: 'Swab count and instrument count must both match before sign-out can be recorded',
      });
      return;
    }
    await ensureSafetyRow(scheduleId);
    const updated = await prisma.otSafetyChecklist.update({
      where: { scheduleId },
      data: {
        procedureRecordedName: body.procedureRecordedName,
        swabCount: true,
        swabCountInitial: body.swabCountInitial ?? null,
        swabCountFinal: body.swabCountFinal ?? null,
        instrumentCount: true,
        instrumentCountInitial: body.instrumentCountInitial ?? null,
        instrumentCountFinal: body.instrumentCountFinal ?? null,
        specimenLabelled: body.specimenLabelled ?? false,
        equipmentIssues: body.equipmentIssues ?? null,
        recoveryConcerns: body.recoveryConcerns ?? null,
        // Phase 9.1c — F-01 addition
        ...(body.correctiveAction !== undefined && { correctiveAction: body.correctiveAction }),
        // Phase 9.12 — UHJ Nursing Safety Checklist additions
        ...(body.procedureCompletedConfirmed !== undefined && { procedureCompletedConfirmed: body.procedureCompletedConfirmed }),
        ...(body.postOpInstructionsGiven !== undefined && { postOpInstructionsGiven: body.postOpInstructionsGiven }),
        ...(body.patientShiftedSafely !== undefined && { patientShiftedSafely: body.patientShiftedSafely }),
        signOutAt: new Date(),
        signOutBy: body.signOutBy,
        signOutSignatureId: body.signOutSignatureId,
      },
    });
    await auditLog(req, {
      module: 'ot-safety',
      action: 'UPDATE',
      entityType: 'OtSafetyChecklist',
      entityId: updated.id,
      payload: { scheduleId, stage: 'sign-out' },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-clinical] signOut failed:', error);
    res.status(500).json({ error: 'Failed to record WHO sign-out' });
  }
};

// ─── Intra-op note (COP.14.e + MOM.10.d implants) ───────────────────

interface UpsertIntraOpBody {
  startAt: string;
  endAt?: string;
  anaesthesiaType?: string;
  surgeons?: string;
  findings?: string;
  procedureDone?: string;
  bloodLossMl?: number;
  fluidsMl?: number;
  complications?: string;
  implants?: Array<{ name: string; batch: string; serial?: string; manufacturer?: string }>;
  signatureId?: string;
  // Phase 9.1c — Operative Note (UHJ/OTS/F-03) extensions
  noteNumber?: number;
  templateId?: string | null;
  caseType?: 'emergency' | 'routine' | 'unplanned-return' | null;
  assistants?: Array<{ name: string; role?: string }>;
  preOpDiagnosis?: string;
  postOpDiagnosis?: string;
  postOpDiagnosisSame?: boolean;
  materialToLabHpe?: string;
  materialToLabCis?: string;
  materialToLabOthers?: string;
  materialToSecurityMlc?: string;
  drains?: string;
  prosthesisLabel?: string;
  significantIntraOpEvent?: string;
  position?: string;
  incision?: string;
  procedureSteps?: string;
  incisionAt?: string;
  woundClosureAt?: string;
  woundClosureDone?: boolean;
  skinClosureDone?: boolean;
  spongeInstrumentCountVerified?: boolean;
  disposition?: 'icu' | 'patient-room' | 'home' | null;
}

export const upsertIntraOp = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }

    const body = req.body as UpsertIntraOpBody;
    if (!body.startAt) {
      res.status(400).json({ error: 'startAt is required' });
      return;
    }

    const data: Record<string, unknown> = {
      startAt: new Date(body.startAt),
      endAt: body.endAt ? new Date(body.endAt) : null,
      anaesthesiaType: body.anaesthesiaType ?? null,
      surgeons: body.surgeons ?? null,
      findings: body.findings ?? null,
      procedureDone: body.procedureDone ?? null,
      bloodLossMl: body.bloodLossMl ?? null,
      fluidsMl: body.fluidsMl ?? null,
      complications: body.complications ?? null,
      implants: body.implants ? JSON.stringify(body.implants) : null,
      // Phase 9.1c — F-03 fields. Only set when caller provides them so
      // partial updates don't wipe other sections.
      ...(body.templateId !== undefined && { templateId: body.templateId }),
      ...(body.caseType !== undefined && { caseType: body.caseType }),
      ...(body.assistants !== undefined && { assistants: JSON.stringify(body.assistants) }),
      ...(body.preOpDiagnosis !== undefined && { preOpDiagnosis: body.preOpDiagnosis }),
      ...(body.postOpDiagnosis !== undefined && { postOpDiagnosis: body.postOpDiagnosis }),
      ...(body.postOpDiagnosisSame !== undefined && { postOpDiagnosisSame: body.postOpDiagnosisSame }),
      ...(body.materialToLabHpe !== undefined && { materialToLabHpe: body.materialToLabHpe }),
      ...(body.materialToLabCis !== undefined && { materialToLabCis: body.materialToLabCis }),
      ...(body.materialToLabOthers !== undefined && { materialToLabOthers: body.materialToLabOthers }),
      ...(body.materialToSecurityMlc !== undefined && { materialToSecurityMlc: body.materialToSecurityMlc }),
      ...(body.drains !== undefined && { drains: body.drains }),
      ...(body.prosthesisLabel !== undefined && { prosthesisLabel: body.prosthesisLabel }),
      ...(body.significantIntraOpEvent !== undefined && { significantIntraOpEvent: body.significantIntraOpEvent }),
      ...(body.position !== undefined && { position: body.position }),
      ...(body.incision !== undefined && { incision: body.incision }),
      ...(body.procedureSteps !== undefined && { procedureSteps: body.procedureSteps }),
      ...(body.incisionAt !== undefined && { incisionAt: body.incisionAt ? new Date(body.incisionAt) : null }),
      ...(body.woundClosureAt !== undefined && { woundClosureAt: body.woundClosureAt ? new Date(body.woundClosureAt) : null }),
      ...(body.woundClosureDone !== undefined && { woundClosureDone: body.woundClosureDone }),
      ...(body.skinClosureDone !== undefined && { skinClosureDone: body.skinClosureDone }),
      ...(body.spongeInstrumentCountVerified !== undefined && { spongeInstrumentCountVerified: body.spongeInstrumentCountVerified }),
      ...(body.disposition !== undefined && { disposition: body.disposition }),
    };
    if (body.signatureId) {
      data['signatureId'] = body.signatureId;
      data['signedAt'] = new Date();
      data['signedBy'] = req.user?.username ?? null;
      data['signedById'] = typeof req.user?.id === 'number' ? req.user.id : null;
    }

    // Phase 9.1c — scheduleId is no longer unique on OtIntraOpNote; we
    // upsert by composite (scheduleId, noteNumber). Body can specify
    // noteNumber explicitly (when adding Op Note 2/3 for a multi-surgery
    // session); defaults to 1, preserving the legacy single-note contract.
    const noteNumber = typeof (body as { noteNumber?: number }).noteNumber === 'number'
      ? (body as { noteNumber: number }).noteNumber
      : 1;
    const upserted = await prisma.otIntraOpNote.upsert({
      where: { scheduleId_noteNumber: { scheduleId, noteNumber } },
      create: { scheduleId, noteNumber, ...(data as object) } as Parameters<typeof prisma.otIntraOpNote.create>[0]['data'],
      update: data,
    });

    await auditLog(req, {
      module: 'ot-intra-op',
      action: 'UPDATE',
      entityType: 'OtIntraOpNote',
      entityId: upserted.id,
      payload: { scheduleId, implantsCount: body.implants?.length ?? 0, signed: !!body.signatureId },
    });

    res.status(200).json(upserted);
  } catch (error) {
    console.error('[ot-clinical] upsertIntraOp failed:', error);
    res.status(500).json({ error: 'Failed to save intra-op note' });
  }
};

// ─── Anaesthesia chart (COP.13.e — append-only) ─────────────────────

interface AppendAnaesthesiaTickBody {
  hr?: number;
  sbp?: number;
  dbp?: number;
  spo2?: number;
  etco2?: number;
  drugs?: string;
  fluids?: string;
  remarks?: string;
  recordedBy?: string;
}

export const appendAnaesthesiaTick = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }
    const body = req.body as AppendAnaesthesiaTickBody;
    const created = await prisma.otAnaesthesiaChart.create({
      data: {
        scheduleId,
        hr: body.hr ?? null,
        sbp: body.sbp ?? null,
        dbp: body.dbp ?? null,
        spo2: body.spo2 ?? null,
        etco2: body.etco2 ?? null,
        drugs: body.drugs ?? null,
        fluids: body.fluids ?? null,
        remarks: body.remarks ?? null,
        recordedBy: body.recordedBy ?? req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[ot-clinical] appendAnaesthesiaTick failed:', error);
    res.status(500).json({ error: 'Failed to append anaesthesia tick' });
  }
};

export const getAnaesthesiaChart = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const rows = await prisma.otAnaesthesiaChart.findMany({
      where: { scheduleId },
      orderBy: { timestamp: 'asc' },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[ot-clinical] getAnaesthesiaChart failed:', error);
    res.status(500).json({ error: 'Failed to fetch anaesthesia chart' });
  }
};

// ─── PACU record + vitals + criteria-based discharge ────────────────

interface UpsertPacuBody {
  arrivalAt?: string;
  arrivalHr?: number;
  arrivalSbp?: number;
  arrivalDbp?: number;
  arrivalSpo2?: number;
  arrivalRr?: number;
  arrivalTemp?: number;
  arrivalGcs?: number;
  painScore?: number;
  dischargeCriteria?: unknown; // JSON
}

interface PacuVitalBody {
  hr?: number;
  sbp?: number;
  dbp?: number;
  spo2?: number;
  rr?: number;
  temp?: number;
  painScore?: number;
}

interface PacuDischargeBody {
  dischargedTo: 'ward' | 'icu' | 'home' | 'expired';
  dischargedToWardId?: string;
  dischargedToBedId?: string;
  dischargeCriteriaMet: boolean;
  signatureId: string;
}

export const upsertPacu = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }
    const body = req.body as UpsertPacuBody;
    const data: Record<string, unknown> = {
      arrivalAt: body.arrivalAt ? new Date(body.arrivalAt) : null,
      arrivalHr: body.arrivalHr ?? null,
      arrivalSbp: body.arrivalSbp ?? null,
      arrivalDbp: body.arrivalDbp ?? null,
      arrivalSpo2: body.arrivalSpo2 ?? null,
      arrivalRr: body.arrivalRr ?? null,
      arrivalTemp: body.arrivalTemp ?? null,
      arrivalGcs: body.arrivalGcs ?? null,
      painScore: body.painScore ?? null,
      dischargeCriteria: body.dischargeCriteria !== undefined ? JSON.stringify(body.dischargeCriteria) : null,
    };
    const upserted = await prisma.pacuRecord.upsert({
      where: { scheduleId },
      create: { scheduleId, ...(data as object) } as Parameters<typeof prisma.pacuRecord.create>[0]['data'],
      update: data,
    });
    res.status(200).json(upserted);
  } catch (error) {
    console.error('[ot-clinical] upsertPacu failed:', error);
    res.status(500).json({ error: 'Failed to save PACU record' });
  }
};

export const appendPacuVital = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const pacu = await prisma.pacuRecord.findUnique({ where: { scheduleId } });
    if (!pacu) {
      res.status(404).json({ error: 'PACU record not found — call upsertPacu first' });
      return;
    }
    const body = req.body as PacuVitalBody;
    const created = await prisma.pacuVital.create({
      data: {
        pacuRecordId: pacu.id,
        hr: body.hr ?? null,
        sbp: body.sbp ?? null,
        dbp: body.dbp ?? null,
        spo2: body.spo2 ?? null,
        rr: body.rr ?? null,
        temp: body.temp ?? null,
        painScore: body.painScore ?? null,
        recordedBy: req.user?.username ?? null,
      },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[ot-clinical] appendPacuVital failed:', error);
    res.status(500).json({ error: 'Failed to append PACU vital' });
  }
};

export const dischargeFromPacu = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const body = req.body as PacuDischargeBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }
    if (!body.dischargeCriteriaMet) {
      res.status(400).json({ error: 'dischargeCriteriaMet must be true to release patient from PACU' });
      return;
    }
    const pacu = await prisma.pacuRecord.findUnique({ where: { scheduleId } });
    if (!pacu) {
      res.status(404).json({ error: 'PACU record not found' });
      return;
    }
    const updated = await prisma.pacuRecord.update({
      where: { scheduleId },
      data: {
        dischargedAt: new Date(),
        dischargedTo: body.dischargedTo,
        dischargedToWardId: body.dischargedToWardId ?? null,
        dischargedToBedId: body.dischargedToBedId ?? null,
        dischargeCriteriaMet: true,
        signedBy: req.user?.username ?? null,
        signedById: typeof req.user?.id === 'number' ? req.user.id : null,
        signatureId: body.signatureId,
      },
    });
    await auditLog(req, {
      module: 'ot-pacu',
      action: 'STATUS_CHANGE',
      entityType: 'PacuRecord',
      entityId: updated.id,
      payload: { scheduleId, dischargedTo: body.dischargedTo },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-clinical] dischargeFromPacu failed:', error);
    res.status(500).json({ error: 'Failed to discharge from PACU' });
  }
};

// ─── Outcome (PSQ.3 KPI feed) ───────────────────────────────────────

interface UpsertOutcomeBody {
  unplannedReturn?: boolean;
  linkedScheduleId?: string;
  surgicalSiteInfection?: boolean;
  ssiDetectedAt?: string;
  ssiOrganism?: string;
  ssiClassification?: 'superficial' | 'deep' | 'organ-space';
  mortality?: boolean;
  mortalityCause?: string;
  lengthOfStayDays?: number;
  followUpNotes?: string;
}

export const upsertOutcome = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!(await requireSchedule(scheduleId))) { res.status(404).json({ error: 'OT schedule not found' }); return; }
    const body = req.body as UpsertOutcomeBody;
    const data: Record<string, unknown> = {
      unplannedReturn: body.unplannedReturn ?? false,
      linkedScheduleId: body.linkedScheduleId ?? null,
      surgicalSiteInfection: body.surgicalSiteInfection ?? false,
      ssiDetectedAt: body.ssiDetectedAt ? new Date(body.ssiDetectedAt) : null,
      ssiOrganism: body.ssiOrganism ?? null,
      ssiClassification: body.ssiClassification ?? null,
      mortality: body.mortality ?? false,
      mortalityCause: body.mortalityCause ?? null,
      lengthOfStayDays: body.lengthOfStayDays ?? null,
      followUpNotes: body.followUpNotes ?? null,
      recordedBy: req.user?.username ?? null,
      recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
    };
    const upserted = await prisma.otOutcome.upsert({
      where: { scheduleId },
      create: { scheduleId, ...(data as object) } as Parameters<typeof prisma.otOutcome.create>[0]['data'],
      update: data,
    });
    await auditLog(req, {
      module: 'ot-outcome',
      action: 'UPDATE',
      entityType: 'OtOutcome',
      entityId: upserted.id,
      payload: {
        scheduleId,
        unplannedReturn: body.unplannedReturn ?? false,
        ssi: body.surgicalSiteInfection ?? false,
      },
    });
    res.status(200).json(upserted);
  } catch (error) {
    console.error('[ot-clinical] upsertOutcome failed:', error);
    res.status(500).json({ error: 'Failed to save outcome' });
  }
};
