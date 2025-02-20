import { PrismaClient } from '@prisma/client';

export class PatientRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async createPatient(data: { name: string; mobileNo: string; email: string; prn: number }) {
    return this.prisma.patientDetails.create({ data });
  }

  async getPatientById(id: number) {
    return this.prisma.patientDetails.findFirst({ where: { id } });
  }

  async updatePatient(id: number, data: { name: string; mobileNo: string; email: string; prn: number }) {
    return this.prisma.patientDetails.update({ where: { id }, data });
  }

  async deletePatient(id: number) {
    return this.prisma.patientDetails.delete({ where: { id } });
  }
  async getPatientByMobileNumber(mobileNo: string) {
    return this.prisma.patientDetails.findFirst({ where: { mobileNo } });
  }
  async getAllPatients(){
    return this.prisma.patientDetails.findMany()
  }
}
