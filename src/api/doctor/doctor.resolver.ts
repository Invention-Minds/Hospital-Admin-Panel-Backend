import DoctorRepository from './doctor.repository';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export default class DoctorResolver {
  private repository = new DoctorRepository();

  // Create a new doctor
  public async createDoctor(data: any) {
    return await this.repository.createDoctor(data);
  }

  // Get all doctors
  public async getDoctors() {
    return await this.repository.getDoctors();
  }

  // Get a doctor by ID
  public async getDoctorById(id: number) {
    return await this.repository.getDoctorById(id);
  }

  // Update a doctor by ID
  public async updateDoctor(id: number, data: any) {
    return await this.repository.updateDoctor(id, data);
  }

  // Delete a doctor by ID
  public async deleteDoctor(id: number) {
    return await this.repository.deleteDoctor(id);
  }
  public async getDoctorAvailability(doctorId: number, day: string) {
    try {
      // Fetch availability details for the specific doctor and day
      const availability = await this.repository.getDoctorAvailability(doctorId, day);
      console.log(availability);
      if (!availability) {
        return null;
      }

      // Return available slots and slot duration details
      return {
        availableFrom: availability.availableFrom,
        slotDuration: availability.slotDuration,
      };
    } catch (error) {
      console.error('Error fetching doctor availability:', error);
      throw new Error('Unable to fetch doctor availability.');
    }
  }
  async getAvailableDoctors(date: string): Promise<any[]> {
    const unavailableDoctorIds = await this.repository.getUnavailableDoctors(date);
    console.log('Unavailable doctors in resolver:', unavailableDoctorIds);
    const availableDoctors = await prisma.doctor.findMany({
      where: {
        id: { notIn: unavailableDoctorIds },
      },
    });
    console.log('Available doctors:', availableDoctors);
    return availableDoctors;
  }

  async getAvailableDoctorsCount(date: string): Promise<number> {
    return this.repository.getAvailableDoctorsCount(date);
  }
}
