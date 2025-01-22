import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default class AppointmentRepository {
  async create(data: any) {
    return await prisma.appointment.create({ data });
  }

  async findMany() {
    return await prisma.appointment.findMany({ include: { doctor: true, user: true } });
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
  async findAppointmentsByUser(userId: number, status?: string) {
    const whereClause: any = { userId };

    if (status) {
      whereClause.status = status;
    }

    return await prisma.appointment.findMany({
      where: whereClause,
      include: { doctor: true, user: true }
    });
  }
  async findAppointmentsByUserId(userId: number) {
    return await prisma.appointment.findMany({
      where: { userId },
      include: { doctor: true, user: true },
    });
  }

  async findAllAdminAppointments() {
    return await prisma.appointment.findMany({
      where: { user: { role: 'admin' } },
      include: { doctor: true, user: true },
    });
  }

  async findAppointmentsByAdminAndUser(userId: number) {
    const adminAppointments = await this.findAllAdminAppointments();
    const userAppointments = await this.findAppointmentsByUserId(userId);

    return [...adminAppointments, ...userAppointments];
  }
  async findAppointmentsByDoctorUserId(userId: number) {
    const doctor = await prisma.doctor.findFirst({ where: { id: userId } });
    console.log(doctor);
    if (!doctor) return [];
    return await prisma.appointment.findMany({ where: { doctorId: doctor.id }, include: { doctor: true, user: true } });
  }


  async lockAppointment(appointmentId: number, userId: number) {
    return await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        lockedBy: userId,
      },
    });
  }

  async unlockAppointment(appointmentId: number) {
    return await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        lockedBy: null,
      },
    });
  }
  async getAppointmentById(appointmentId: number) {
    return await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
  }
  async completeAppointment(appointmentId: number) {
    return await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'completed' },
    });
  }
 async getAppointmentsBySlot(doctorId: number, date: string, time: string) {
    return await prisma.appointment.findFirst({
      where: {
        doctorId,
        date,
        time,
      },
    });
  }
}
