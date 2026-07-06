import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getClinicalActor, stripAuditFields } from '../../middleware/audit-guard';
import { snapshotTemplateFields } from '../note-template/note-template.controller';

const prisma = new PrismaClient();

/**
 * Build the templated-values JSON snapshot from `noteTemplateId` +
 * `templatedValueMap` on a request body. Strips both keys so callers can
 * spread the rest of the body straight into Prisma. Returns the JSON string
 * (or undefined when no template is in use). Keeps doctor notes consistent
 * with the discharge / OPD assessment snapshot pattern.
 */
async function buildTemplatedValuesSnapshot(
  body: Record<string, unknown>,
): Promise<{ noteTemplateId: string | undefined; templatedValues: string | undefined }> {
  const noteTemplateId = typeof body['noteTemplateId'] === 'string'
    ? (body['noteTemplateId'] as string)
    : undefined;
  const templatedValueMap = body['templatedValueMap'];
  // Remove the frontend-only key so the spread doesn't try to write it.
  delete body['templatedValueMap'];

  if (!noteTemplateId || !templatedValueMap || typeof templatedValueMap !== 'object') {
    return { noteTemplateId: undefined, templatedValues: undefined };
  }
  const fieldDefs = await snapshotTemplateFields(noteTemplateId);
  const json = JSON.stringify({
    _schema: fieldDefs ?? [],
    _values: templatedValueMap,
  });
  return { noteTemplateId, templatedValues: json };
}

// Create doctor note
export const createDoctorNote = async (req: Request, res: Response) => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const body = stripAuditFields({ ...req.body }) as Record<string, unknown>;
    const snap = await buildTemplatedValuesSnapshot(body);

    const note = await prisma.doctorNote.create({
      // Body shape mirrors the existing schema columns; we trust upstream
      // validation. Cast through `any` because the spread + snapshot fields
      // make the literal too narrow for Prisma's strict checked input type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...body,
        ...(snap.noteTemplateId && { noteTemplateId: snap.noteTemplateId }),
        ...(snap.templatedValues && { templatedValues: snap.templatedValues }),
        createdBy: req.user!.username,
        updatedBy: req.user!.username,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    res.status(201).json({ message: 'Doctor note created successfully', data: note });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ message: 'Failed to create doctor note', error });
  }
};

// Get all notes
export const getAllDoctorNotes = async (_req: Request, res: Response) => {
  try {
    const notes = await prisma.doctorNote.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch doctor notes', error });
  }
};

// Get notes by PRN and optional date
export const getDoctorNotesByPRN = async (req: Request, res: Response) => {
  const { prn } = req.params;
  const date = req.query.date as string; // optional

  try {

    if (!date) {
      res.status(400).json({ message: 'Date is required' });
      return
   }

   const existing = await prisma.doctorNote.findFirst({
     where: {
       prn: Number(prn),
       date: date,
     }
   });

    res.json(existing);
  } catch (error) {
    console.error('Error fetching doctor notes:', error);
    res.status(500).json({ message: 'Failed to fetch doctor notes', error });
  }
};
export const updateDoctorNoteByPRNAndDate = async (req: Request, res: Response) => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { prn } = req.params;
    const date = req.query.date as string;
    const payload = stripAuditFields({ ...req.body }) as Record<string, unknown>;

    if (!date) {
       res.status(400).json({ message: 'Date is required' });
       return
    }

    // Snapshot the template (if one is in use) and strip the frontend-only
    // `templatedValueMap` from the spread payload.
    const snap = await buildTemplatedValuesSnapshot(payload);

    const existing = await prisma.doctorNote.findFirst({
      where: {
        prn: Number(prn),
        date: date,
      }
    });

    let result;

    if (existing) {
      // Update existing note
      result = await prisma.doctorNote.update({
        where: { id: existing.id },
        data: {
          ...payload,
          prn: Number(prn), // Ensure PRN is stored as a number
          date, // Ensure date is stored correctly
          ...(snap.noteTemplateId && { noteTemplateId: snap.noteTemplateId }),
          ...(snap.templatedValues && { templatedValues: snap.templatedValues }),
          updatedBy: req.user!.username,
        },
      });
    } else {
      // Create new note
      result = await prisma.doctorNote.create({
        data: {
          prn: Number(prn),
          date,
          ...payload,
          ...(snap.noteTemplateId && { noteTemplateId: snap.noteTemplateId }),
          ...(snap.templatedValues && { templatedValues: snap.templatedValues }),
          createdBy: req.user!.username,
          updatedBy: req.user!.username,
        }
      });
    }

    res.status(200).json({ message: 'Doctor note saved successfully', data: result });

  } catch (error) {
    console.error('Error saving doctor note:', error);
    res.status(500).json({ message: 'Failed to save doctor note', error });
  }
};

