import { Request, Response } from 'express';
import AppointmentResolver from './appointment.resolver';
import DoctorRepository from '../doctor/doctor.repository';
import AppointmentRepository from './appointment.repository';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let clients: Response[] = [];
const resolver = new AppointmentResolver();
const doctorRepository = new DoctorRepository();
const appointmentRepository = new AppointmentRepository();


export const registerForUpdates = (req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);

  // Remove the client if it closes the connection
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
};


// Notify all connected clients of a new appointment with 'pending' status
export const notifyPendingAppointments = (newAppointment: any): void => {
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(newAppointment)}\n\n`);
  });
};

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
      emailSent,
      messageSent,
      prnNumber
    } = req.body;
    console.log(req.body);

    // Convert the date to "YYYY-MM-DD" format
    let date = new Date(req.body.date).toISOString().split('T')[0];
    console.log(date,'selected slot is not available')

    // Ensure the status field matches Prisma enum
    const bookedSlots = await doctorRepository.getBookedSlots(doctorId, date);
    const nonCompleteBookedSlots = bookedSlots.filter(slot => !slot.complete);
    console.log(nonCompleteBookedSlots,'selected slot is not available oncomplete')
    const isSlotAvailable = !nonCompleteBookedSlots.some(slot => slot.time === time);
    console.log(isSlotAvailable,'selected slot is not available on slot')
    if (!isSlotAvailable) {
      res.status(400).json({ error: 'Selected slot is not available' });
      return;
    }
    // Check availability before proceeding
    const day = new Date(req.body.date).toLocaleString('en-us', { weekday: 'short' }).toLowerCase(); // Get the day, e.g., 'mon', 'tue', etc.
    console.log(day,'selected slot is not available request')
    const doctorAvailability = await doctorRepository.getDoctorAvailability(doctorId, day);
    console.log(doctorAvailability,'selected slot is not available request')

    if (!doctorAvailability) {
      res.status(400).json({ error: 'Doctor is not available on the selected day.' });
      return;
    }

    const slotDuration = doctorAvailability.slotDuration;
    const availableFrom = doctorAvailability.availableFrom.split('-');
    const availableStartTime = availableFrom[0];
    const availableEndTime = availableFrom[1];
console.log(availableStartTime,availableEndTime,'selected slot is not available request')
    // Check if the requested time falls within the available slots
    const requestedTime = time.split('-');
    console.log(requestedTime,'selected slot is not available request')
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
      messageSent,
      userId,
      prnNumber
    });
    console.log("New Appointment:", newAppointment);
    if (newAppointment.status === 'pending') {
      notifyPendingAppointments(newAppointment);
    }
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
    // Destructure and remove unnecessary nested objects before updating
    const { id, doctor, user, ...updateData } = req.body;

    // Include userId if needed
    if (userId) {
      updateData.userId = userId;
    }

    const updatedAppointment = await resolver.updateAppointment(Number(req.params.id), updateData);
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
export const lockAppointment = async (req: Request, res: Response): Promise<void> => {
  console.log(req.body)
  try {
    const appointmentId = Number(req.params.id);
    const userId = req.body.userId;
    const userIdNum = Number(userId);
    console.log(appointmentId,userId)
    const appointment = await appointmentRepository.getAppointmentById(appointmentId);
    if (!appointment) {
      res.status(404).json({ message: 'Appointment not found' });
      return;
    }
    console.log(appointment.lockedBy);
    // if (appointment.lockedBy && appointment.lockedBy !== userId) {
    //   res.status(423).json({ message: 'Appointment is currently locked by another user.' });
    //   return;
    // }
    const lockedAppointment = await resolver.lockAppointment(appointmentId, userIdNum);
console.log(lockedAppointment,"locked")
    if (!lockedAppointment) {
       res.status(409).json({ message: 'Appointment is currently locked by another user.' });
       return;
    }

    res.status(200).json(lockedAppointment);
  } catch (error) {
    console.error('Error locking appointment:', error);
    res.status(500).json({ error: 'Failed to lock appointment' });
  }
};
export const scheduleCompletion = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);
    const delayMinutes = req.body.delayMinutes;

    if (!delayMinutes || isNaN(delayMinutes)) {
      res.status(400).json({ message: 'Invalid delay minutes' });
      return;
    }
    console.log(appointmentId,delayMinutes)
    await resolver.scheduleAppointmentCompletion(appointmentId, delayMinutes);
    res.status(200).json({ message: 'Appointment completion scheduled successfully' });
  } catch (error) {
    console.error('Error scheduling appointment completion:', error);
    res.status(500).json({ error: 'Failed to schedule appointment completion' });
  }
};
// Controller function to handle the check-in action
export const checkInAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Update the checkedIn status for the specified appointment
    const updatedAppointment = await prisma.appointment.update({
      where: {
        id: Number(id),
      },
      data: {
        checkedIn: true,
      },
    });

    res.status(200).json({ message: 'Appointment checked in successfully', updatedAppointment });
  } catch (error) {
    console.error('Error updating check-in status:', error);
    res.status(500).json({ error: 'An error occurred while updating the check-in status' });
  }
};

export const unlockAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);

    const unlockedAppointment = await resolver.unlockAppointment(appointmentId);
    res.status(200).json(unlockedAppointment);
  } catch (error) {
    console.error('Error unlocking appointment:', error);
    res.status(500).json({ error: 'Failed to unlock appointment' });
  }
};
export const getAppointmentsBySlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date, time } = req.query;

    if (!doctorId || !date || !time) {
      res.status(400).json({ error: 'Doctor ID, date, and time are required' });
      return;
    }

    const appointments = await appointmentRepository.getAppointmentsBySlot(
      Number(doctorId),
      date as string,
      time as string
    );

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}


