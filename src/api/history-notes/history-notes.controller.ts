import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Create doctor note
export const createDoctorNote = async (req: Request, res: Response) => {
  try {
    const note = await prisma.historyNotes.create({
      data: req.body,
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
    const notes = await prisma.historyNotes.findMany({
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

   const existing = await prisma.historyNotes.findFirst({
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
    const { prn } = req.params;
    const date = req.query.date as string;
    const data = req.body;

    if (!date) {
       res.status(400).json({ message: 'Date is required' });
       return
    }

    const existing = await prisma.historyNotes.findFirst({
      where: {
        prn: Number(prn),
        date: date,
      }
    });

    let result;

    if (existing) {
      // Update existing note
      result = await prisma.historyNotes.update({
        where: { id: existing.id },
        data,
      });
    } else {
      // Create new note
      result = await prisma.historyNotes.create({
        data: {
          prn: Number(prn),
          date,
          ...data
        }
      });
    }

    res.status(200).json({ message: 'Doctor note saved successfully', data: result });

  } catch (error) {
    console.error('Error saving doctor note:', error);
    res.status(500).json({ message: 'Failed to save doctor note', error });
  }
};

