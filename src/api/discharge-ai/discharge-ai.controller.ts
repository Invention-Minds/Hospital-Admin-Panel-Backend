import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import {
  generateDischargeDraft,
  generateTemplatedDischargeDraft,
  type DischargeAiDraft,
  type FieldDef,
} from '../../service/discharge-ai';
import { snapshotTemplateFields } from '../note-template/note-template.controller';
import { spawnDischargeClearances } from '../../service/discharge-clearance';
import { resolveTargetRole } from '../../service/role-alias';

/**
 * Phase 6 (WF-5) — AI-drafted discharge summary controller.
 *
 * Lifecycle:
 *   1. POST /admission/:admissionId/discharge/ai-draft
 *      → calls the model, upserts an IpdDischarge row in summaryStatus='DRAFTED'.
 *
 *   2. PUT  /admission/:admissionId/discharge/edit
 *      → clinician saves edits; flips status DRAFTED → EDITED. aiDraftJson stays
 *        intact so we can show a diff later if asked.
 *
 *   3. POST /admission/:admissionId/discharge/sign
 *      → clinician e-signs; flips status to SIGNED, locks edits, frees the bed,
 *        flips admission to status='discharged'.
 *
 *   4. POST /admission/:admissionId/discharge/attender-ack
 *      → attender e-signs receipt; flips status to DELIVERED.
 *
 * Field names mirror IpdDischarge columns 1:1 so the frontend payloads can be
 * spread into the form without renames.
 */

interface EditDischargeBody {
  finalDiagnosis?: string;
  proceduresDone?: string;
  conditionAtDischarge?: string;
  dischargeSummary?: string;
  medications?: unknown;
  advice?: string;
  followUpDate?: string;
  followUpDoctor?: string;
  dischargeType?: string;

  // Templated path: when the doctor uses a NoteTemplate, the form sends a
  // single `templatedValueMap` of {fieldKey: value} instead of (or alongside)
  // the legacy free-text columns. We persist it into `templatedValues._values`.
  noteTemplateId?: string;
  templatedValueMap?: Record<string, unknown>;
}

interface SignDischargeBody {
  clinicianSignatureId: string;
  clinicianSignedBy?: string;
}

interface AttenderAckBody {
  attenderName: string;
  attenderRelation: string;
  attenderAcknowledgmentSignatureId: string;
}

