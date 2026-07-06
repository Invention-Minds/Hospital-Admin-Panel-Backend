import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 2 — Consent controller.
 *
 * Endpoints:
 *   GET  /api/consent/forms                              — list active forms
 *   GET  /api/consent/forms/:type/:language?             — get one (defaults to language=en)
 *   POST /api/consent/sign                               — capture a signed consent
 *   GET  /api/consent/by-context/:contextType/:contextId — list signatures linked to a target
 *
 * Signing reuses Phase 0 SignatureBlob — the frontend captures the signature
 * via <app-e-sign>, gets back a SignatureBlob id, and posts that id here.
 */

const VALID_CONSENT_TYPES = [
  'admission',
  'treatment',
  'anaesthesia',
  'blood',
  'financial',
  'photography',
  'high-risk',
  'research',
  'end-of-life',
];

const VALID_STATUSES = ['SIGNED', 'DEFERRED', 'REFUSED', 'WITHDRAWN'];

interface SignBody {
  formId: string;
  consentType?: string;        // duplicated for fast indexing; will be derived from form if omitted
  contextType?: string;        // "admission" | "ot-schedule" | "transfusion" | etc.
  contextId?: string | number;
  patientPrn?: number;
  patientName?: string;

  patientSignatureId?: string;
  attenderSignatureId?: string;
  attenderName?: string;
  attenderRelation?: string;
  witnessSignatureId?: string;
  witnessName?: string;

  status?: string;
  deferredReason?: string;
  refusedReason?: string;
}

/** GET /api/consent/forms — list all active forms (frontend caches by type+language). */
export const listForms = async (req: Request, res: Response): Promise<void> => {
  try {
    const language = (req.query.language as string | undefined)?.trim() || undefined;
    const consentType = (req.query.consentType as string | undefined)?.trim() || undefined;
    const forms = await prisma.consentForm.findMany({
      where: {
        isActive: true,
        ...(language ? { language } : {}),
        ...(consentType ? { consentType } : {}),
      },
      orderBy: [{ consentType: 'asc' }, { language: 'asc' }],
    });
    res.status(200).json(forms);
  } catch (error) {
    console.error('[consent] listForms failed:', error);
    res.status(500).json({ error: 'Failed to list consent forms' });
  }
};

/**
 * GET /api/consent/forms/:type/:language?
 * Falls back to English if the requested language is not available.
 */
export const getForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const consentType = req.params.type;
    const language = (req.params.language || 'en').trim();

    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      res.status(400).json({ error: `consentType must be one of: ${VALID_CONSENT_TYPES.join(', ')}` });
      return;
    }

    let form = await prisma.consentForm.findFirst({
      where: { consentType, language, isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!form && language !== 'en') {
      // Fallback to English so the staff is never blocked.
      form = await prisma.consentForm.findFirst({
        where: { consentType, language: 'en', isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      });
    }
    if (!form) {
      res.status(404).json({ error: `No active consent form for type=${consentType}` });
      return;
    }
    res.status(200).json(form);
  } catch (error) {
    console.error('[consent] getForm failed:', error);
    res.status(500).json({ error: 'Failed to fetch consent form' });
  }
};

/** POST /api/consent/sign — record a signed consent. */
export const signConsent = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as SignBody;

    if (!body.formId) {
      res.status(400).json({ error: 'formId is required' });
      return;
    }

    const form = await prisma.consentForm.findUnique({ where: { id: body.formId } });
    if (!form) {
      res.status(404).json({ error: 'Consent form not found' });
      return;
    }
    if (!form.isActive) {
      res.status(400).json({ error: 'Cannot sign an inactive consent form version' });
      return;
    }

    const status = body.status?.trim().toUpperCase() || 'SIGNED';
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    // Status-conditional validation.
    if (status === 'SIGNED') {
      if (!body.patientSignatureId && !body.attenderSignatureId) {
        res.status(400).json({ error: 'At least one of patientSignatureId or attenderSignatureId is required when status=SIGNED' });
        return;
      }
      if (form.requiresWitness && !body.witnessSignatureId) {
        res.status(400).json({ error: 'This consent form requires a witness signature' });
        return;
      }
    } else if (status === 'DEFERRED' && !body.deferredReason) {
      res.status(400).json({ error: 'deferredReason is required when status=DEFERRED' });
      return;
    } else if (status === 'REFUSED' && !body.refusedReason) {
      res.status(400).json({ error: 'refusedReason is required when status=REFUSED' });
      return;
    }

    const now = new Date();

    const created = await prisma.consentSignature.create({
      data: {
        formId: form.id,
        consentType: form.consentType,
        version: form.version,
        language: form.language,

        contextType: body.contextType?.trim(),
        contextId: body.contextId != null ? String(body.contextId).trim() : undefined,

        patientPrn: typeof body.patientPrn === 'number' ? body.patientPrn : undefined,
        patientName: body.patientName?.trim(),

        patientSignatureId: body.patientSignatureId?.trim(),
        patientSignedAt: body.patientSignatureId ? now : undefined,

        attenderSignatureId: body.attenderSignatureId?.trim(),
        attenderName: body.attenderName?.trim(),
        attenderRelation: body.attenderRelation?.trim(),
        attenderSignedAt: body.attenderSignatureId ? now : undefined,

        witnessSignatureId: body.witnessSignatureId?.trim(),
        witnessName: body.witnessName?.trim(),
        witnessSignedAt: body.witnessSignatureId ? now : undefined,

        status,
        deferredReason: body.deferredReason?.trim(),
        refusedReason: body.refusedReason?.trim(),

        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await auditLog(req, {
      module: 'consent',
      action: status === 'SIGNED' ? 'SIGN' : 'STATUS_CHANGE',
      entityType: 'ConsentSignature',
      entityId: created.id,
      payload: {
        consentType: created.consentType,
        version: created.version,
        contextType: created.contextType,
        contextId: created.contextId,
        status: created.status,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('[consent] signConsent failed:', error);
    res.status(500).json({ error: 'Failed to record consent signature' });
  }
};

/**
 * GET /api/consent/by-context/:contextType/:contextId
 * Returns all signed consents linked to a particular admission / OT / transfusion / etc.
 * Used by the audit / patient-timeline view.
 */
export const listByContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const { contextType, contextId } = req.params;
    if (!contextType || !contextId) {
      res.status(400).json({ error: 'contextType and contextId are required' });
      return;
    }
    const rows = await prisma.consentSignature.findMany({
      where: { contextType, contextId },
      orderBy: { signedAt: 'asc' },
      include: { form: true },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[consent] listByContext failed:', error);
    res.status(500).json({ error: 'Failed to list consent signatures' });
  }
};

/** GET /api/consent/by-patient/:prn — every consent ever signed by a patient. */
export const listByPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const prn = Number(req.params.prn);
    if (!Number.isFinite(prn)) {
      res.status(400).json({ error: 'prn must be numeric' });
      return;
    }
    const rows = await prisma.consentSignature.findMany({
      where: { patientPrn: prn },
      orderBy: { signedAt: 'desc' },
      include: { form: true },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[consent] listByPatient failed:', error);
    res.status(500).json({ error: 'Failed to list consents for patient' });
  }
};
