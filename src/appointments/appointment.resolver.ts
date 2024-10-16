import AppointmentRepository from './appointment.repository';

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
}
