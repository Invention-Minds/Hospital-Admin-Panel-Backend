import { PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
const prisma = new PrismaClient();

export default class DoctorRepository {
  private prisma = new PrismaClient();

  // Method to create a new doctor
  public async createDoctor(data: any) {
    return await this.prisma.doctor.create({
      data,
      include: {
        availability: true,
      },
    });
  }
  private getDayOfWeek(dateString: string): string {
    const date = new Date(dateString);
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[date.getDay()];
  }
  // Method to get all doctors
  public async getDoctors() {
    return await this.prisma.doctor.findMany({
      include: {
        availability: true,
      },
    });
  }
  public async getDoctorAvailability(doctorId: number, day: string,date: string) {
    // const day = this.getDayOfWeek(date);
    const usEasternTime = moment().tz('America/New_York');
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");
   
    // Store the date and time in two separate variables
    // const indianDate = indianTime;
    console.log("Fetching availability for doctorId:", doctorId, "on day:", day);
    const dateObject = new Date(date);
    const indianDate = indianTime.toDate();
    const isFuture = dateObject > indianDate
    const isToday = dateObject.toDateString() === indianDate.toDateString();
    return await prisma.doctorAvailability.findFirst({
      where: {
        doctorId,
        day,
      //   OR: [
      //     {
      //       updatedAt: {
      //         lte: dateObject, // Get availability up to the requested date
      //       },
      //     },
      //     {
      //       updatedAt: null, // Include availability where updatedAt is null (for older records)
      //     },
      //   ],
      // },
      // orderBy: {
      //   updatedAt: 'desc', // Get the most recent availability record for that date
      // },
    //   OR: [
    //     {
    //       updatedAt: {
    //         lte: dateObject, // Get availability up to the requested date
    //       },
    //     },
    //     {
    //       updatedAt: null, // Include availability where updatedAt is null (for older records)
    //     },
    //   ],
    // },
    // orderBy: {
    //   updatedAt: isToday ? 'desc' : 'asc', // For today, get the most recent availability record; otherwise, get past availability
    // },
 
        OR: [
          {
            updatedAt: null, // Include availability where updatedAt is null (for older records)
          },
          {
            updatedAt: {
              lte: dateObject, // Get availability updated on or before the requested date
            },
          },
        ],
      },
      orderBy: {
        updatedAt: isToday ? 'desc' : isFuture ? 'desc' : 'asc', // For today, get the most recent past availability, for future use the latest, otherwise ascending for past dates
      },
    
      
    });
  }

  // Method to find a specific doctor by ID
  public async getDoctorById(id: number) {
    return await this.prisma.doctor.findUnique({
      where: { id },
      include: { availability: true },
    });
  }

  // Method to update doctor information
  public async updateDoctor(id: number, data: any) {
    return await this.prisma.doctor.update({
      where: { id },
      data,
      include: {
        availability: true,
      },
    });
  }

  // Method to delete a doctor
  public async deleteDoctor(id: number) {
    // Delete availability first
    await this.prisma.doctorAvailability.deleteMany({
      where: { doctorId: id },
    });
    // Delete doctor
    return await this.prisma.doctor.delete({
      where: { id },
    });
  }
  // Method to add a booked slot to the BookedSlot model
public async addBookedSlot(doctorId: number, date: string, time: string) {
  console.log('Booked slot added successfully');
  return await this.prisma.bookedSlot.create({
    data: {
      doctorId,
      date,
      time,
      complete: false,
    },
  });
  
}
public async completeBookedSlot(doctorId: number, date: string, time: string) {
  return await this.prisma.bookedSlot.updateMany({
    where: {
      doctorId,
      date,
      time,
    },
    data: {
      complete: true,  // Set complete to true
    },
  });
}
// Method to get booked slots for a specific doctor and date
public async getBookedSlots(doctorId: number, date: string) {
  return await this.prisma.bookedSlot.findMany({
    where: {
      doctorId,
      date,
    },
  });
}
async getAvailableDoctorsCountForDate(date: string): Promise<number> {
  return await prisma.doctor.count({
    where: {
      unavailableDates: {
        none: {
          date: new Date(date),
        },
      },
    },
  });
}
async getUnavailableDoctors(date: string): Promise<number[]> {
  const unavailableDoctors = await prisma.unavailableDates.findMany({
    where: { date: new Date(date) },
    select: { doctorId: true },
  });
  console.log('Unavailable doctors:', unavailableDoctors);
  return unavailableDoctors
    .filter((doctor) => doctor.doctorId !== null)
    .map((doctor) => doctor.doctorId as number);
}

async getAvailableDoctorsCount(date: string): Promise<number> {
  const unavailableDoctorIds = await this.getUnavailableDoctors(date);
  const totalDoctorsCount = await prisma.doctor.count();
  return totalDoctorsCount - unavailableDoctorIds.length;
}

}