/** POST /api/ipd/admission/:admissionId/discharge/ai-draft */
export const generateAiDraft = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;

    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }
    if (admission.status === 'discharged') {
      res.status(409).json({ error: 'Admission is already discharged' });
      return;
    }

    const existing = await prisma.ipdDischarge.findUnique({ where: { admissionId } });
    if (existing?.summaryStatus === 'SIGNED' || existing?.summaryStatus === 'DELIVERED') {
      res
        .status(409)
        .json({ error: `Discharge is locked at status=${existing.summaryStatus}; cannot redraft` });
      return;
    }

    // Template-aware AI: if the existing discharge already has a noteTemplateId,
    // OR the request body explicitly requests a templateId, route through
    // generateTemplatedDischargeDraft. The legacy path stays as the fallback.
    const requestedTemplateId =
      (req.body as { noteTemplateId?: string } | undefined)?.noteTemplateId
      ?? existing?.noteTemplateId
      ?? null;

    if (requestedTemplateId) {
      const tpl = await prisma.noteTemplate.findUnique({ where: { id: requestedTemplateId } });
      if (!tpl) {
        res.status(404).json({ error: 'Selected template not found' });
        return;
      }
      let parsedFields: FieldDef[] = [];
      try { parsedFields = JSON.parse(tpl.fields); } catch { parsedFields = []; }

      const templated = await generateTemplatedDischargeDraft(admissionId, {
        id: tpl.id,
        name: tpl.name,
        fields: parsedFields,
      });

      const now = new Date();
      const aiDraftJson = JSON.stringify(templated);
      const templatedValuesJson = JSON.stringify({
        _schema: null, // schema only locks at sign-time
        _values: templated.templatedValueMap,
      });

      const row = existing
        ? await prisma.ipdDischarge.update({
            where: { admissionId },
            data: {
              noteTemplateId: tpl.id,
              templatedValues: templatedValuesJson,
              summaryStatus: 'DRAFTED',
              aiDraftJson,
              aiDraftedAt: now,
              aiDraftedByModel: templated.modelVersion,
              updatedBy: req.user?.username ?? null,
            },
          })
        : await prisma.ipdDischarge.create({
            data: {
              admissionId,
              dischargeDate: now,
              dischargeTime: now.toLocaleTimeString(),
              dischargeType: 'regular',
              // Legacy fields can stay empty — the templated values carry the content.
              finalDiagnosis: '',
              conditionAtDischarge: '',
              dischargeSummary: '',
              medications: '[]',
              noteTemplateId: tpl.id,
              templatedValues: templatedValuesJson,
              summaryStatus: 'DRAFTED',
              aiDraftJson,
              aiDraftedAt: now,
              aiDraftedByModel: templated.modelVersion,
              createdBy: req.user?.username ?? null,
            },
          });

      await auditLog(req, {
        module: 'discharge-ai',
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'IpdDischarge',
        entityId: row.id,
        payload: { admissionId, model: templated.modelVersion, status: 'DRAFTED', templated: true },
      });

      res.status(200).json(row);
      return;
    }

    const draft: DischargeAiDraft = await generateDischargeDraft(admissionId);

    const aiDraftJson = JSON.stringify(draft);
    const now = new Date();
    const followUpDate =
      typeof draft.followUpInDays === 'number'
        ? new Date(Date.now() + draft.followUpInDays * 24 * 60 * 60 * 1000)
        : null;
    const medicationsJson = JSON.stringify(draft.medications || []);

    const row = existing
      ? await prisma.ipdDischarge.update({
          where: { admissionId },
          data: {
            finalDiagnosis: draft.finalDiagnosis,
            proceduresDone: draft.proceduresDone,
            conditionAtDischarge: draft.conditionAtDischarge,
            dischargeSummary: draft.dischargeSummary,
            medications: medicationsJson,
            advice: draft.advice,
            followUpDate,
            followUpDoctor: draft.followUpDoctor ?? null,
            summaryStatus: 'DRAFTED',
            aiDraftJson,
            aiDraftedAt: now,
            aiDraftedByModel: draft.modelVersion,
            updatedBy: req.user?.username ?? null,
          },
        })
      : await prisma.ipdDischarge.create({
          data: {
            admissionId,
            dischargeDate: now,
            dischargeTime: now.toLocaleTimeString(),
            dischargeType: 'regular',
            finalDiagnosis: draft.finalDiagnosis,
            proceduresDone: draft.proceduresDone,
            conditionAtDischarge: draft.conditionAtDischarge,
            dischargeSummary: draft.dischargeSummary,
            medications: medicationsJson,
            advice: draft.advice,
            followUpDate,
            followUpDoctor: draft.followUpDoctor ?? null,
            summaryStatus: 'DRAFTED',
            aiDraftJson,
            aiDraftedAt: now,
            aiDraftedByModel: draft.modelVersion,
            createdBy: req.user?.username ?? null,
          },
        });

    await auditLog(req, {
      module: 'discharge-ai',
      action: existing ? 'UPDATE' : 'CREATE',
      entityType: 'IpdDischarge',
      entityId: row.id,
      payload: { admissionId, model: draft.modelVersion, status: 'DRAFTED' },
    });

    res.status(200).json(row);
  } catch (error) {
    console.error('[discharge-ai] generateAiDraft failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'AI draft failed',
    });
  }
};

