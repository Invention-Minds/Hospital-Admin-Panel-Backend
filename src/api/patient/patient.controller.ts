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
}
