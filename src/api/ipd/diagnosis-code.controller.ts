import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.3c — ICD-10 + CPT codes per admission.
//
// Reference HMIS "Update Patient's Diagnosis" screen — two columns
// (ICD Codes / CPT Codes) and two tabs inside ICD (Provisional /
// Final). All three flavours live in one table differentiated by
// the `category` column.

const VALID_CATEGORIES = ['icd-provisional', 'icd-final', 'cpt'];

interface CodeBody {
  category: string;
  code: string;
  description: string;
}

export const listDiagnosisCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const category = req.query.category as string | undefined;
    if (category && !VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const rows = await prisma.admissionDiagnosisCode.findMany({
      where: { admissionId, ...(category && { category }) },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[diagnosis-code] list failed:', error);
    res.status(500).json({ message: 'Failed to list diagnosis codes' });
  }
};

export const addDiagnosisCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as CodeBody;
    if (!body.category || !body.code?.trim() || !body.description?.trim()) {
      res.status(400).json({ message: 'category, code and description are required' });
      return;
    }
    if (!VALID_CATEGORIES.includes(body.category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) {
      res.status(404).json({ message: 'Admission not found' });
      return;
    }
    const row = await prisma.admissionDiagnosisCode.create({
      data: {
        admissionId,
        category: body.category,
        code: body.code.trim(),
        description: body.description.trim(),
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'mrd',
      action: 'CREATE',
      entityType: 'AdmissionDiagnosisCode',
      entityId: row.id,
      payload: { admissionId, category: row.category, code: row.code },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[diagnosis-code] add failed:', error);
    res.status(500).json({ message: 'Failed to add diagnosis code' });
  }
};

export const updateDiagnosisCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as Partial<CodeBody>;
    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const row = await prisma.admissionDiagnosisCode.update({
      where: { id },
      data: {
        ...(body.category && { category: body.category }),
        ...(body.code && { code: body.code.trim() }),
        ...(body.description && { description: body.description.trim() }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[diagnosis-code] update failed:', error);
    res.status(500).json({ message: 'Failed to update diagnosis code' });
  }
};

export const removeDiagnosisCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    await prisma.admissionDiagnosisCode.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    console.error('[diagnosis-code] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove diagnosis code' });
  }
};
