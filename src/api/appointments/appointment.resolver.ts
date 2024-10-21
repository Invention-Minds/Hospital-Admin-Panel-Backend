import AppointmentRepository from './appointment.repository';
import { PrismaClient } from '@prisma/client';
import { scheduleAppointmentCompletionJob } from './appointment.scheduler';
const prisma = new PrismaClient();
export default class AppointmentResolver {
  private repository: AppointmentRepository;

  constructor() {
    this.repository = new AppointmentRepository();
  }

  async createAppointment(data: any) {
    return await this.repository.create(data);
  }
  async checkAvailability(doctorId: number, date: string, time: string): Promise<boolean> {
    return await this.repository.isSlotAvailable(doctorId, date, time);
  }

  async getAppointments() {
    return await this.repository.findMany();
  }

  async updateAppointment(id: number, data: any) {
    return await this.repository.update(id, data);
  }

  async deleteAppointment(id: number) {
    return await this.repository.delete(id);
  }
  async getAppointmentsByUser(userId: number) {
    return await this.repository.findAppointmentsByUserId(userId);
  }

  async getAllAdminAppointmentsAndUser(userId: number) {
    return await this.repository.findAppointmentsByAdminAndUser(userId);
  }
  async getDoctorReport(userId: number) {
    return await this.repository.findAppointmentsByDoctorUserId(userId);
  }
  async lockAppointment(appointmentId: number, userId: number) {
    const appointment = await this.repository.getAppointmentById(appointmentId);

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Check if the appointment is already locked by another user
    if (appointment.lockedBy && appointment.lockedBy !== userId) {
      // Appointment is locked by someone else
      return null;
    }

    // Lock the appointment for the current user
    return await this.repository.lockAppointment(appointmentId, userId);
  }

  // Method to unlock an appointment
  async unlockAppointment(appointmentId: number) {
    const appointment = await this.repository.getAppointmentById(appointmentId);

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Unlock the appointment
    return await this.repository.unlockAppointment(appointmentId);
  }
  async scheduleAppointmentCompletion(appointmentId: number, delayMinutes: number): Promise<void> {
    const appointment = await this.repository.getAppointmentById(appointmentId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Schedule the appointment completion job
    scheduleAppointmentCompletionJob(appointmentId, delayMinutes);
  }
}


