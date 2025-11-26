import { Request, Response } from 'express';
import AppointmentResolver from './appointment.resolver';
import DoctorRepository from '../doctor/doctor.repository';
import AppointmentRepository from './appointment.repository';
import { PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
import axios from 'axios';

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
export const notifyPendingAppointments = (newNotification: any): void => {
  console.log('Notifying clients of new appointment:', newNotification);
  clients.forEach(client => {
    client.write(`event: appointment\n`);
    client.write(`data: ${JSON.stringify(newNotification)}\n\n`);
  });
  // console.log('Clients notified',clients);
};
export const notifyRemoveChannels = (removedId: any): void => {
  console.log('Notifying clients of remove doctor:', removedId);
  clients.forEach(client => {
    client.write(`event: channelRemoval\n`);
    client.write(`data: ${JSON.stringify(removedId)}\n\n`);
  });
};
export const notifyDoctor = (doctorId: any): void => {
  console.log('Notifying clients of checkin appt doctor:', doctorId);
  clients.forEach(client => {
    client.write(`event: loadDoctor\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
};
export const loadTv = (type: any): void => {
  console.log('Notifying clients of ad loading:', type);
  clients.forEach(client => {
    client.write(`event: loadTv\n`);
    client.write(`data: ${JSON.stringify(type)}\n\n`);
  });
};

export const messageSent = (doctorId: any): void => {
  console.log('Notifying clients of message doctor:', doctorId);
  clients.forEach(client => {
    client.write(`event: messageSent\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
}
export const adminAlertSent = (doctorId: any): void => {
  console.log('Notifying clients of message doctor:', doctorId);
  clients.forEach(client => {
    client.write(`event: adminAlertSent\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
}

export const loadOtTV = (doctorId: any): void => {
  console.log('Notifying clients of load ot tv:', doctorId);
  clients.forEach(client => {
    client.write(`event: loadOtTv\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
}

export const loadTherapyTv = (type: any): void => {
  console.log('Notifying clients of therapy tv  loading:', type);
  clients.forEach(client => {
    client.write(`event: loadTherapyTv\n`);
    client.write(`data: ${JSON.stringify(type)}\n\n`);
  });
}

export const loadTherapyTvForTherapist = (therapistId: number): void => {
  console.log("Notify therapist:", therapistId);

  clients.forEach(client => {
      client.write(`event: therapistUpdate\n`);
      client.write(`data: ${JSON.stringify( therapistId )}\n\n`);
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
      prnNumber,
      doctorType,
      age,
      gender,
      serviceId,
      patientType,
      prefix
    } = req.body;
    console.log(req.body, 'request');

    // Convert the date to "YYYY-MM-DD" format
    let date = new Date(req.body.date).toISOString().split('T')[0];
    console.log(date, 'selected slot is not available')

    // Ensure the status field matches Prisma enum
    const bookedSlots = await doctorRepository.getBookedSlots(doctorId, date);
    const nonCompleteBookedSlots = bookedSlots.filter(slot => !slot.complete);
    console.log(nonCompleteBookedSlots, 'selected slot is not available oncomplete')
    const isSlotAvailable = !nonCompleteBookedSlots.some(slot => slot.time === time);
    console.log(isSlotAvailable, 'selected slot is not available on slot')
    if (!isSlotAvailable) {
      res.status(400).json({ error: 'Selected slot is not available' });
      return;
    }
    // Check availability before proceeding
    const day = new Date(req.body.date).toLocaleString('en-us', { weekday: 'short' }).toLowerCase(); // Get the day, e.g., 'mon', 'tue', etc.
    console.log(day, 'selected slot is not available request')
    // const doctorAvailability = await doctorRepository.getDoctorAvailability(doctorId, day,date);
    // console.log(doctorAvailability,'selected slot is not available request')

    // if (!doctorAvailability) {
    //   res.status(400).json({ error: 'Doctor is not available on the selected day.' });
    //   return;
    // }
    // Check if the doctor is a Visiting Consultant
    if (doctorType === 'Visiting Consultant') {
      console.log('Skipping availability check for Visiting Consultant.');
      // Allow the process to continue without checking availability
    } else {
      // Check availability only for regular doctors
      const doctorAvailability = await doctorRepository.getDoctorAvailability(doctorId, day, date);


      console.log(doctorAvailability, 'selected slot is not available request');

      if (!doctorAvailability) {
        res.status(400).json({ error: 'Doctor is not available on the selected day.' });
        return;
      }
      const slotDuration = doctorAvailability.slotDuration;
      const availableFrom = doctorAvailability.availableFrom.split('-');
      const availableStartTime = availableFrom[0];
      const availableEndTime = availableFrom[1];
      console.log(availableStartTime, availableEndTime, 'selected slot is not available request')
    }


    // Check if the requested time falls within the available slots
    const requestedTime = time.split('-');
    // console.log(requestedTime,'selected slot is not available request')
    // if (requestedTime[0] < availableStartTime || requestedTime[1] > availableEndTime) {
    //   res.status(400).json({ error: 'Selected time slot is not available.' });
    //   return;
    // }
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
      prnNumber,
      age,
      gender,
      serviceId,
      patientType,
      prefix
    });
    console.log("New Appointment:", newAppointment);
    if (newAppointment.status === 'pending') {

      const newNotification = await prisma.notification.create({
        data: {

          type: 'appointment_request',
          title: 'New Appointment Request',
          message: `Appointment received for ${newAppointment.doctorName} on ${newAppointment.date} at ${newAppointment.time}.`,
          entityId: newAppointment.id,
          entityType: 'appointment',
          isCritical: false,
          targetRole: 'sub_admin',
        },
      });
      console.log("New Notification:", newNotification);
      notifyPendingAppointments(newNotification);
      res.status(201).json(newAppointment);

    }

    if (newAppointment.status === 'confirmed') {
      await doctorRepository.addBookedSlot(doctorId, date, time,userId.toString());
      res.status(201).json(newAppointment);
    }

  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
function formatDateYear(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
  return `${day}-${month}-${year}`;
}
export const createNewAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if request contains an array of appointments
    const appointments = Array.isArray(req.body) ? req.body : [req.body];
    console.log(appointments)

    // Process each appointment individually
    const newAppointments = await Promise.all(
      appointments.map(async (appointment) => {
        const {
          patientName,
          phoneNumber,
          doctorName,
          doctorId,
          department,
          date,
          time,
          status,
          email,
          requestVia,
          smsSent,
          emailSent,
          messageSent,
          prnNumber,
          doctorType,
          age,
          gender,
          serviceId,
          type,
          prefix,
          patientType,
          userId
        } = appointment;



        await doctorRepository.addBookedSlot(doctorId, date, time,userId.toString());
        // 🔹 Create the appointment
        const name = `${prefix} ${patientName}`;
        try {
          const url = process.env.WHATSAPP_API_URL;
          const headers = {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN,
          };
          const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
          const patientPayload = {
            from: fromPhoneNumber,
            to: phoneNumber,
            type: "template",
            message: {
              templateid: "750561", // Replace with the actual template ID
              placeholders: [name, doctorName, status, formatDateYear(new Date(date)), time], // Dynamic placeholders
            },
          };
          const patientResponse = await axios.post(url!, patientPayload, { headers });

        }
        catch (error) {
          res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
        }
        return await resolver.createAppointment({
          patientName,
          phoneNumber,
          doctorName,
          doctorId,
          department,
          date,
          time,
          status,
          email,
          messageSent,
          emailSent,
          smsSent: true,
          userId: appointment.userId || null,
          prnNumber,
          age,
          gender,
          serviceId,
          type,
          requestVia: 'Walk-In',
          prefix,
          patientType
        });


      })

    );

    res.status(201).json(newAppointments);


  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const getAllNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany();
    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while fetching notifications' });
  }
}
// Delete a notification by ID
export const deleteNotification = async (req: Request, res: Response): Promise<void> => {
  const notificationId = parseInt(req.params.id, 10);

  try {
    await prisma.notification.delete({
      where: {
        id: notificationId,
      },
    });
    res.status(200).json({ message: 'Notification deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while deleting the notification' });
  }
};
export const getNotificationsByRole = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.query.userId); // Get user ID from query params
    const isReceptionist = req.query.isReceptionist === 'true'; // Check if the user is a receptionist

    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        OR: [
          { type: 'appointment_request' }, // Everyone gets appointment requests
          ...(isReceptionist
            ? [{ type: 'appointment_remainder' }] // Receptionists also get remainders
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' }, // Sort by most recent
    });

    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
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
    console.log("updateDatsa", updateData)

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

export const updateExtraWaitingTime = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { waitingTime } = req.body;
  console.log(waitingTime)
  try {
    // Update the checkedIn status for the specified appointment
    const updatedAppointment = await prisma.appointment.update({
      where: {
        id: Number(id),
      },
      data: {
        extraWaitingTime: waitingTime
      },
    });

    res.status(200).json({ message: 'Appointment checked in successfully', updatedAppointment });
  } catch (error) {
    console.error('Error updating check-in status:', error);
    res.status(500).json({ error: 'An error occurred while updating the check-in status' });
  }
}


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
export const getCheckinAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query; // Get today's date from query parameters
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const count = await appointmentRepository.getCheckinAppointments(date as string);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
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

export const getDoctorTodayReport = async (req: Request, res: Response): Promise<void> => {
  console.log("userId", req.query);
  try {
    const userId = req.query.userId ? Number(req.query.userId) : null;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    const report = await resolver.getDoctorTodayReport(userId);
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
    console.log(appointmentId, userId)
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
    const lockResult = await resolver.lockAppointment(appointmentId, userIdNum);

    if (lockResult.locked) {
      res.status(409).json({
        message: `Appointment is currently locked by ${lockResult.lockedByUsername}.`,
        lockedByUserId: lockResult.lockedByUserId,
        lockedByUsername: lockResult.lockedByUsername,
      });
      return;
    }

    // If not locked by someone else
    res.status(200).json(lockResult.data);

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
    console.log(appointmentId, delayMinutes)
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
  const { username } = req.body;
  const usEasternTime = moment.tz("America/New_York");

  console.log(id, username)

  // Convert US Eastern Time to Indian Standard Time (IST)
  const indianTime = usEasternTime.clone().tz("Asia/Kolkata").toDate();
  console.log(indianTime, 'indianTime')
  const appointment = await prisma.appointment.findUnique({
    where: { id: Number(id) },
    include: { doctor: true }, // Fetch doctor details
  });

  if (!appointment) {
    res.status(404).json({ error: "Appointment not found" });
    return
  }

  try {
    // Update the checkedIn status for the specified appointment
    const updatedAppointment = await prisma.appointment.update({
      where: {
        id: Number(id),
      },
      data: {
        checkedIn: true,
        checkedInTime: new Date(),
        checkedInBy: username
      },
    });
    notifyDoctor(appointment.doctorId);
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
export const bulkUpdateAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentsToUpdate = req.body; // The array of appointments to update
    console.log(appointmentsToUpdate, 'appointments')
    if (appointmentsToUpdate.length === 0) {
      res.status(400).json({ error: 'No appointments selected for update.' });
      return;
    }
    const doctorName = appointmentsToUpdate[0].doctorName
    const doctorId = appointmentsToUpdate[0].doctorId
    const doctor = await prisma.doctor.findFirst({ where: { id: doctorId } });
    const updatePromises = appointmentsToUpdate.map((appointment: { id: number }) =>
      prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          isCloseOPD: true,
          isCloseOPDTime: new Date(), // Set current time
        }
      })

    );

    // Wait for all update promises to resolve
    await Promise.all(updatePromises)

    const url = process.env.WHATSAPP_API_URL_BULK;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

    const whatsappPayload = {
      from: fromPhoneNumber,
      to: ['919880544866', '916364833988'], // Patient's WhatsApp number
      // to: ['919342287945'],
      // to:['919342003000'],
      type: "template",
      message: {
        templateid: "738055", // Replace with actual template ID
        placeholders: [doctorName, appointmentsToUpdate.length, doctor?.roomNo], // Dynamic placeholders
      },
    };
    try {
      const response = await axios.post(url!, whatsappPayload, { headers });
      if (response.data.code === "200") {
        console.log(`WhatsApp message sent successfully to `);
      } else {
        console.log(`Failed to send WhatsApp message to `, response.data);
      }
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
    }
    res.status(200).json({ message: 'Appointments updated successfully', updatePromises });

  } catch (error) {
    console.error('Error updating appointments:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// export const bulkUpdateAccepted = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const appointmentsToUpdate = req.body; // The array of appointments to update
//     console.log(appointmentsToUpdate,'appointments of accept')
//     if (appointmentsToUpdate.length === 0) {
//        res.status(400).json({ error: 'No appointments selected for update.' });
//        return;
//     }
//     const timeGap = app
//     const updatePromises = appointmentsToUpdate.map((appointment: { id: number }) => 
//       prisma.appointment.update({
//         where: { id: appointment.id },
//         data: {
//           isAccepted: true,
//           isAcceptedCloseTime: new Date(), // Set current time
//           status: 'pending'
//         }
//       })
//     );

//     // Wait for all update promises to resolve
//     await Promise.all(updatePromises)

//     res.status(200).json({ message: 'Appointments updated successfully', updatePromises });
//   } catch (error) {
//     console.error('Error updating appointments:', error);
//     res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
//   }
// };

export const bulkUpdateAccepted = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentsToUpdate = req.body; // The array of appointments to update
    console.log(appointmentsToUpdate, 'appointments of accept');

    if (appointmentsToUpdate.length === 0) {
      res.status(400).json({ error: 'No appointments selected for update.' });
      return;
    }

    const updatePromises = appointmentsToUpdate.map(async (appointment: { id: number }) => {
      // Fetch the current appointment data to get `isCloseOPDTime`
      const existingAppointment = await prisma.appointment.findUnique({
        where: { id: appointment.id },
        select: { isCloseOPDTime: true }, // Fetch only the required field
      });

      if (!existingAppointment || !existingAppointment.isCloseOPDTime) {
        console.warn(`Appointment ID ${appointment.id} has no isCloseOPDTime`);
        return null; // Skip update if isCloseOPDTime is missing
      }

      const isAcceptedCloseTime = new Date();
      const timeGap = isAcceptedCloseTime.getTime() - new Date(existingAppointment.isCloseOPDTime).getTime();

      return prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          isAccepted: true,
          isAcceptedCloseTime,
          timeGap: timeGap.toString(), // Store the time difference
        },
      });
    });

    // Wait for all update promises to resolve
    const results = await Promise.all(updatePromises);

    res.status(200).json({ message: 'Appointments updated successfully', results });
  } catch (error) {
    console.error('Error updating appointments:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// export const bulkUpdateCancel = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const appointmentsToUpdate = req.body; // The array of appointments to update
//     console.log(appointmentsToUpdate, 'appointments of accept');

//     if (appointmentsToUpdate.length === 0) {
//       res.status(400).json({ error: 'No appointments selected for update.' });
//       return;
//     }

//     const updatePromises = appointmentsToUpdate.map(async (appointment: { id: number }) => {
//       // Fetch the current appointment data to get `isCloseOPDTime`
//       const existingAppointment = await prisma.appointment.findUnique({
//         where: { id: appointment.id },
//       });

//       if (!existingAppointment) {
//         console.warn(`Appointment ID ${appointment.id} has no cancelled`);
//         return null; // Skip update if isCloseOPDTime is missing
//       }


//       return prisma.appointment.update({
//         where: { id: appointment.id },
//         data: {
//           status: 'cancelled'
//         },
//       });
//     });

//     // Wait for all update promises to resolve
//     const results = await Promise.all(updatePromises);

//     res.status(200).json({ message: 'Appointments updated successfully', results });
//   } catch (error) {
//     console.error('Error updating appointments:', error);
//     res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
//   }
// };

export const bulkUpdateCancel = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentsToUpdate = req.body; // Array of appointments to update
    console.log(appointmentsToUpdate, 'appointments for cancellation');

    if (appointmentsToUpdate.length === 0) {
      res.status(400).json({ error: 'No appointments selected for update.' });
      return;
    }

    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

    const updatePromises = appointmentsToUpdate.map(async (appointment: { id: number, doctorId: number, date: string, time: string }) => {
      // Fetch appointment details to get the patient and doctor info
      const existingAppointment = await prisma.appointment.findUnique({
        where: { id: appointment.id },
        include: { doctor: true }, // Fetch doctor details
      });

      if (!existingAppointment) {
        console.warn(`Appointment ID ${appointment.id} not found`);
        return null;
      }

      const { doctorId, date, time, phoneNumber, patientName, doctor, prefix } = existingAppointment;

      // **Cancel the booked slot**
      await prisma.bookedSlot.deleteMany({
        where: { doctorId, date, time },
      });

      console.log(`Slot cancelled for Doctor ID: ${doctorId}, Date: ${date}, Time: ${time}`);

      // **Update appointment status to "cancelled"**
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "cancelled" },
      });

      console.log(`Updated appointment status to cancelled for Appointment ID: ${appointment.id}`);

      const name = prefix + ' ' + existingAppointment.patientName;
      // **Send WhatsApp message to patient**
      const patientMessagePayload = {
        from: fromPhoneNumber,
        to: phoneNumber, // Patient's WhatsApp number
        type: "template",
        message: {
          templateid: "790519", // Replace with the actual template ID
          placeholders: [name, doctor?.name, time, formatDateYear(new Date(date))], // Dynamic placeholders
        },
      };

      try {
        const patientResponse = await axios.post(url!, patientMessagePayload, { headers });
        if (patientResponse.data.code === "200") {
          console.log(`WhatsApp message sent successfully to Patient: ${phoneNumber}`);
        } else {
          console.log(`Failed to send WhatsApp message to Patient: ${phoneNumber}`, patientResponse.data);
        }
      } catch (error) {
        console.error("Error sending WhatsApp message to Patient:", error);
      }

      // **Send WhatsApp message to doctor**
      if (doctor?.phone_number) {
        const doctorMessagePayload = {
          from: fromPhoneNumber,
          to: doctor.phone_number, // Doctor's WhatsApp number
          type: "template",
          message: {
            templateid: "774273", // Replace with actual doctor template ID
            placeholders: [doctor.name, "cancelled", name, time, date], // Dynamic placeholders
          },
        };

        try {
          const doctorResponse = await axios.post(url!, doctorMessagePayload, { headers });
          if (doctorResponse.data.code === "200") {
            console.log(`WhatsApp message sent successfully to Doctor: ${doctor.phone_number}`);
          } else {
            console.log(`Failed to send WhatsApp message to Doctor: ${doctor.phone_number}`, doctorResponse.data);
          }
        } catch (error) {
          console.error("Error sending WhatsApp message to Doctor:", error);
        }
      }

      // **Insert slot into unavailableSlot table**
      await prisma.unavailableSlot.create({
        data: {
          doctorId: Number(doctorId),
          date: date,
          time: time,
        },
      });

      console.log(`Slot added to unavailableSlot for Doctor ID: ${doctorId}, Date: ${date}, Time: ${time}`);

      return appointment.id; // Return the appointment ID after processing
    });

    // Wait for all update promises to resolve
    await Promise.all(updatePromises);

    res.status(200).json({ message: 'Appointments cancelled successfully' });

  } catch (error) {
    console.error('Error cancelling appointments:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }


};
export const getAppointmentByServiceId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceId, date } = req.query
    const queryDate: string = typeof date === "string" ? date : moment().tz("Asia/Kolkata").format("YYYY-MM-DD"); // Format: "2025-02-13"

    console.log(`📌 Fetching Appointments for Service ID: ${serviceId} on ${queryDate}`);

    // Fetch today's appointments based on serviceId
    const appointments = await prisma.appointment.findMany({
      where: {
        serviceId: Number(serviceId), // Match service ID
        date: queryDate, // Match today's date in YYYY-MM-DD format
      },
    });

    console.log("✅ Appointments Retrieved:", appointments);

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const getAppointmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { appointmentId } = req.params


    // Fetch today's appointments based on serviceId
    const appointments = await prisma.appointment.findUnique({
      where: {
        id: Number(appointmentId), // Match service ID
      },
      include:{
        user: true
      }
    });

    console.log("✅ Appointments Retrieved:", appointments);

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const todayCheckedInAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query; // Get today's date from query parameters
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const appointments = await prisma.appointment.findMany({
      where: {
        date: date as string,
        checkedIn: true,
      },
    });
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const confirmedAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'confirmed'
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const cancelledAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'cancelled'
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const completedAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'completed'
      },
      select: {
        patientName: true,
        phoneNumber: true,
        email: true,
        doctorName: true,
        department: true,
        date: true,
        time: true,
        created_at: true,
        requestVia: true,
        smsSent: true,
        emailSent: true,
        messageSent: true,
        status: true,
        patientType: true,
        user: {
          select: {
            username: true,
          },
        },
      }
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const PendingAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'pending'
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const getTransferAppointments = async(req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        status: 'confirmed',
        isTransfer: true
      }
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
 
