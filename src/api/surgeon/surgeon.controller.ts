import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Bug #12 — Surgeon / Assistant-surgeon master.
// Mirrors the department module's controller style: thin handlers, Prisma
// direct, 409 on duplicate, 500 with the error message on failure.

// List surgeons, ordered by name. Optional ?type=surgeon|assistant filter and
// ?activeOnly=true to hide deactivated rows.
export const getSurgeons = async (req: Request, res: Response) => {
  try {
    const { type, activeOnly } = req.query;
    const where: { type?: string; isActive?: boolean } = {};
    if (typeof type === 'string' && type.trim()) {
      where.type = type.trim();
    }
    if (activeOnly === 'true') {
      where.isActive = true;
    }
    const surgeons = await prisma.surgeon.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(surgeons);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

// Create a surgeon. Rejects duplicates on (name + type) with 409, mirroring the
// department duplicate fix.
export const createSurgeon = async (req: Request, res: Response) => {
  try {
    const { name, type, qualification } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const surgeonType = typeof type === 'string' && type.trim() ? type.trim() : 'surgeon';
    const existing = await prisma.surgeon.findFirst({
      where: { name: name.trim(), type: surgeonType },
    });
    if (existing) {
      res.status(409).json({ error: 'Surgeon already exists' });
      return;
    }
    const surgeon = await prisma.surgeon.create({
      data: {
        name: name.trim(),
        type: surgeonType,
        qualification: qualification?.trim() || null,
      },
    });
    res.status(201).json(surgeon);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

// Update a surgeon — name / type / qualification / isActive. Used by the
// unified Masters admin page.
export const updateSurgeon = async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'id must be a number' });
      return;
    }
    const { name, type, qualification, isActive } = req.body;
    const data: {
      name?: string;
      type?: string;
      qualification?: string | null;
      isActive?: boolean;
    } = {};
    if (name !== undefined) {
      if (!name?.trim()) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      data.name = name.trim();
    }
    if (type !== undefined && typeof type === 'string' && type.trim()) {
      data.type = type.trim();
    }
    if (qualification !== undefined) {
      data.qualification = qualification?.trim() || null;
    }
    if (isActive !== undefined) {
      data.isActive = Boolean(isActive);
    }
    const surgeon = await prisma.surgeon.update({
      where: { id },
      data,
    });
    res.json(surgeon);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};
