import { Request, Response } from 'express';
import DoctorResolver from './doctor.resolver';
import { PrismaClient } from '@prisma/client';


const resolver = new DoctorResolver();
const prisma = new PrismaClient();

export const createDoctor = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      email,
      phone_number,
      departmentName, // This is the department name coming from frontend
      qualification,
      availabilityDays, // Days available // Timing from frontend (e.g., "09:00-10:00")
      slotDuration, // Duration of each slot
      unavailableDates, // Dates when doctor is unavailable
    } = req.body;
console.log(req.body)

   let availableFrom = req.body.availableFrom;
    // Validation to ensure all required fields are present
    if (!name || !email || !phone_number || !departmentName || !qualification || !availableFrom || !slotDuration || !availabilityDays) {
      res.status(400).json({ error: 'All fields are required.' });
      return;
    }

    // Find the department by its name to get its ID
    const foundDepartment = await prisma.department.findUnique({
      where: {
        name: departmentName,
      },
    });

    if (!foundDepartment) {
      res.status(400).json({ error: 'Invalid department name.' });
      return;
    }

    // Map through the availabilityDays object and create an array of available days
    // const availableDaysArray = Object.keys(availabilityDays).filter(day => availabilityDays[day]);
    // const availability = Object.entries(availabilityDays)
    //   .filter(([day, isAvailable]) => isAvailable)
    //   .map(([day]) => ({
    //     day,
    //     availableFrom: availableTime,
    //     availableTo: slotTiming,
    //   }));
    const availableDaysArray = [];
    for (const [day, isAvailable] of Object.entries(availabilityDays)) {
      if (isAvailable) {
        availableDaysArray.push({
          day,
          availableFrom,
          slotDuration,
        });
      }
    }
    // Create the doctor with the correct departmentId and availability details
    const newDoctor = await prisma.doctor.create({
      data: {
        name,
        email,
        phone_number,
        qualification,
        availableFrom,
        slotDuration,
        departmentId: foundDepartment.id,
        departmentName: foundDepartment.name,
        availability: {
          create: availableDaysArray
        },
        unavailableDates: unavailableDates ? {
          create: unavailableDates.map((date: string) => ({
            date: new Date(date),
          })),
        } : undefined,
      },
      include: {
        department: true, // Include department to get its details
      },
      
    });
console.log("after added",newDoctor)
    res.status(201).json(newDoctor);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        availability: true,
        department: true, // Include department to get its details
      },
    });
    res.json(doctors);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};


export const getDoctorById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;

    // Convert id to integer and handle non-numeric ids
    const doctorId = parseInt(id, 10);
    console.log("Doctor ID:", doctorId);
    console.log("Doctor ID in id:", id);
    // Return a response if id is not a valid number
    if (isNaN(doctorId)) {
      return res.status(400).json({ error: 'Id is wrong' });
    }

    // Find the doctor by ID in the database
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { availability: true, department: true },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    return res.status(200).json(doctor);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};

export const updateDoctor = async (req: Request, res: Response) => {
  console.log("Update Request Body before try:", req.body);
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone_number,
      departmentName,
      qualification,
      availabilityDays,
      availableFrom,
      unavailableDates = [],
    } = req.body;
    const slotDuration = parseInt(req.body.slotDuration);
    console.log(slotDuration)
    console.log("Update Request Body:", req.body);

    // Validation: Ensure all required fields are present
    if (!name || !email || !phone_number || !departmentName || !qualification || !availableFrom || !slotDuration) {
      res.status(400).json({ error: 'All fields are required.' });
      return;
    }

    // Find the department by its name to get its ID
    const foundDepartment = await prisma.department.findUnique({
      where: {
        name: departmentName,
      },
    });

    if (!foundDepartment) {
      res.status(400).json({ error: 'Invalid department name.' });
      return;
    }

    // Update the doctor with the basic fields
    await prisma.doctor.update({
      where: { id: Number(id) },
      data: {
        name,
        email,
        phone_number,
        qualification,
        departmentId: foundDepartment.id,
        departmentName: foundDepartment.name,
        availableFrom,
        slotDuration,
      },
    });

    // Delete and recreate availability entries
    await prisma.doctorAvailability.deleteMany({
      where: {
        doctorId: Number(id),
      },
    });

    const availabilityEntries = Object.entries(availabilityDays)
      .filter(([day, isAvailable]) => isAvailable)
      .map(([day]) => ({
        day,
        availableFrom,
        slotDuration,
        doctorId: Number(id),
      }));

    if (availabilityEntries.length > 0) {
      await prisma.doctorAvailability.createMany({
        data: availabilityEntries,
      });
    }

    // Delete and recreate unavailable dates
    await prisma.unavailableDates.deleteMany({
      where: {
        doctorId: Number(id),
      },
    });

    const unavailableDateEntries = unavailableDates.map((date: string) => ({
      date: new Date(date),
      doctorId: Number(id),
    }));

    if (unavailableDateEntries.length > 0) {
      await prisma.unavailableDates.createMany({
        data: unavailableDateEntries,
      });
    }

    // Return the updated doctor along with availability and unavailable dates
    const doctorWithRelations = await prisma.doctor.findUnique({
      where: { id: Number(id) },
      include: {
        availability: true,
        unavailableDates: true,
        department: true, // Include department to get its details
      },
    });

    res.status(200).json(doctorWithRelations);
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};



export const deleteDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await resolver.deleteDoctor(Number(id));
    res.json({ message: 'Doctor and related availability deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
  
};
export const getDoctorAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("Doctor ID from doctor:", req.query.doctorId);
    // Get doctorId from query and parse it to a number
    const doctorIdStr = req.query.doctorId as string;
    if (!doctorIdStr) {
       res.status(400).json({ error: 'Doctor ID is missing in the query parameters.' });
       return
    }

    // Convert doctorId to a number
    const doctorId = parseInt(doctorIdStr, 10);
    
    // Validate that doctorId is a number
    if (isNaN(doctorId)) {
       res.status(400).json({ error: 'id is not wrong' });
       return
    }

    const date = req.query.date as string;

    // Call the resolver to get availability
    const availability = await resolver.getDoctorAvailability(doctorId, date);
     res.status(200).json(availability);
     return;
  } catch (error) {
     res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
    return;
  }
};
export const addBookedSlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date, time } = req.body;
    const existingBooking = await prisma.bookedSlot.findFirst({
      where: {
        doctorId,
        date,
        time,
      },
    });
    console.log("Existing Booking:", existingBooking);
    if (existingBooking) {
       res.status(400).json({ error: 'Selected slot is already booked' });
       return;
    }

    if (!doctorId || !date || !time) {
      res.status(400).json({ error: 'Doctor ID, date, and time are required.' });
      return;
    }

    const bookedSlot = await prisma.bookedSlot.create({
      data: {
        doctorId,
        date,
        time,
      },
    });

    res.status(201).json(bookedSlot);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const getBookedSlots = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date } = req.query;

    // Validate the request parameters
    if (!doctorId || !date) {
      res.status(400).json({ error: 'Doctor ID and date are required.' });
      return;
    }

    // Query booked slots for the given doctor and date
    const bookedSlots = await prisma.bookedSlot.findMany({
      where: {
        doctorId: Number(doctorId),
        date: date as string,
      },
      select: {
        time: true,
      },
    });

    // Extract the times from the booked slots
    const bookedTimes = bookedSlots.map(slot => slot.time);

    res.status(200).json(bookedTimes);
  } catch (error) {
    console.error('Error fetching booked slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