export const getReferredAppointments = async(req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        status: 'completed',
        isReferred: true
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const getFollowUpAppointments = async(req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        isfollowup: true
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const pastConsultations = async(req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD" format
    const appointments = await prisma.appointment.findMany({
      where: {
        date: {
          lt: today, // Past dates
        },
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const futureConsultations = async(req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD" format
    const appointments = await prisma.appointment.findMany({
      where: {
        date: {
          gt: today, // Future dates
        },
        status:'confirmed'
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const confirmedMhc = async(req: Request, res: Response): Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        serviceId: {
          not:null
        },
        status: 'confirmed'
      }
    })
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const mhcReportAppointment = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        serviceId:{
          not: null
        }
      },
      select:{
        serviceId: true,
        id:true,
        waitingTime:true,
        department:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}
export const opdRequestWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      select:{
        id:true,
        requestVia:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const opdTimeWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      select:{
        id:true,
        time:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const opdTypeWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        type: {
          not: null
        }
      },
      select:{
        id:true,
        type:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}
export const opdStatusWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      select:{
        id:true,
        status:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true,
        checkedIn: true,
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const prnWiseAppointment = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        prnNumber:{
          not: null
        }
      },
      select:{
        id:true,
        prnNumber: true,
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const opdGenderWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        gender: {
          not: null
        }
      },
      select:{
        id:true,
        gender:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const checkedOutAppointments = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        checkedOut: {
          not: null
        }
      },
      select:{
        id:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}