/** PUT /api/ipd/admission/:admissionId/discharge/edit */
export const editDischarge = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const body = req.body as EditDischargeBody;

    const existing = await prisma.ipdDischarge.findUnique({ where: { admissionId } });
    if (!existing) {
      res.status(404).json({ error: 'Discharge not found — generate an AI draft first' });
      return;
    }
    if (existing.summaryStatus === 'SIGNED' || existing.summaryStatus === 'DELIVERED') {
      res
        .status(409)
        .json({ error: `Discharge is locked at status=${existing.summaryStatus}; cannot edit` });
      return;
    }

    // If a templated path is being used, build the `_values` half of the
    // snapshot now. The `_schema` half is left null until sign-time so the
    // doctor can keep editing against the latest live template definitions.
    let templatedValuesJson: string | undefined;
    if (body.templatedValueMap !== undefined) {
      const existingParsed = parseTemplatedValues(existing.templatedValues);
      templatedValuesJson = JSON.stringify({
        _schema: existingParsed?._schema ?? null, // preserve any earlier snapshot
        _values: body.templatedValueMap,
      });
    }

    const updated = await prisma.ipdDischarge.update({
      where: { admissionId },
      data: {
        finalDiagnosis: body.finalDiagnosis ?? undefined,
        proceduresDone: body.proceduresDone ?? undefined,
        conditionAtDischarge: body.conditionAtDischarge ?? undefined,
        dischargeSummary: body.dischargeSummary ?? undefined,
        medications: body.medications !== undefined ? JSON.stringify(body.medications) : undefined,
        advice: body.advice ?? undefined,
        followUpDate: body.followUpDate ? new Date(body.followUpDate) : undefined,
        followUpDoctor: body.followUpDoctor ?? undefined,
        dischargeType: body.dischargeType ?? undefined,
        noteTemplateId: body.noteTemplateId ?? undefined,
        templatedValues: templatedValuesJson,
        summaryStatus: 'EDITED',
        updatedBy: req.user?.username ?? null,
      },
    });

    await auditLog(req, {
      module: 'discharge-ai',
      action: 'UPDATE',
      entityType: 'IpdDischarge',
      entityId: updated.id,
      payload: {
        admissionId,
        status: 'EDITED',
        usingTemplate: !!body.noteTemplateId,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[discharge-ai] editDischarge failed:', error);
    res.status(500).json({ error: 'Failed to save edits' });
  }
};

/** POST /api/ipd/admission/:admissionId/discharge/sign — clinician sign-off, locks the row + frees the bed. */
export const signDischarge = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const body = req.body as SignDischargeBody;
    if (!body.clinicianSignatureId) {
      res.status(400).json({ error: 'clinicianSignatureId is required' });
      return;
    }

    const existing = await prisma.ipdDischarge.findUnique({ where: { admissionId } });
    if (!existing) {
      res.status(404).json({ error: 'Discharge not found' });
      return;
    }
    if (existing.summaryStatus === 'SIGNED' || existing.summaryStatus === 'DELIVERED') {
      res.status(409).json({ error: `Discharge already at status=${existing.summaryStatus}` });
      return;
    }

    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }

    // SNAPSHOT step — if a template was used, freeze its field definitions
    // into the discharge row's templatedValues._schema. From this moment on,
    // any future edits to the live NoteTemplate row never affect this signed
    // discharge — the printed PDF always walks the snapshot. (NABH evidence
    // integrity: signed copy must not change retroactively.)
    let snapshotJson: string | undefined;
    if (existing.noteTemplateId) {
      const fieldDefs = await snapshotTemplateFields(existing.noteTemplateId);
      const existingParsed = parseTemplatedValues(existing.templatedValues);
      snapshotJson = JSON.stringify({
        _schema: fieldDefs ?? [],
        _values: existingParsed?._values ?? {},
      });
    }

    // Phase D — sign no longer flips admission.status / frees the bed. It just
    // marks the summary signed and spawns the parallel DischargeClearance rows
    // for OT/Billing/Nursing/Pharmacy/Lab_Rad/Diet/MLC. Front Desk's finalize
    // endpoint runs the gate (all clearances + attender ack + recent vitals)
    // and only then flips admission.status='discharged' + frees the bed.
    const result = await prisma.$transaction(async (tx) => {
      const dis = await tx.ipdDischarge.update({
        where: { admissionId },
        data: {
          summaryStatus: 'SIGNED',
          clinicianSignatureId: body.clinicianSignatureId,
          clinicianSignedAt: new Date(),
          clinicianSignedBy: body.clinicianSignedBy ?? req.user?.username ?? null,
          clinicianSignedById: typeof req.user?.id === 'number' ? req.user.id : null,
          templatedValues: snapshotJson,
          updatedBy: req.user?.username ?? null,
        },
      });

      await spawnDischargeClearances(admissionId, req.user?.username ?? null, tx);
      return dis;
    });

    // Fan a notification to each department's coordinator that their clearance
    // row is ready. Fire-and-forget — failure to notify must not roll back the
    // sign.
    void (async () => {
      const aliases = [
        ['discharge_billing', 'BILLING'],
        ['discharge_nursing', 'NURSING'],
        ['discharge_pharmacy', 'PHARMACY'],
        ['discharge_lab_rad', 'LAB_RAD'],
        ['discharge_diet', 'DIET'],
        ['discharge_ot', 'OT'],
        ['discharge_mlc', 'MLC'],
      ] as const;
      for (const [alias, dept] of aliases) {
        const targetRole = await resolveTargetRole(alias);
        try {
          await prisma.notification.create({
            data: {
              type: 'discharge_clearance_pending',
              title: `Discharge clearance · ${dept}`,
              message: `Patient ${admission.admissionNo}: clearance pending.`,
              status: 'unread',
              targetRole: targetRole ?? undefined,
              entityId: 0,
              entityType: `IpdAdmission:${admissionId}`,
            },
          });
        } catch (err) {
          console.warn('[discharge-ai:sign-notify]', dept, 'failed:', (err as Error).message);
        }
      }
    })();

    await auditLog(req, {
      module: 'discharge-ai',
      action: 'STATUS_CHANGE',
      entityType: 'IpdDischarge',
      entityId: result.id,
      payload: { from: existing.summaryStatus, to: 'SIGNED', admissionId },
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[discharge-ai] signDischarge failed:', error);
    res.status(500).json({ error: 'Failed to sign discharge' });
  }
};

