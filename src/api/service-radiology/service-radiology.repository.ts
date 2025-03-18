import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ServiceRadiologyRepository {
  // Create Service with Repeated Dates
  async createService(formData: any, repeatedDates: string[]) {
    return await prisma.serviceAppointments.create({
      data: {
        pnrNumber: formData.pnrNumber,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phoneNumber: formData.phoneNumber,
        email: formData.email,
        appointmentDate: formData.appointmentDate,
        appointmentTime: formData.appointmentTime,
        requestVia: formData.requestVia || 'Call'
      },
    });
  }

  // Update Service
  async updateService(id: number, formData: any, repeatedDates: string[]) {
    return await prisma.serviceAppointments.update({
      where: { id },
      data: {
        ...formData,

      },
    });
  }

  // Get All Services
  async getAllServices() {
    return await prisma.serviceAppointments.findMany({
      include: { RadioService : true },
    });
  }

  // Get Single Service by ID
  async getServiceById(id: number) {
    return await prisma.serviceAppointments.findUnique({
      where: { id },
    });
  }

  // Delete Service
  async deleteService(id: number) {
    return await prisma.serviceAppointments.delete({
      where: { id },
    });
  }

  async completeService(serviceId: number): Promise<void> {
    try {
      // Update the service status to 'completed'
      const updatedService = await prisma.serviceAppointments.update({
        where: { id: serviceId },
        data: {
          appointmentStatus: 'complete',
          updatedAt: new Date(), // Update the timestamp to the current time
        },
      });
      console.log(`Service ID ${serviceId} marked as completed:`, updatedService);
    } catch (error) {
      console.error(`Error completing service ID ${serviceId}:`, error);
      throw new Error('Failed to complete service');
    }
  }
  async lockService(serviceId: number, userId: number): Promise<any> {
    return prisma.serviceAppointments.update({
      where: { id: serviceId },
      data: { lockedBy: userId },
    });
  }
  
  async unlockService(serviceId: number): Promise<any> {
    return prisma.serviceAppointments.update({
      where: { id: serviceId },
      data: { lockedBy: null },
    });
  }
  
}

