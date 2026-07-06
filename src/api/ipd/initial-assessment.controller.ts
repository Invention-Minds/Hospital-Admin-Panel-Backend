import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { VALID_GLUCOSE_FREQUENCIES } from './insulin-infusion.controller';

/**
 * IPD Initial Assessment controller (Phase 1).
 *
 * One row per admission. The flow:
 *   1. M.O. / resident / registrar opens the form, fills sections, presses
 *      "Save draft" (status = DRAFT).
 *   2. When ready, M.O. signs → status = FILLED, filledAt / filledBy /
 *      filledBySignatureId stamped.
 *   3. Consultant co-signs → status = CONSULTANT_SIGNED, consultant fields
 *      stamped. Once consultant-signed the form is treated as immutable;
 *      further changes require a fresh re-assessment (handled by a
 *      separate flow, not this endpoint).
 *
 * Identity-and-audit: every state transition writes to AppAuditLog so the
 * NABH MRD.1 + AAC.4 trail is intact.
 */

interface UpsertBody {
  // Header
  department?: string | null;
  admittingConsultant?: string | null;

  // Allergies
  allergyNotKnown?: boolean;
  allergyDrug?: boolean;
  allergyFood?: boolean;
  allergyTransfusion?: boolean;
  allergyOthers?: string | null;

  // Presenting illness
  chiefComplaints?: string | null;
  presentingIllness?: string | null;

  // Personal history
  occupationStatus?: string | null;
  occupationDetails?: string | null;
  dietType?: string | null;
  bowelBladder?: string | null;
  sleep?: string | null;
  habits?: string | null;

  // Co-morbidities
  hasHypertension?: boolean;
  hypertensionSince?: string | null;
  hypertensionMeds?: string | null;
  hasDiabetes?: boolean;
  diabetesSince?: string | null;
  diabetesMeds?: string | null;
  hasCardiacDisease?: boolean;
  cardiacDiseaseSince?: string | null;
  cardiacDiseaseMeds?: string | null;
  hasWoundDischarge?: boolean;
  woundDischargeSince?: string | null;
  hasCopd?: boolean;
  copdSince?: string | null;
  hasThyroidDisorder?: boolean;
  thyroidDisorderSince?: string | null;
  hasCva?: boolean;
  cvaSince?: string | null;
  hasRecurrentInfection?: boolean;
  recurrentInfectionSince?: string | null;

  // Surgical / medication history
  surgicalHistory?: string | null;
  medicationHistory?: string | null;

  // OB/GYN
  isPregnant?: boolean;
  pregnancyWeeks?: number | null;
  isLactating?: boolean;
  lmp?: string | null;
  cycleRegular?: boolean | null;
  contraception?: boolean | null;
  discharge?: boolean | null;
  cervicalSmear?: boolean | null;
  immunization?: string | null;
  obPain?: boolean | null;
  menarche?: string | null;
  menopause?: string | null;
  menorrhagia?: boolean | null;
  obstetricHistory?: string | null;

  // Family history
  familyHistory?: string | null;

  // Geriatric ADL
  isGeriatric?: boolean;
  mentalStatus?: string | null;
  emotional?: string | null;
  communicationsSpeech?: string | null;
  mobility?: string | null;
  balance?: string | null;
  bowel?: string | null;
  bladder?: string | null;
  nutrition?: string | null;
  adl?: string | null;
  social?: string | null;
  hearing?: string | null;
  vision?: string | null;

  // Vitals
  vitalsTemp?: string | null;
  vitalsPulse?: string | null;
  vitalsBP?: string | null;
  vitalsRR?: string | null;
  vitalsWeight?: string | null;
  vitalsHeight?: string | null;
  painScore?: number | null;
  painLocation?: string | null;
  painDuration?: string | null;

  // General examination
  examPallor?: boolean;
  examEdema?: boolean;
  examClubbing?: boolean;
  examCyanosis?: boolean;
  examIcterus?: boolean;
  examEmaciated?: boolean;
  examBodyHabitus?: string | null;
  examPsychological?: string | null;
  examLymphNode?: string | null;
  examOthers?: string | null;