/** POST /api/ipd/admission/:admissionId/discharge/attender-ack — attender confirms receipt. */
export const recordAttenderAck = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId } = req.params;
    const body = req.body as AttenderAckBody;

    if (!body.attenderName || !body.attenderRelation || !body.attenderAcknowledgmentSignatureId) {
      res.status(400).json({
        error: 'attenderName, attenderRelation, attenderAcknowledgmentSignatureId are all required',
      });
      return;
    }

    const existing = await prisma.ipdDischarge.findUnique({ where: { admissionId } });
    if (!existing) {
      res.status(404).json({ error: 'Discharge not found' });
      return;
    }
    if (existing.summaryStatus !== 'SIGNED') {
      res
        .status(409)
        .json({ error: `Cannot record attender ack in status=${existing.summaryStatus}; clinician must sign first` });
      return;
    }

    const updated = await prisma.ipdDischarge.update({
      where: { admissionId },
      data: {
        summaryStatus: 'DELIVERED',
        attenderName: body.attenderName.trim(),
        attenderRelation: body.attenderRelation.trim(),
        attenderAcknowledgmentSignatureId: body.attenderAcknowledgmentSignatureId,
        attenderAcknowledgedAt: new Date(),
        updatedBy: req.user?.username ?? null,
      },
    });

    await auditLog(req, {
      module: 'discharge-ai',
      action: 'STATUS_CHANGE',
      entityType: 'IpdDischarge',
      entityId: updated.id,
      payload: { from: 'SIGNED', to: 'DELIVERED', admissionId },
      notes: `Attender: ${body.attenderName} (${body.attenderRelation})`,
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[discharge-ai] recordAttenderAck failed:', error);
    res.status(500).json({ error: 'Failed to record attender acknowledgement' });
  }
};

/**
 * Defensive parse of the `templatedValues` LongText column.
 * Returns null when the column is empty or not parseable JSON.
 */
function parseTemplatedValues(raw: string | null | undefined):
  | { _schema?: unknown; _values?: Record<string, unknown> }
  | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as { _schema?: unknown; _values?: Record<string, unknown> };
    }
    return null;
  } catch {
    return null;
  }
}
