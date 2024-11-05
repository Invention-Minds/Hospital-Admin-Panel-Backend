import { PrismaClient } from '@prisma/client';

export class PatientRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async createPatient(data: { name: string; phoneNumber: string; email: string; prn: number }) {
    return this.prisma.patient.create({ data });
  }

  async getPatientById(id: number) {
    return this.prisma.patient.findUnique({ where: { id } });
  }

  async updatePatient(id: number, data: { name: string; phoneNumber: string; email: string; prn: number }) {
    return this.prisma.patient.update({ where: { id }, data });
  }

  async deletePatient(id: number) {
    return this.prisma.patient.delete({ where: { id } });
  }
}
