import { Request, Response } from 'express';
import AppointmentResolver from './appointment.resolver';
import DoctorRepository from '../doctor/doctor.repository';
import AppointmentRepository from './appointment.repository';

const resolver = new AppointmentResolver();
const doctorRepository = new DoctorRepository();
const appointmentRepository = new AppointmentRepository();

export const createAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    req.body.status = req.body.status === 'Confirm' ? 'confirmed' :
      req.body.status === 'Cancel' ? 'cancelled' : req.body.status;
    const {
      patientName,
      phoneNumber,
      doctorName,
      doctorId,
      department,
      time,
      status,
      email,
      requestVia,
      smsSent,
      emailSent
    } = req.body;

    // Convert the date to "YYYY-MM-DD" format
    let date = new Date(req.body.date).toISOString().split('T')[0];
    // Ensure the status field matches Prisma enum
    const bookedSlots = await doctorRepository.getBookedSlots(doctorId, date);
    const isSlotAvailable = !bookedSlots.some(slot => slot.time === time);
    if (!isSlotAvailable) {
      res.status(400).json({ error: 'Selected slot is not available' });
      return;
    }
    // Check availability before proceeding
    const day = new Date(req.body.date).toLocaleString('en-us', { weekday: 'short' }).toLowerCase(); // Get the day, e.g., 'mon', 'tue', etc.
    const doctorAvailability = await doctorRepository.getDoctorAvailability(doctorId, day);

    if (!doctorAvailability) {
      res.status(400).json({ error: 'Doctor is not available on the selected day.' });
      return;
    }

    const slotDuration = doctorAvailability.slotDuration;
    const availableFrom = doctorAvailability.availableFrom.split('-');
    const availableStartTime = availableFrom[0];
    const availableEndTime = availableFrom[1];

    // Check if the requested time falls within the available slots
    const requestedTime = time.split('-');
    if (requestedTime[0] < availableStartTime || requestedTime[1] > availableEndTime) {
      res.status(400).json({ error: 'Selected time slot is not available.' });
      return;
    }
    const userId = req.body.userId || null;
    // Create the appointment with Prisma
    const newAppointment = await resolver.createAppointment({
      patientName,
      phoneNumber,
      doctorName,
      doctorId,
      department,
      date, // Ensure the date is in the proper format
      time,
      status,
      email,
      requestVia,
      smsSent,
      emailSent,
      userId
    });
    console.log("New Appointment:", newAppointment);
    if (newAppointment.status === 'confirmed') {
      await doctorRepository.addBookedSlot(doctorId, date, time);
      res.status(201).json(newAppointment);
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};


export const getAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointments = await resolver.getAppointments();
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const updateAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.body.userId || null;
    const updatedAppointment = await resolver.updateAppointment(Number(req.params.id), {
      ...req.body,
      userId, // Add userId to track who updated the appointment
    });
    res.status(200).json(updatedAppointment);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const deleteAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    await resolver.deleteAppointment(Number(req.params.id));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// Endpoint to get total appointments for today
export const getTotalAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query; // Get today's date from query parameters
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const count = await appointmentRepository.getAppointmentsCountForDate(date as string);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

// Endpoint to get pending requests for today
export const getPendingAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query;
    const count = await appointmentRepository.getPendingAppointmentsCountForDate(date as string);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
export const getAppointmentsByUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, status } = req.query;

    // Find appointments filtered by userId and optionally by status
    const appointments = await appointmentRepository.findAppointmentsByUser(
      Number(userId),
      status ? status.toString() : undefined
    );

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
export const getDoctorReport = async (req: Request, res: Response): Promise<void> => {
  console.log("userId", req.query);
  try {
    const userId = req.query.userId ? Number(req.query.userId) : null;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    const report = await resolver.getDoctorReport(userId);
    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// export const lockAppointment = async (req: Request, res: Response): Promise<void> => {

//   try {
//     const appointmentId = Number(req.params.id);
//     const userId = req.user?.id;

//     if (!userId) {
//       res.status(400).json({ error: 'User ID is required' });
//       return;
//     }

//     // Find the appointment
//     const appointment = await appointmentRepository.getAppointmentById(appointmentId);

//     // Check if the appointment is already locked
//     if (appointment && appointment.lockedBy && appointment.lockExpiresAt && appointment.lockExpiresAt > new Date()) {
//       res.status(403).json({ error: 'This appointment is currently being accessed by another user.' });
//       return;
//     }


//     // Set the lock
//     const lockExpiresAt = new Date(new Date().getTime() + 15 * 60 * 1000); // Lock for 15 minutes
//     await appointmentRepository.lockAppointment(appointmentId, userId, lockExpiresAt);

//     res.status(200).json({ message: 'Appointment locked successfully' });
//   } catch (error) {
//     res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
//   }
// };
// export const unlockAppointment = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const appointmentId = Number(req.params.id);
//     await appointmentRepository.unlockAppointment(appointmentId);
//     res.status(200).json({ message: 'Appointment unlocked successfully' });
//   } catch (error) {
//     res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
//   }
// };


