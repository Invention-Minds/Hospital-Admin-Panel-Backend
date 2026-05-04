import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { convertOpdToIpd } from '../conversion/opd-to-ipd';
import { getClinicalActor, stripAuditFields } from '../../middleware/audit-guard';

export const createOpdAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = getClinicalActor(req, res);
      if (actorId === null) return;

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
      };

      const opd = await prisma.oPDAssessment.create({ data });
      res.status(200).json(opd);
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

    const updated = await prisma.oPDAssessment.update({
      where: { id: Number(req.params.id) },
      data: stripAuditFields({ ...req.body })
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