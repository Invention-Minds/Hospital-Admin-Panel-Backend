import { PatientRepository } from './patient.repository';

export class PatientResolver {
  private patientRepository: PatientRepository;

  constructor() {
    this.patientRepository = new PatientRepository();
  }

  async getPatientById(id: number) {
    return this.patientRepository.getPatientById(id);
  }

  async createPatient(data: { name: string; mobileNo: string; email: string; prn: number }) {
    return this.patientRepository.createPatient(data);
  }

  async updatePatient(id: number, data: { name: string; mobileNo: string; email: string; prn: number }) {
    return this.patientRepository.updatePatient(id, data);
  }

  async deletePatient(id: number) {
    return this.patientRepository.deletePatient(id);
  }
}