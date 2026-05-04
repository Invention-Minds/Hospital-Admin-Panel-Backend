import { Request, Response } from "express";
import { PrismaClient } from '@prisma/client';
import { getClinicalActor, stripAuditFields } from '../../middleware/audit-guard';

const prisma = new PrismaClient();


// ➡️ Create ER Assessment
export const createERAssessment = async (req: Request, res: Response) => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const er = await prisma.eRAssessment.create({
      data: {
        ...stripAuditFields({ ...req.body }),
        createdBy: actorId, // ERAssessment.createdBy is Int — store JWT id
      },
    });
    res.json(er);
  } catch (err: any) {
    console.error("Error creating ER assessment:", err);
    res.status(500).json({ error: err.message });
  }
};

// ➡️ Get ER Assessment by Appointment ID
export const getERAssessmentByAppointmentId = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    const er = await prisma.eRAssessment.findFirst({
      where: { id: Number(appointmentId) },
    });
    res.json(er);
  } catch (err: any) {
    console.error("Error fetching ER assessment:", err);
    res.status(500).json({ error: err.message });
  }
};

// ➡️ Update ER Assessment
export const updateERAssessment = async (req: Request, res: Response) => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const er = await prisma.eRAssessment.update({
      where: { id: Number(id) },
      data: stripAuditFields({ ...req.body }),
    });
    res.json(er);
  } catch (err: any) {
    console.error("Error updating ER assessment:", err);
    res.status(500).json({ error: err.message });
  }
};
// Get all ER Assessments
export const getAllERAssessments = async (req: Request, res: Response) => {
    try {
      const erList = await prisma.eRAssessment.findMany({
        orderBy: { createdAt: 'desc' }
      });
      res.json(erList);
    } catch (err: any) {
      console.error("Error fetching ER assessments:", err);
      res.status(500).json({ error: err.message });
    }
  };
