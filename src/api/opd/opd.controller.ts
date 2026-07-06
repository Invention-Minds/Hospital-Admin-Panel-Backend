import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { convertOpdToIpd } from '../conversion/opd-to-ipd';
import { proposeFromOpd } from '../conversion/opd-refer-for-admission';
import { getClinicalActor, stripAuditFields } from '../../middleware/audit-guard';
import { auditLog } from '../../service/app-audit';
import { snapshotTemplateFields } from '../note-template/note-template.controller';
import { generateTemplatedOpdDraft, OpdFieldDef } from '../../service/opd-assessment-ai';
import { raiseByRule } from '../incident/rule-catalogue';

// Phase 9.21 — AI auto-fill of an OPD note template from the doctor's dictation.
// POST /api/opd/ai-draft  body: { noteTemplateId, dictation, header? }
export const aiDraftOpd = async (req: Request, res: Response): Promise<void> => {
  try {
    const { noteTemplateId, dictation, header } = req.body as {
      noteTemplateId?: string;
      dictation?: string;
      header?: { name?: string | null; age?: string | null; gender?: string | null; vitals?: string | null };
    };
    if (!noteTemplateId) { res.status(400).json({ error: 'noteTemplateId is required' }); return; }
    if (!dictation || !dictation.trim()) { res.status(400).json({ error: 'dictation is required' }); return; }

    const template = await prisma.noteTemplate.findUnique({ where: { id: noteTemplateId } });
    if (!template) { res.status(404).json({ error: 'Template not found' }); return; }

    let fields: OpdFieldDef[] = [];
    try { fields = JSON.parse(template.fields); } catch { fields = []; }
    if (!Array.isArray(fields) || fields.length === 0) {
      res.status(400).json({ error: 'Template has no fillable fields' });
      return;
    }

    const draft = await generateTemplatedOpdDraft(dictation, { name: template.name, fields }, header);

    await auditLog(req, {
      module: 'opd-assessment', action: 'UPDATE', entityType: 'NoteTemplate',
      entityId: template.id, payload: { aiDraft: true, model: draft.modelVersion },
    });

    res.status(200).json(draft);
  } catch (error) {
    console.error('[opd] aiDraftOpd failed:', error);
    res.status(500).json({ error: 'Failed to generate AI draft' });
  }
};

export const createOpdAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = getClinicalActor(req, res);
      if (actorId === null) return;

      // Note-template snapshot path. When the doctor used a template, snapshot
      // its fields[] now (OPD has no separate "sign" step like discharge does
      // — save IS the lock). The `templatedValues` JSON column stores
      // `{_schema, _values}` so prints stay stable even if the live template
      // changes later.
      const noteTemplateId: string | undefined = req.body.noteTemplateId || undefined;
      const templatedValueMap: Record<string, unknown> | undefined = req.body.templatedValueMap;
      let templatedValues: string | undefined;
      if (noteTemplateId && templatedValueMap) {
        const fieldDefs = await snapshotTemplateFields(noteTemplateId);
        templatedValues = JSON.stringify({
          _schema: fieldDefs ?? [],
          _values: templatedValueMap,
        });
      }

      const data = {
        name: req.body.patientName,
        age: req.body.age.toString(),
        gender: req.body.gender,
        uhId: req.body.uhid,
        date: req.body.date,
        consultant: req.body.consultant,
        department: req.body.department,
        assessmentTime: req.body.assessmentTime,
        height: req.body.height,
        weight: req.body.weight,

        hr: req.body.hr,
        rr: req.body.rr,
        pulse: req.body.pulse,
        bp: req.body.bp,
        temp: req.body.temp,
        spo2: req.body.spo2,

        oralDiet: req.body.dietType,
        enteralFeed: req.body.enteralFeed,
        npo: req.body.npo,
        allergies: req.body.allergies,
        painScore: req.body.painScore,
        screeningReq: req.body.otherScreening,
        implantCounsel: req.body.counsellingImplants,

        history: req.body.history,
        examination: req.body.examination,
        investigation: req.body.investigation,
        treatmentPlan: req.body.treatmentPlan,

        doctorSealSign: req.body.doctorSign,
        doctorName: req.body.doctorName,
        kmcNo: req.body.kmcNo,
        staffName: req.body.staffName,
        staffEmpId: req.body.staffEmpId,
        appointmentId: req.body.appointmentId ? Number(req.body.appointmentId) : null,
        createdBy: actorId, // OPDAssessment.createdBy is Int — store JWT id

        // Templated path columns
        noteTemplateId: noteTemplateId ?? null,
        templatedValues: templatedValues ?? null,
      };

      const opd = await prisma.oPDAssessment.create({ data });
      res.status(200).json(opd);

      // Phase 9.24 — auto-incident: OPD saved with no clinical narrative
      // (neither legacy hand-written sections nor a filled template).
      const hasHandwritten = Boolean(req.body.history || req.body.examination || req.body.treatmentPlan);
      const hasTemplate = Boolean(noteTemplateId && templatedValues);
      if (!hasHandwritten && !hasTemplate) {
        raiseByRule('OPD_ASSESSMENT_MISSING_REQUIRED_FIELD', {
          patientName: req.body.patientName ?? null,
          appointmentId: req.body.appointmentId ? Number(req.body.appointmentId) : null,
          department: req.body.department ?? null,
          extras: { uhid: req.body.uhId, opdAssessmentId: opd.id },
        }).catch(() => { /* hooks are best-effort */ });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Error creating OPD assessment' });
    }
  };
  
  

