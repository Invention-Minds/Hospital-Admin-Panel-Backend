import { Request, Response } from 'express';
import { PatientRepository } from './patient.repository';

export class PatientController {
  private patientRepository: PatientRepository;

  constructor() {
    this.patientRepository = new PatientRepository();
  }

  async createPatient(req: Request, res: Response): Promise<void> {
    try {
      const { name, phoneNumber, email, prn } = req.body;
      const patient = await this.patientRepository.createPatient({ name, phoneNumber, email, prn });
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
      const updatedPatient = await this.patientRepository.updatePatient(Number(id), { name, phoneNumber, email, prn });
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
}