import { Request, Response } from 'express';
import DoctorResolver from './doctor.resolver';
import { PrismaClient } from '@prisma/client';
import DoctorRepository from './doctor.repository';
import moment from 'moment-timezone';


const resolver = new DoctorResolver();
const prisma = new PrismaClient();
const doctorRepository = new DoctorRepository();

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
      unavailableSlots,
      availability
    } = req.body;
    console.log(req.body)

    let availableFrom = req.body.availableFrom;
    // Validation to ensure all required fields are present
    if (!name || !phone_number || !departmentName || !slotDuration || !availabilityDays) {
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
          create: availability
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
    console.log("unavailableSlots", unavailableSlots)
       // Create unavailable slots if they exist
      //  if (unavailableSlots && unavailableSlots.length > 0) {
      //   console.log("unavailableSlots in if", unavailableSlots)
      //   try {
      //     await prisma.unavailableSlot.createMany({
      //       data: unavailableSlots.map((time: string) => ({
      //         doctorId: newDoctor.id,
      //         time: time,
      //       })),
      //     });
  
      //     console.log("Unavailable Slots Inserted Successfully");
      //   } catch (error) {
      //     console.error("Error inserting unavailable slots:", error);
      //   }
      // }


    console.log("after added", newDoctor)
    res.status(201).json(newDoctor);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

// export const getDoctors = async (req: Request, res: Response) => {
//   try {
//     const doctors = await prisma.doctor.findMany({
//       include: {
//         availability: true,
//         department: true, // Include department to get its details
//       },
//     });
//     res.json(doctors);
//   } catch (error: any) {
//     res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
//   }
// };
// export const getDoctors = async (req: Request, res: Response) => {
//   try {
//     const requestedDate = req.query.date && typeof req.query.date === 'string' ? new Date(req.query.date) : new Date();

//     const doctors = await prisma.doctor.findMany({
//       include: {
//         availability: {
//           where: {
//             updatedAt: {
//               lte: requestedDate, // Get availability up to the requested date
//             },
//           },
//           orderBy: {
//             updatedAt: 'desc', // Get the most recent availability record for that date
//           },
//         },
//         department: true, // Include department to get its details
//       },
//     });
//     res.json(doctors);
//   } catch (error: any) {
//     res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
//   }
// };
export const getDoctors = async (req: Request, res: Response) => {
  try {
    // Capture the date from the query parameter, defaulting to the current date if not provided
    const usEasternTime = moment().tz('America/New_York');
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");

    const indianDate = indianTime.toDate();
    const requestedDate = req.query.date && typeof req.query.date === 'string' ? new Date(req.query.date) : indianDate
    const isToday = requestedDate.toDateString() === indianDate.toDateString();
    const isFuture = requestedDate > indianDate

    const doctors = await prisma.doctor.findMany({
      include: {
        // availability: {
        //   where: {
        //     AND: [
        //       {
        //         updatedAt: {
        //           lte: requestedDate, // Get availability updated on or before the requested date
        //         },
        //       },
        //       {
        //         OR: [
        //           {
        //             updatedAt: null, // Include availability where updatedAt is null (for older records)
        //           },
        //           {
        //             updatedAt: {
        //               not: null, // Ensure the availability has been updated at least once
        //             },
        //           },
        //         ],
        //       },
        //     ],
        //   },
        //   orderBy: {
        //     updatedAt: isToday ? 'desc' : isFuture ? 'desc' : 'asc', // For today, get the most recent past availability, for future use the latest, otherwise ascending for past dates
        //   },
        // },
        availability: {
          where: {
            OR: [
              {
                updatedAt: null, // Include availability where updatedAt is null (for older records)
              },
              {
                updatedAt: {
                  lte: requestedDate, // Get availability updated on or before the requested date
                },
              },
            ],
          },
          orderBy: {
            updatedAt: isToday ? 'desc' : isFuture ? 'desc' : 'asc', // For today, get the most recent past availability, for future use the latest, otherwise ascending for past dates
            // updatedAt: isToday || isFuture ? 'desc' : 'asc',
          },
        
        },
        department: true, // Include department to get its details
      },
    });

    const filteredDoctors = doctors.map((doctor) => {
      const relevantAvailability = doctor.availability.filter((avail) => {
        if (isToday) {
          return avail.updatedAt && avail.updatedAt <= requestedDate;
        } else if (isFuture) {
          return avail.updatedAt && avail.updatedAt <= requestedDate;
        } else {
          return avail.updatedAt === null || avail.updatedAt <= requestedDate;
        }
      }).slice(0, 1); // Take only the most relevant availability
      // console.log("Relevant Availability:", relevantAvailability);
      return {
        ...doctor,
        availability: relevantAvailability,
      };
    });
    // console.log("Filtered Doctors:", filteredDoctors, "Requested Date:", requestedDate);

    res.json(doctors);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};




export const getFutureBookedSlots = async (req: Request, res: Response) => {
  try {
    const usEasternTime = moment().tz('America/New_York');
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");

    const indianDate = indianTime.toDate();
    const requestedDate = req.query.date && typeof req.query.date === 'string' ? new Date(req.query.date) : indianDate
    const doctorId = parseInt(req.query.doctorId as string);

    const futureBookedSlots = await prisma.bookedSlot.findMany({
      where: {
        doctorId: doctorId,
        date: {
          gt: requestedDate.toISOString().split('T')[0], // Get booked slots after the requested date
        },
      },
      orderBy: {
        date: 'asc', // Order by date in ascending order
      },
    });

    res.json(futureBookedSlots);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};


export const getFutureBookedSlotsBoth = async (req: Request, res: Response): Promise<void> => {
  try {
    const usEasternTime = moment().tz('America/New_York');
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");

    const indianDate = indianTime.toDate();
    const requestedDate = req.query.date && typeof req.query.date === 'string' ? new Date(req.query.date) : indianDate;
    const doctorId = parseInt(req.query.doctorId as string);
    const individualAvailability = req.query.individualAvailability === 'true';
    const day = Number(req.query.dayOfWeek)

    if (isNaN(doctorId)) {
      res.status(400).json({ error: 'Invalid doctorId' });
      return;
    }

    let futureBookedSlots;

    if (individualAvailability) {
      console.log("Individual Availability:", individualAvailability);
      // Individual availability: check booked slots only for the specific day of the week
      const requestedDayOfWeek = requestedDate.getDay();

      // Fetch all future booked slots for the doctor and filter based on day of the week
      futureBookedSlots = await prisma.bookedSlot.findMany({
        where: {
          doctorId: doctorId,
          date: {
            gt: requestedDate.toISOString().split('T')[0], // Get booked slots after the requested date
          },
        },
        orderBy: {
          date: 'asc', // Order by date in ascending order
        },
      });
      console.log(futureBookedSlots,"Future Booked Slots:", futureBookedSlots);
      // Filter booked slots to only include those on the requested day of the week
      futureBookedSlots = futureBookedSlots.filter((slot) => {
        const slotDate = new Date(slot.date);
        console.log(slotDate.getDay(),day)
        return slotDate.getDay() === day;
      });
      console.log("Future Booked Slots:", futureBookedSlots);
    } else {
      // General availability: check all future booked slots for the doctor
      futureBookedSlots = await prisma.bookedSlot.findMany({
        where: {
          doctorId: doctorId,
          date: {
            gt: requestedDate.toISOString().split('T')[0], // Get booked slots after the requested date
          },
        },
        orderBy: {
          date: 'asc', // Order by date in ascending order
        },
      });
    }

    res.json(futureBookedSlots);
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};



export const getDoctorById = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;

    // Convert id to integer and handle non-numeric ids
    const doctorId = parseInt(id, 10);
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
      unavailableDates = [],
      unavailableSlots = [],
      availability
    } = req.body;
    const slotDuration = parseInt(req.body.slotDuration);
    let availableFrom = req.body.availableFrom;
    console.log(slotDuration)
    console.log("Update Request Body:", req.body);

    // Validation: Ensure all required fields are present
    if (!name || !phone_number || !departmentName  || !slotDuration) {
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
    // await prisma.doctorAvailability.deleteMany({
    //   where: {
    //     doctorId: Number(id),
    //   },
    // });

    // const availabilityEntries = Object.entries(availabilityDays)
    //   .filter(([day, isAvailable]) => isAvailable)
    //   .map(([day]) => ({
    //     day,
    //     availableFrom,
    //     slotDuration,
    //     doctorId: Number(id),
    //   }));
    console.log("availability", availability)
    const availabilityEntries = availability.map((avail: { day: string; availableFrom: string; slotDuration: number }) => ({
      day: avail.day,
      availableFrom: avail.availableFrom,
      slotDuration: avail.slotDuration,
      doctorId: Number(id), // Use the doctor ID here to link the availability
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
export const addUnavailableSlots = async (req: Request, res: Response) => {
  try {
    const { doctorId, date, times } = req.body;

    // Ensure all required fields are provided
    if (!doctorId || !date || !times || !Array.isArray(times)) {
      res.status(400).json({ error: 'Doctor ID, date, and an array of times are required.' });
      return;
    }

    // Validate the date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Expected format: YYYY-MM-DD.' });
      return;
    }

    // Delete existing unavailable slots for that date and doctor (if any)
    await prisma.unavailableSlot.deleteMany({
      where: {
        doctorId: Number(doctorId),
        date: date,
      },
    });

    // Insert new unavailable slots for the given date and doctor
    const unavailableSlotEntries = times.map((time: string) => ({
      doctorId: Number(doctorId),
      date: date,
      time,
    }));

    if (unavailableSlotEntries.length > 0) {
      await prisma.unavailableSlot.createMany({
        data: unavailableSlotEntries,
      });
    }
console.log("unavailableSlotEntries",unavailableSlotEntries)
    res.status(201).json({ message: 'Unavailable slots updated successfully.' });
  } catch (error) {
    console.error('Error adding unavailable slots:', error);
    res.status(500).json({ error: 'An error occurred while updating unavailable slots.' });
  }
};

export const getUnavailableSlots = async (req: Request, res: Response) => {
  try {
    const doctorId = req.params.id;

    if (!doctorId) {
      res.status(400).json({ error: 'Doctor ID is required.' });
      return;
    }

    const unavailableSlots = await prisma.unavailableSlot.findMany({
      where: {
        doctorId: Number(doctorId),
      },
      select: {
        date: true,
        time: true,
      },
    });

    // Format the response to group times by date
    const response = unavailableSlots.reduce((acc: any, slot) => {
      if (!acc[slot.date]) {
        acc[slot.date] = [];
      }
      acc[slot.date].push(slot.time);
      return acc;
    }, {});

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching unavailable slots:', error);
    res.status(500).json({ error: 'An error occurred while fetching unavailable slots' });
  }
};

export const getUnavailableSlotsByDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const docId = parseInt(req.params.docId);
    const date = req.params.date;

    if (isNaN(docId)) {
      res.status(400).json({ error: 'Invalid doctor ID' }); // Removed `return`
      return; // Ensure the function exits after sending a response
    }

    const unavailableSlots = await prisma.unavailableSlot.findMany({
      where: {
        doctorId: docId,
        date: date,
      },
    });

    res.status(200).json(unavailableSlots); // Removed `return`
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Cannot fetch unavailable slots' }); // Removed `return`
  }
};

export const deleteDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doctorId = Number(id);

    // Validate that id is a number
    if (isNaN(doctorId)) {
      res.status(400).json({ error: 'Invalid doctor ID' });
      return;
    }

    // Step 1: Delete related booked slots
    await prisma.bookedSlot.deleteMany({
      where: { doctorId },
    });

    // Step 2: Delete related unavailable dates
    await prisma.unavailableDates.deleteMany({
      where: { doctorId },
    });

    // Step 3: Delete related doctor availability
    await prisma.doctorAvailability.deleteMany({
      where: { doctorId },
    });

    // Step 4: Delete related appointments
    await prisma.appointment.deleteMany({
      where: { doctorId },
    });

    // Step 5: Finally, delete the doctor
    await prisma.doctor.delete({
      where: { id: doctorId },
    });

    res.json({ message: 'Doctor and related records deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting doctor:', error);
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
    const dateObject = new Date(date);

// Convert the date object to the day of the week
const day = dateObject.toLocaleString('en-us', { weekday: 'short' }).toLowerCase(); 
console.log("Day:", day);

    // Call the resolver to get availability
    const availability = await resolver.getDoctorAvailability(doctorId, day, date);
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
        complete: false,
      },
    });
    console.log("Booked Slot is working:", bookedSlot);

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
        complete:true
      },
    });

    // Extract the times from the booked slots
    const bookedTimes = bookedSlots;

    res.status(200).json(bookedTimes);
  } catch (error) {
    console.error('Error fetching booked slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const cancelBookedSlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date, time } = req.body;
    console.log("Doctor ID:", req.body);

    // Validate the request parameters
    if (!doctorId || !date || !time) {
      res.status(400).json({ error: 'Doctor ID, date, and time are required.' });
      return;
    }

    // Check if the slot is already canceled
    const existingBooking = await prisma.bookedSlot.findMany({
      where: {
        doctorId,
        date,
        time,
      },
    });

    if (!existingBooking) {
      res.status(404).json({ error: 'No booking found for the selected slot' });
      return;
    }
    console.log("Existing Booking:", existingBooking);
    // Delete the booked slot from the BookedSlot table
    await prisma.bookedSlot.deleteMany({
      where: {
        doctorId,
        date,
        time // Deleting by the unique ID of the booked slot
      },
    });

    res.status(200).json({ message: 'Slot successfully canceled and is now available for rebooking.' });
  } catch (error) {
    console.error('Error cancelling the booked slot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const updateBookedSlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date, time } = req.body;

    // Validate the request parameters
    if (!doctorId || !date || !time) {
      res.status(400).json({ error: 'Doctor ID, date, and time are required.' });
      return;
    }

    // Check if the slot is already canceled
    const existingBooking = await prisma.bookedSlot.findMany({
      where: {
        doctorId,
        date,
        time,
      },
    });

    if (!existingBooking) {
      res.status(404).json({ error: 'No booking found for the selected slot' });
      return;
    }

    // Update the booked slot to mark it as complete
        // Update the booked slot to mark it as complete
        const updatedBooking = await prisma.bookedSlot.updateMany({
          where: {
            doctorId,
            date,
            time,
          },
          data: {
            complete: true, // Mark the slot as complete
          },
        });

    res.status(200).json({ updatedBooking, message: 'Slot successfully marked as complete.' });
  } catch (error) {
    console.error('Error updating the booked slot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
// Create or Update Unavailable Dates for Doctor
export const addUnavailableDates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, startDate, endDate } = req.body;

    if (!doctorId || !startDate || !endDate) {
      res.status(400).json({ error: 'Doctor ID, start date, and end date are required.' });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Generate the dates between start and end date
    const unavailableDates = [];
    let currentDate = new Date(start);
    while (currentDate <= end) {
      unavailableDates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Delete existing unavailable dates for that range
    await prisma.unavailableDates.deleteMany({
      where: {
        doctorId: Number(doctorId),
        date: {
          gte: start,
          lte: end,
        },
      },
    });

    // Add new unavailable dates
    const unavailableDateEntries = unavailableDates.map((date) => ({
      date,
      doctorId: Number(doctorId),
    }));

    if (unavailableDateEntries.length > 0) {
      await prisma.unavailableDates.createMany({
        data: unavailableDateEntries,
      });
    }

    res.status(201).json({ message: 'Unavailable dates updated successfully.' });
  } catch (error) {
    console.error('Error adding unavailable dates:', error);
    res.status(500).json({ error: 'An error occurred while updating unavailable dates.' });
  }
};

export const markDatesAsAvailable = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.params; // Extract doctor ID from request parameters
    const { startDate, endDate } = req.body; // Extract start and end date from request body

    if (!doctorId || !startDate || !endDate) {
      res.status(400).json({ error: 'Doctor ID, start date, and end date are required.' });
      return;
    }

    // Deleting unavailable dates for given doctor and date range
    await prisma.unavailableDates.deleteMany({
      where: {
        doctorId: Number(doctorId),
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });

    res.status(200).json({ message: 'Dates marked as available successfully.' });
  } catch (error) {
    console.error('Error marking dates as available:', error);
    res.status(500).json({ error: 'An error occurred while marking dates as available.' });
  }
};


// Get Unavailable Dates for Doctor
export const getUnavailableDates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId } = req.query;

    if (!doctorId) {
      res.status(400).json({ error: 'Doctor ID is required.' });
      return;
    }

    const unavailableDates = await prisma.unavailableDates.findMany({
      where: {
        doctorId: Number(doctorId),
      },
      select: {
        date: true,
      },
    });

    res.status(200).json(unavailableDates); 
  } catch (error) {
    console.error('Error fetching unavailable dates:', error);
    res.status(500).json({ error: 'An error occurred while fetching unavailable dates.' });
  }
};
export const getAvailableDoctors = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query;
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const availableDoctors = await resolver.getAvailableDoctors(date as string);
    console.log("available", availableDoctors)
    res.status(200).json(availableDoctors);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const getAvailableDoctorsCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query;
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const count = await resolver.getAvailableDoctorsCount(date as string);
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
export const addExtraSlot = async (req: Request, res: Response): Promise<void> => {
  try{
    const { doctorId, date, time } = req.body;
    const result = await prisma.extraSlot.create({
      data: {
        doctorId,
        date,
        time,
      }
    });
    res.status(200).json({ success: true, result });
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }

}
export const getExtraSlots = async (req: Request, res: Response): Promise<void> => {
  try{
  const date = req.query.date;
  const doctorId = req.params.id;
    const extraSlots = await prisma.extraSlot.findMany({
      where: {
        doctorId: Number(doctorId),
        date: date as string,
      },
      select: {
        time: true,
      },
    });
    res.status(200).json(extraSlots);
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}