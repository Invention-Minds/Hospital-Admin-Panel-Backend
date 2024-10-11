import { Request, Response } from 'express';
import AppointmentResolver from './appointment.resolver';
import  DoctorRepository  from '../doctor/doctor.repository';

const resolver = new AppointmentResolver();
const doctorRepository = new DoctorRepository();

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
        smsSent
      } = req.body;
  
      // Convert the date to "YYYY-MM-DD" format
      let date= new Date(req.body.date).toISOString().split('T')[0];
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
        smsSent
      });
  console.log("New Appointment:", newAppointment);
  await doctorRepository.addBookedSlot(doctorId, date, time);
      res.status(201).json(newAppointment);
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
    const updatedAppointment = await resolver.updateAppointment(Number(req.params.id), req.body);
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