  // Systemic examination
  cvsNad?: boolean;
  cvsFindings?: string | null;
  entNad?: boolean;
  entFindings?: string | null;
  giNad?: boolean;
  giFindings?: string | null;
  mskNad?: boolean;
  mskFindings?: string | null;
  cnsNad?: boolean;
  cnsFindings?: string | null;
  respNad?: boolean;
  respFindings?: string | null;
  guNad?: boolean;
  guFindings?: string | null;
  hemNad?: boolean;
  hemFindings?: string | null;

  // Summary
  findings?: string | null;
  provisionalDiagnosis?: string | null;
  investigationsAdvised?: string | null;
  // Form 4 (Phase 8) — F-01 enclosure checkbox.
  previousInvestigationsEnclosed?: boolean;
  problems?: string | null;
  treatmentPlan?: string | null;
  otherSystems?: string | null;

  // Discharge planning
  needsSocialSupport?: boolean;
  needsHomeEquipment?: boolean;
  needsPhysiotherapy?: boolean;
  needsWoundCare?: boolean;
  otherDischargeNeeds?: string | null;

  // Phase 9.13 — doctor-ordered vitals monitoring frequency. NOT a column
  // on IpdInitialAssessment — it is pulled out and written to IpdAdmission.
  vitalsMonitoringFrequency?: string | null;

  // Phase 9.18 — doctor-ordered glucose monitoring frequency. Same handling
  // as vitals above: lives on IpdAdmission, not the assessment row.
  glucoseMonitoringFrequency?: string | null;
}

// Phase 9.13 — accepted monitoring-frequency codes.
export const VALID_MONITORING_FREQUENCIES = [
  'continuous', '1h', '2h', '4h', '6h', '8h', '12h', 'bd',
];

interface SignFilledBody {
  signatureId: string;
  signerName?: string;
}

interface SignConsultantBody {
  signatureId: string;
  consultantName?: string;
}

// ─── GET — fetch the assessment for an admission ────────────────────

export const getForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const row = await prisma.ipdInitialAssessment.findUnique({
      where: { admissionId },
    });
    // Return null (not 404) when absent — the editor uses null to render an
    // empty form for first-time fill.
    if (!row) { res.status(200).json(null); return; }
    // Phase 9.13 / 9.18 — vitals + glucose monitoring frequencies live on
    // IpdAdmission; merge them in so the assessment editor shows + edits the
    // current orders.
    const adm = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: { vitalsMonitoringFrequency: true, glucoseMonitoringFrequency: true },
    });
    res.status(200).json({
      ...row,
      vitalsMonitoringFrequency: adm?.vitalsMonitoringFrequency ?? null,
      glucoseMonitoringFrequency: adm?.glucoseMonitoringFrequency ?? null,
    });
  } catch (error) {
    console.error('[ipd-initial-assessment] getForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to load initial assessment' });
  }
};

// ─── Upsert — save draft / update fields ────────────────────────────

