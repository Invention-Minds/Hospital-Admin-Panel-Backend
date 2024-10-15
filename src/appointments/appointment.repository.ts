import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default class AppointmentRepository {
  async create(data: any) {
    return await prisma.appointment.create({ data });
  }

  async findMany() {
    return await prisma.appointment.findMany({ include: { doctor: true } });
  }

  async update(id: number, data: any) {
    return await prisma.appointment.update({ where: { id }, data });
  }

  async delete(id: number) {
    return await prisma.appointment.delete({ where: { id } });
  }
  async isSlotAvailable(doctorId: number, date: string, time: string): Promise<boolean> {
    const appointment = await prisma.appointment.findFirst({
      where: {
        doctorId,
        date,
        time,
      },
    });
    return !appointment; // Returns true if no appointment exists for the given date and time
  }
  async getAppointmentsCountForDate(date: string): Promise<number> {
    return await prisma.appointment.count({
      where: {
        date,
      },
    });
  }

  // Method to get the count of pending requests for the given date
  async getPendingAppointmentsCountForDate(date: string): Promise<number> {
    return await prisma.appointment.count({
      where: {
        date,
        status: 'pending',
      },
    });
  }
}
