import { Request, Response } from 'express';
import { PatientRepository } from './patient.repository';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class PatientController {
  private patientRepository: PatientRepository;

  constructor() {
    this.patientRepository = new PatientRepository();
  }

  async createPatient(req: Request, res: Response): Promise<void> {
    try {
      const { name, phoneNumber, email, prn } = req.body;
      const mobileNo = phoneNumber
       // Check if the patient with the phone number already exists
    const existingPatient = await this.patientRepository.getPatientByMobileNumber(phoneNumber);

    if (existingPatient) {
      // If the patient already exists, return a 409 Conflict response
      res.status(409).json({ message: 'Patient with this phone number already exists', patient: existingPatient });
      return;
    }
      const patient = await this.patientRepository.createPatient({ name, mobileNo, email, prn });
      res.status(201).json(patient);
    } catch (error) {
      res.status(500).json({ message: 'Error creating patient', error });
    }
  }

  async getPatient(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const patient = await this.patientRepository.getPatientById(Number(id));
      if (patient) {
        res.status(200).json(patient);
      } else {
        res.status(404).json({ message: 'Patient not found' });
      }
    } catch (error) {
      res.status(500).json({ message: 'Error fetching patient', error });
    }
  }

  async updatePatient(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, phoneNumber, email, prn } = req.body;
      const mobileNo = phoneNumber
      const updatedPatient = await this.patientRepository.updatePatient(Number(id), { name, mobileNo, email, prn });
      res.status(200).json(updatedPatient);
    } catch (error) {
      res.status(500).json({ message: 'Error updating patient', error });
    }
  }

  async deletePatient(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await this.patientRepository.deletePatient(Number(id));
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: 'Error deleting patient', error });
    }
  }
  async getPatients(req: Request, res: Response): Promise<void> {
    try {
      const allPatients = await this.patientRepository.getAllPatients();
      // console.log(allPatients)
      res.status(200).send(allPatients);
    } catch (error) {
      res.status(500).json({ message: 'Error deleting patient', error });
    }
  }
  async getDetailsByPRN(req: Request, res: Response): Promise<void> {
    try {
      const { prnNumber } = req.body;
  
      if (!prnNumber) {
        res.status(400).json({ message: 'PNR number is required' });
        return;
      }
      const appointments = await prisma.appointment.findMany({
        where: { prnNumber: Number(prnNumber) }
      });
      const serviceAppointments = await prisma.serviceAppointments.findMany({
        where: { pnrNumber: prnNumber.toString() },
        include: { RadioService: true }
      });
  
      const services = await prisma.service.findMany({
        where: { pnrNumber: prnNumber.toString() },
        include: { repeatedDates: true, package: true, RadioService: true }
      });
      const doctorNotes = await prisma.doctorNote.findMany({
        where: { prn: Number(prnNumber) },
        orderBy: { createdAt: 'desc' }
      });
      const patientData = await prisma.patientDetails.findUnique({
        where: {prn: Number(prnNumber)}
      })

      const prescriptionData = await prisma.prescription.findMany({
        where: { prn: prnNumber.toString() },
        include: {
          tablets: true,
        }
      });
      
      const historyData = await prisma.historyNotes.findMany({
        where: { prn: Number(prnNumber) },
        orderBy: { createdAt: 'desc' }
      })
      const investigationOrders = await prisma.investigationOrder.findMany({
        where: { prn: prnNumber.toString() },
        include: {
          labTests: true,
          radiologyTests: true,
          packages: true
        },
        orderBy: { createdAt: 'desc' }
      });
  
      res.json({
        appointments: appointments,
        serviceAppointments: serviceAppointments,
        services: services,
        doctorNotes: doctorNotes,
        patientData: patientData,
        prescriptionData: prescriptionData,
        historyData: historyData,
        investigationOrders: investigationOrders
      });
  
    } catch (error) {
      console.error('Error fetching data by PRN:', error);
      res.status(500).json({ message: 'Internal server error', error });
    }
  };
async updatePatientByPRN(req: Request, res: Response):Promise<void>{

  
    try {
      const { prn } = req.params;
      const data = req.body;
  
      console.log(prn,'hi',data)
      const existing = await prisma.patientDetails.findUnique({
        where: { prn: Number(prn) },
      });
  
      if (!existing) {
         res.status(404).json({ message: 'Patient not found with this PRN' });
         return
      }
      const updated = await prisma.patientDetails.update({
        where: { prn: Number(prn) },
        data
      });
  
      res.json({ message: 'Patient updated', data: updated });
    } catch (error) {
      console.error('Error updating patient:', error);
      res.status(500).json({ message: 'Failed to update patient' });
    }
  };
}
export const createPatient = async (req: Request, res: Response) => {
  try {
    const patientData = req.body;

    // Check if PRN already exists
    const existingPatient = await prisma.patientDetails.findUnique({
      where: { prn: patientData.prn }
    });

    if (existingPatient) {
       res.status(400).json({ message: 'PRN already exists. Please use a unique PRN number.' });
       return
    }

    // Create new patient
    const newPatient = await prisma.patientDetails.create({
      data: {
        ...patientData,
        created_at: new Date()
      }
    });

    res.status(201).json({ message: 'Patient created successfully', data: newPatient });
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Internal Server Error', error });
  }
};