export const upsertForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as UpsertBody;

    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }

    const existing = await prisma.ipdInitialAssessment.findUnique({ where: { admissionId } });
    if (existing?.status === 'CONSULTANT_SIGNED') {
      res.status(409).json({
        error: 'Initial assessment is consultant-signed — raise a reassessment instead',
      });
      return;
    }

    // Strip undefined so Prisma doesn't try to clear fields the editor
    // didn't send (sections save individually).
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) data[key] = value;
    }

    // Phase 9.13 — vitalsMonitoringFrequency lives on IpdAdmission, not the
    // assessment. Pull it out of `data` and persist it on the admission.
    delete data['vitalsMonitoringFrequency'];
    if (body.vitalsMonitoringFrequency !== undefined) {
      const freq = body.vitalsMonitoringFrequency;
      if (freq !== null && !VALID_MONITORING_FREQUENCIES.includes(freq)) {
        res.status(400).json({ error: `vitalsMonitoringFrequency must be one of: ${VALID_MONITORING_FREQUENCIES.join(', ')}` });
        return;
      }
      await prisma.ipdAdmission.update({
        where: { id: admissionId },
        data: {
          vitalsMonitoringFrequency: freq,
          vitalsMonitoringSetBy: req.user?.username ?? null,
          vitalsMonitoringSetAt: new Date(),
        },
      });
    }

    // Phase 9.18 — glucose monitoring frequency also lives on IpdAdmission.
    delete data['glucoseMonitoringFrequency'];
    if (body.glucoseMonitoringFrequency !== undefined) {
      const gFreq = body.glucoseMonitoringFrequency;
      if (gFreq !== null && !VALID_GLUCOSE_FREQUENCIES.includes(gFreq)) {
        res.status(400).json({ error: `glucoseMonitoringFrequency must be one of: ${VALID_GLUCOSE_FREQUENCIES.join(', ')}` });
        return;
      }
      await prisma.ipdAdmission.update({
        where: { id: admissionId },
        data: {
          glucoseMonitoringFrequency: gFreq,
          glucoseMonitoringSetBy: req.user?.username ?? null,
          glucoseMonitoringSetAt: new Date(),
        },
      });
    }

    const row = await prisma.ipdInitialAssessment.upsert({
      where: { admissionId },
      update: {
        ...data,
        updatedBy: req.user?.username ?? null,
        updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      create: {
        admissionId,
        department: admission.department,
        admittingConsultant: admission.admittingDoctor,
        ...data,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    res.status(existing ? 200 : 201).json(row);
  } catch (error) {
    console.error('[ipd-initial-assessment] upsertForAdmission failed:', error);
    res.status(500).json({
      error: 'Failed to save initial assessment',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Sign (filler) ──────────────────────────────────────────────────

/**
 * POST /api/ipd/admission/:admissionId/initial-assessment/sign-filled
 *
 * Stamps the filler signature and flips status DRAFT → FILLED. The
 * consultant co-signs separately via /sign-consultant.
 */
export const signFilled = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as SignFilledBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }
    const existing = await prisma.ipdInitialAssessment.findUnique({ where: { admissionId } });
    if (!existing) {
      res.status(404).json({ error: 'Initial assessment not found — fill the form first' });
      return;
    }
    if (existing.status === 'CONSULTANT_SIGNED') {
      res.status(409).json({ error: 'Already consultant-signed' });
      return;
    }

    const updated = await prisma.ipdInitialAssessment.update({
      where: { admissionId },
      data: {
        filledByName: body.signerName ?? req.user?.username ?? null,
        filledById: typeof req.user?.id === 'number' ? req.user.id : null,
        filledBySignatureId: body.signatureId,
        filledAt: new Date(),
        status: existing.status === 'CONSULTANT_SIGNED' ? existing.status : 'FILLED',
      },
    });

    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdInitialAssessment',
      entityId: updated.id,
      payload: { admissionId, from: existing.status, to: 'FILLED' },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[ipd-initial-assessment] signFilled failed:', error);
    res.status(500).json({ error: 'Failed to sign as filler' });
  }
};

// ─── Sign (consultant) ──────────────────────────────────────────────

/**
 * POST /api/ipd/admission/:admissionId/initial-assessment/sign-consultant
 *
 * Stamps the consultant co-signature and flips status FILLED →
 * CONSULTANT_SIGNED. From this point the form is read-only.
 */
export const signConsultant = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as SignConsultantBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }
    const existing = await prisma.ipdInitialAssessment.findUnique({ where: { admissionId } });
    if (!existing) {
      res.status(404).json({ error: 'Initial assessment not found' });
      return;
    }
    if (existing.status !== 'FILLED') {
      res.status(409).json({
        error: `Consultant can only co-sign after the filler signs. Current status: ${existing.status}`,
      });
      return;
    }

    const updated = await prisma.ipdInitialAssessment.update({
      where: { admissionId },
      data: {
        consultantName: body.consultantName ?? req.user?.username ?? null,
        consultantId: typeof req.user?.id === 'number' ? req.user.id : null,
        consultantSignatureId: body.signatureId,
        consultantSignedAt: new Date(),
        status: 'CONSULTANT_SIGNED',
      },
    });

    await auditLog(req, {
      module: 'ipd',
      action: 'STATUS_CHANGE',
      entityType: 'IpdInitialAssessment',
      entityId: updated.id,
      payload: { admissionId, from: 'FILLED', to: 'CONSULTANT_SIGNED' },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[ipd-initial-assessment] signConsultant failed:', error);
    res.status(500).json({ error: 'Failed to sign as consultant' });
  }
};
