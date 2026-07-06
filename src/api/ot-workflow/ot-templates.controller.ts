import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.1c — Surgical Notes + Other Notes templates.
//
// Two near-identical resources. Kept in one file to avoid two thin
// controllers that diverge over time; if either grows non-trivial
// behaviour later, split them.

interface TemplateBody {
  name: string;
  departmentId?: number | null;
  bodyTemplate: string;
  isActive?: boolean;
}

// ─── SurgicalNotesTemplate ─────────────────────────────────────────────

export const listSurgicalTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const departmentId = req.query.departmentId ? parseInt(String(req.query.departmentId), 10) : undefined;
    const rows = await prisma.surgicalNotesTemplate.findMany({
      where: {
        isActive: true,
        ...(departmentId !== undefined && !Number.isNaN(departmentId) && { departmentId }),
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-templates] list surgical failed:', error);
    res.status(500).json({ message: 'Failed to list surgical templates' });
  }
};

export const getSurgicalTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.surgicalNotesTemplate.findUnique({ where: { id: req.params.id } });
    if (!row) { res.status(404).json({ message: 'Template not found' }); return; }
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-templates] get surgical failed:', error);
    res.status(500).json({ message: 'Failed to load template' });
  }
};

export const createSurgicalTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as TemplateBody;
    if (!body.name?.trim() || !body.bodyTemplate) {
      res.status(400).json({ message: 'name and bodyTemplate are required' });
      return;
    }
    const row = await prisma.surgicalNotesTemplate.create({
      data: {
        name: body.name.trim(),
        departmentId: body.departmentId ?? null,
        bodyTemplate: body.bodyTemplate,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-templates] create surgical failed:', error);
    res.status(500).json({ message: 'Failed to create template' });
  }
};

export const updateSurgicalTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Partial<TemplateBody>;
    const row = await prisma.surgicalNotesTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.bodyTemplate !== undefined && { bodyTemplate: body.bodyTemplate }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-templates] update surgical failed:', error);
    res.status(500).json({ message: 'Failed to update template' });
  }
};

// ─── OtherNotesTemplate (parallel API) ─────────────────────────────────

export const listOtherTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const departmentId = req.query.departmentId ? parseInt(String(req.query.departmentId), 10) : undefined;
    const rows = await prisma.otherNotesTemplate.findMany({
      where: {
        isActive: true,
        ...(departmentId !== undefined && !Number.isNaN(departmentId) && { departmentId }),
      },
      orderBy: { name: 'asc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-templates] list other failed:', error);
    res.status(500).json({ message: 'Failed to list other templates' });
  }
};

export const createOtherTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as TemplateBody;
    if (!body.name?.trim() || !body.bodyTemplate) {
      res.status(400).json({ message: 'name and bodyTemplate are required' });
      return;
    }
    const row = await prisma.otherNotesTemplate.create({
      data: {
        name: body.name.trim(),
        departmentId: body.departmentId ?? null,
        bodyTemplate: body.bodyTemplate,
        isActive: body.isActive ?? true,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-templates] create other failed:', error);
    res.status(500).json({ message: 'Failed to create template' });
  }
};

export const updateOtherTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Partial<TemplateBody>;
    const row = await prisma.otherNotesTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
        ...(body.bodyTemplate !== undefined && { bodyTemplate: body.bodyTemplate }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-templates] update other failed:', error);
    res.status(500).json({ message: 'Failed to update template' });
  }
};
