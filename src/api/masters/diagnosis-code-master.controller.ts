import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.4a — ICD-10 + CPT master catalog. MRD team curates the list;
// admission-level codes (AdmissionDiagnosisCode) take a denormalised
// snapshot at write time.

const VALID_CATEGORIES = ['icd', 'cpt'];

interface MasterBody {
  category: string;
  code: string;
  description: string;
  isActive?: boolean;
}

export const listDiagnosisMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const category = req.query.category as string | undefined;
    const search = (req.query.search as string | undefined)?.trim() ?? '';
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    if (category && !VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const rows = await prisma.diagnosisCodeMaster.findMany({
      where: {
        isActive: true,
        ...(category && { category }),
        ...(search && {
          OR: [
            { code: { contains: search } },
            { description: { contains: search } },
          ],
        }),
      },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
      take: limit,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[diagnosis-master] list failed:', error);
    res.status(500).json({ message: 'Failed to list diagnosis master' });
  }
};

export const createDiagnosisMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as MasterBody;
    if (!body.category || !body.code?.trim() || !body.description?.trim()) {
      res.status(400).json({ message: 'category, code and description are required' });
      return;
    }
    if (!VALID_CATEGORIES.includes(body.category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const row = await prisma.diagnosisCodeMaster.create({
      data: {
        category: body.category,
        code: body.code.trim(),
        description: body.description.trim(),
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    // Prisma P2002 — unique violation
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      res.status(409).json({ message: 'A row with this (category, code) already exists' });
      return;
    }
    console.error('[diagnosis-master] create failed:', error);
    res.status(500).json({ message: 'Failed to create diagnosis master' });
  }
};

export const updateDiagnosisMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const body = req.body as Partial<MasterBody>;
    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
      res.status(400).json({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const row = await prisma.diagnosisCodeMaster.update({
      where: { id },
      data: {
        ...(body.category && { category: body.category }),
        ...(body.code && { code: body.code.trim() }),
        ...(body.description && { description: body.description.trim() }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[diagnosis-master] update failed:', error);
    res.status(500).json({ message: 'Failed to update diagnosis master' });
  }
};

export const removeDiagnosisMaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    // Soft-delete to preserve referential integrity (existing
    // AdmissionDiagnosisCode rows store a snapshot, not a FK, so we
    // can hard-delete safely — but soft is friendlier for "Oops").
    await prisma.diagnosisCodeMaster.update({
      where: { id },
      data: { isActive: false },
    });
    res.status(204).end();
  } catch (error) {
    console.error('[diagnosis-master] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove diagnosis master' });
  }
};