export const getOpdAssessmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const opd = await prisma.oPDAssessment.findFirst({
      where: { appointmentId: Number(req.params.appointmentId) }
    });
    res.status(200).json(opd);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error fetching OPD assessment' });
  }
};

export const updateOpdAssessment = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    // Re-snapshot the template at every update so any new field defs the
    // admin published while the doctor was editing get baked in. (For OPD,
    // every save is a "lock" — no separate sign step.)
    const noteTemplateId: string | undefined = req.body.noteTemplateId || undefined;
    const templatedValueMap: Record<string, unknown> | undefined = req.body.templatedValueMap;

    const data = stripAuditFields({ ...req.body }) as Record<string, unknown>;
    // The frontend sends `templatedValueMap` (a Record), not the LongText
    // column directly — strip it from the spread, build the JSON ourselves.
    delete data['templatedValueMap'];

    if (noteTemplateId && templatedValueMap) {
      const fieldDefs = await snapshotTemplateFields(noteTemplateId);
      data['noteTemplateId'] = noteTemplateId;
      data['templatedValues'] = JSON.stringify({
        _schema: fieldDefs ?? [],
        _values: templatedValueMap,
      });
    }

    const updated = await prisma.oPDAssessment.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error updating OPD assessment' });
  }
};

export const deleteOpdAssessment = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.oPDAssessment.delete({
      where: { id: Number(req.params.id) }
    });
    res.status(200).json({ message: 'OPD assessment deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error deleting OPD assessment' });
  }
};
export const getOpdByAppointmentId = async (req: Request, res: Response): Promise<void> => {
    try {
      const opd = await prisma.oPDAssessment.findFirst({
        where: { appointmentId: Number(req.params.appointmentId) }
      });

      if (!opd) {
        res.status(200).json(null); // Return null if no record exists
        return;
      }

      res.status(200).json(opd);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Error fetching OPD assessment' });
    }
  };

/**
 * Admit OPD patient to IPD
 * Converts OPD appointment to IPD admission, carries forward prescriptions and investigations
 */
/**
 * Phase 3 (WF-2) — Refer this OPD patient for admission.
 *
 * Creates a PROPOSED IpdAdmission + a REQUESTED IpdBedRequest. The bed-request
 * lands in the NS acceptance queue; nothing flips to 'admitted' until the full
 * handshake completes (NS accept → bedside attender accept).
 */
export const referForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      appointmentId,
      diagnosis,
      urgency,
      preferredBedType,
      preferredWardId,
      admittingDoctorId,
      admittingDoctorName,
      admissionType,
    } = req.body as {
      appointmentId: number | string;
      diagnosis: string;
      urgency?: 'routine' | 'urgent' | 'emergency';
      preferredBedType?: string;
      preferredWardId?: string;
      admittingDoctorId?: number | null;
      admittingDoctorName: string;
      admissionType?: string;
    };

    const apptId = typeof appointmentId === 'string' ? parseInt(appointmentId, 10) : appointmentId;
    if (!apptId || Number.isNaN(apptId)) {
      res.status(400).json({ error: 'appointmentId is required' });
      return;
    }
    if (!diagnosis || diagnosis.trim().length < 3) {
      res.status(400).json({ error: 'diagnosis (min 3 chars) is required' });
      return;
    }
    if (!admittingDoctorName || admittingDoctorName.trim().length < 2) {
      res.status(400).json({ error: 'admittingDoctorName is required' });
      return;
    }

    const result = await proposeFromOpd({
      appointmentId: apptId,
      diagnosis: diagnosis.trim(),
      urgency: urgency || 'routine',
      preferredBedType,
      preferredWardId,
      admittingDoctorId: admittingDoctorId ?? null,
      admittingDoctorName: admittingDoctorName.trim(),
      admissionType,
      actorUsername: req.user?.username ?? null,
      actorId: typeof req.user?.id === 'number' ? req.user.id : null,
    });

    await auditLog(req, {
      module: 'opd',
      action: 'CREATE',
      entityType: 'IpdAdmission',
      entityId: result.admission.id,
      payload: {
        admissionNo: result.admission.admissionNo,
        bedRequestId: result.bedRequest.id,
        urgency: result.bedRequest.urgency,
        appointmentId: apptId,
      },
      notes: 'OPD refer-for-admission (WF-2 handshake started)',
    });

    res.status(201).json({
      message: 'Bed request raised. Nursing station will accept and notify.',
      data: result,
    });
  } catch (error) {
    console.error('Error referring OPD patient for admission:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to refer for admission',
    });
  }
};

export const admitToIpd = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      appointmentId,
      wardId,
      bedId,
      admittingDoctorId,
      admittingDoctorName,
      admissionType = 'routine',
    } = req.body;

    // Validate required fields
    if (!appointmentId || !wardId || !bedId || !admittingDoctorName) {
      res.status(400).json({
        message:
          'Missing required fields: appointmentId, wardId, bedId, admittingDoctorName',
      });
      return;
    }

    // Convert OPD to IPD
    const result = await convertOpdToIpd(
      appointmentId,
      wardId,
      bedId,
      admittingDoctorId || 0,
      admittingDoctorName,
      admissionType
    );

    res.status(201).json({
      message: 'Patient admitted to IPD from OPD',
      data: result,
    });
  } catch (error) {
    console.error('Error admitting OPD patient to IPD:', error);
    res.status(500).json({
      message: 'Error admitting patient to IPD',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};