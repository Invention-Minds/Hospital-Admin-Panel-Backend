import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ServiceRepository {
  // Create Service with Repeated Dates
  async createService(formData: any, repeatedDates: string[]) {
    return await prisma.service.create({
      data: {
        pnrNumber: formData.pnrNumber,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phoneNumber: formData.phoneNumber,
        email: formData.email,
        package: formData.packageType,
        appointmentDate: formData.appointmentDate,
        appointmentTime: formData.appointmentTime,
        repeatChecked: formData.repeatChecked,
        daysInterval: formData.daysInterval,
        numberOfTimes: formData.numberOfTimes,
        requestVia: formData.requestVia,
        appointmentStatus: formData.appointmentStatus,
        repeatedDates: {
          create: repeatedDates.map((date) => ({ date: date })),
        },
        packageName: formData.packageName,
      },
      include: { repeatedDates: true },
    });
  }

  // Update Service
  async updateService(id: number, formData: any, repeatedDates: string[]) {
    return await prisma.service.update({
      where: { id },
      data: {
        ...formData,
        repeatedDates: {
          deleteMany: {}, // Clear previous repeated dates
          create: repeatedDates.map((date) => ({ date: new Date(date) })),
        },
      },
      include: { repeatedDates: true },
    });
  }

  // Get All Services
  async getAllServices() {
    return await prisma.service.findMany({
      include: { repeatedDates: true },
    });
  }

  // Get Single Service by ID
  async getServiceById(id: number) {
    return await prisma.service.findUnique({
      where: { id },
      include: { repeatedDates: true },
    });
  }

  // Delete Service
  async deleteService(id: number) {
    return await prisma.service.delete({
      where: { id },
    });
  }
  // Add Repeated Dates to Existing Service
async addRepeatedDates(serviceId: number, repeatedDates: string[]) {
    return await prisma.repeatedDate.createMany({
      data: repeatedDates.map((date) => ({
        date: date,
        serviceId,
      })),
    });
  }
  
  // Get Repeated Dates by Service ID
  async getRepeatedDatesByServiceId(serviceId: number) {
    return await prisma.repeatedDate.findMany({
      where: { serviceId },
    });
  }
  async completeService(serviceId: number): Promise<void> {
    try {
      // Update the service status to 'completed'
      const updatedService = await prisma.service.update({
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
    return prisma.service.update({
      where: { id: serviceId },
      data: { lockedBy: userId },
    });
  }
  
  async unlockService(serviceId: number): Promise<any> {
    return prisma.service.update({
      where: { id: serviceId },
      data: { lockedBy: null },
    });
  }
  
}

