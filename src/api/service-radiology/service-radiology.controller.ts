import { application, Request, Response } from 'express';
import { ServiceRadiologyRepository } from './service-radiology.repository';
import { notifyPendingAppointments } from '../appointments/appointment.controller';
import nodemailer from 'nodemailer';
import moment from 'moment-timezone';
import cron from 'node-cron';
import { sendServiceWhatsappMessage } from '../whatsapp/whatsapp.controller';
import { updateEstimation } from '../whatsapp/whatsapp.controller';
import axios from 'axios';

const repository = new ServiceRadiologyRepository();
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Create Service
export const createService = async (req: Request, res: Response) => {
  try {
    const {
      radioServiceId,
      radioServiceName,
      ...rest
    } = req.body;

    // Prepare data for the Service table
    const serviceData = {
      ...rest,
      radioServiceId: parseInt(radioServiceId),
      radioServiceName: radioServiceName,
    };

    // Create the service record along with related repeated dates
    const newService = await prisma.serviceAppointments.create({
      data: {
        ...serviceData,
      },
    });
    if (newService.appointmentStatus === 'pending') {

      const newNotification = await prisma.notification.create({
        data: {

          type: 'appointment_request',
          title: 'New Appointment Request',
          message: `Appointment received for ${newService.radioServiceName} on ${newService.appointmentDate} at ${newService.appointmentTime}.`,
          entityId: newService.id,
          entityType: 'appointment',
          isCritical: false,
          targetRole: 'sub_admin',
        },
      });
      console.log("New Notification:", newNotification);
      notifyPendingAppointments(newNotification);

    }

    res.status(201).json(newService);
    try {
      const { firstName, lastName, radioServiceName, phoneNumber, appointmentDate, appointmentTime, appointmentStatus, requestVia } = newService;
      let payload = {};
      const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
      // API endpoint
      const url = process.env.WHATSAPP_API_URL;

      const name = `${firstName} ${lastName}`;
      if (appointmentStatus === 'pending') {
        // Prepare the payload
        payload = {
          from: fromPhoneNumber, // Sender's WhatsApp number
          to: phoneNumber, // Recipient's WhatsApp number
          type: "template", // Message type
          message: {
            templateid: "751393", // Template ID
            placeholders: [name, radioServiceName], // Placeholders for the template
          },
        };
      }
      // API key for authorization
      const headers = {
        "Content-Type": "application/json",
        apikey: process.env.WHATSAPP_AUTH_TOKEN, // Replace with your actual API key
      };

      // Send the POST request
      const response = await axios.post(url!, payload, { headers });

      // Log the response
      console.log('WhatsApp message sent successfully:', response.data);



      // Send a success response
      // res.status(200).json({
      //   status: "success",
      //   message: "WhatsApp message sent successfully.",
      //   data: response.data,
      // });
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
    }
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
export const createNewService = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if request contains an array of appointments
    const appointments = Array.isArray(req.body) ? req.body : [req.body];
    console.log(appointments)

    const newAppointments = await Promise.all(
      appointments.map(async (appointment) => {
        try {
          const {
            firstName,
            lastName,
            prnNumber,
            appointmentDate,
            radiologyId,
            radiologyName,
            appointmentTime,
            phoneNumber,
            requestVia,
            appointmentStatus,
            userId,
            serviceId,
            email,
            prefix,
            patientType
          } = appointment;

          // 🔹 Send WhatsApp Notification
          try {
            const url = process.env.WHATSAPP_API_URL;
            const headers = {
              "Content-Type": "application/json",
              apikey: process.env.WHATSAPP_AUTH_TOKEN,
            };
            const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
            const patientPayload = {
              from: fromPhoneNumber,
              to: phoneNumber, // Using email instead of phoneNumber since it's not available
              type: "template",
              message: {
                templateid: "765787", // Template ID
                placeholders: [prefix + firstName + ' ' + lastName, radiologyName, appointmentStatus, formatDateYear(new Date(appointmentDate)), appointmentTime], // Placeholders for the template
              },
            };
            await axios.post(url!, patientPayload, { headers });
          } catch (error) {
            console.error("❌ Error sending WhatsApp notification:", error);
          }

          // 🔹 Create the appointment in the database
          return await prisma.serviceAppointments.create({
            data: {
              firstName,
              lastName,
              pnrNumber: prnNumber,
              appointmentDate,
              radioServiceId: radiologyId,
              radioServiceName: radiologyName,
              phoneNumber,
              appointmentTime,
              requestVia,
              appointmentStatus,
              userId,
              serviceId,
              email,
              messageSent: true,
              prefix,
              patientType
            },
          });
        } catch (error) {
          console.error("❌ Error creating service appointment:", error);
          return null;
        }
      })
    );

    // 🔹 Filter out null results (failed creations) and return successful appointments
    res.status(201).json(newAppointments.filter(appt => appt !== null));



  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

// Get all services
export const getServices = async (req: Request, res: Response) => {
  try {
    const result = await repository.getAllServices();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch services', error });
  }
};

// Get service by ID


export const getServiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ message: 'Invalid service ID' });
      return;
    }
    const service = await prisma.serviceAppointments.findUnique({
      where: { id },
    });

    if (!service) {
      res.status(404).json({ message: 'Service not found' });
    } else {
      res.status(200).json(service);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};



// Update service
// export const updateService = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { repeatedDates, ...formData } = req.body;
//     const result = await repository.updateService(Number(id), formData, repeatedDates);
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: 'Failed to update service', error });
//   }
// };
export const updateService = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { package: packageDate, ...formData } = req.body;
    console.log(id, formData)
    const serviceId = Number(id);
    if (isNaN(serviceId)) {
      res.status(400).json({ message: 'Invalid service ID' });
      return
    }


    // Start a transaction to ensure consistency
    const result = await prisma.$transaction(async (prisma) => {
      // Step 1: Update the Service table
      const updatedService = await prisma.serviceAppointments.update({
        where: { id: serviceId },
        data: { ...formData },
      });
      console.log(updatedService, 'service');




      return updatedService;
    });

    res.status(200).json({ message: 'Service updated successfully', result });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Failed to update service', error });
  }
};

export const updateServiceMessage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // Only specific fields like { messageSent: true }
    console.log(id, updateData)
    const data = updateData.status;
    console.log(data)

    const updatedService = await prisma.serviceAppointments.update({
      where: { id: Number(id) },
      data: data,
    });
    // const result = await repository.updateServiceMessage(Number(id), message);
    res.status(200).json(updatedService);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update service message', error });
  }
}

// Delete service
export const deleteService = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await repository.deleteService(Number(id));
    res.status(200).json({ message: 'Service deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete service', error });
  }
};

// // Add repeated dates
// export const addRepeatedDates = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { repeatedDates } = req.body;
//     const result = await repository.addRepeatedDates(Number(id), repeatedDates);
//     res.status(201).json(result);
//   } catch (error) {
//     res.status(500).json({ message: 'Failed to add repeated dates', error });
//   }
// };

// // Get repeated dates for a specific service
// export const getRepeatedDatesByServiceId = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const result = await repository.getRepeatedDatesByServiceId(Number(id));
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: 'Failed to fetch repeated dates', error });
//   }
// };


function formatDateYear(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
  return `${day}-${month}-${year}`;
}

export const getAvailableSlots = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, packageId } = req.query;

    if (!date || !packageId) {
      res.status(400).json({ message: 'Date and Package ID are required.' });
      return;
    }
    const packageIdParsed = parseInt(packageId as string);
    // Generate all time slots (7:00 AM - 11:00 AM)
    const allSlots: string[] = [];
    // const startTime = new Date(`${date}T07:00:00`);
    // const endTime = new Date(`${date}T12:00:00`);
    const startTime = new Date(`${date}T00:00:00`); // 12:00 AM
    const endTime = new Date(`${date}T23:59:59`); // End of day
    while (startTime < endTime) {
      const hours = startTime.getHours();
      const minutes = startTime.getMinutes();
      const period = hours >= 12 ? 'PM' : 'AM';
      const formattedTime = `${(hours % 12 || 12).toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')} ${period}`;
      allSlots.push(formattedTime);
      startTime.setMinutes(startTime.getMinutes() + 10); // Increment by 10 minutes
    }

    // Fetch booked slots for the specific package and date
    const bookedAppointments = await prisma.serviceAppointments.findMany({
      where: {
        appointmentDate: date as string, // Direct bookings for the date
        radioServiceId: packageIdParsed, // Specific package
      },
      select: { appointmentTime: true, appointmentStatus: true },
    });


    const bookedTimes = bookedAppointments
      .filter((appt) => appt.appointmentStatus !== 'Cancel')
      .map((appt) => appt.appointmentTime);
    console.log('Booked times:', bookedTimes, bookedAppointments);
    // Exclude booked times from allSlots
    const availableSlots = allSlots.filter((slot) => !bookedTimes.includes(slot));

    res.status(200).json({ availableSlots });
  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};



export const updateServiceStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { appointmentStatus } = req.body;
    console.log(id, appointmentStatus)

    if (!appointmentStatus) {
      res.status(400).json({ message: 'Appointment status is required.' });
      return;
    }

    const updatedService = await prisma.serviceAppointments.update({
      where: { id: parseInt(id, 10) },
      data: {
        appointmentStatus,
        updatedAt: new Date(),
      },
    });

    res.status(200).json({
      message: `Service appointment status updated to '${appointmentStatus}'.`,
      updatedService,
    });
  } catch (error) {
    console.error('Error updating service status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
export const getPackages = async (_req: Request, res: Response): Promise<void> => {
  try {
    const packages = await prisma.radioService.findMany();
    res.status(200).json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
export const lockService = async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = Number(req.params.id);
    const userId = Number(req.body.userId);

    if (!serviceId || isNaN(serviceId) || !userId || isNaN(userId)) {
      res.status(400).json({ message: 'Invalid service ID or user ID' });
      return;
    }

    const service = await repository.getServiceById(serviceId);
    if (!service) {
      res.status(404).json({ message: 'Service not found' });
      return;
    }

    if (service.lockedBy && service.lockedBy !== userId) {
      res.status(409).json({ message: 'Service is locked by another user' });
      return;
    }

    const lockedService = await repository.lockService(serviceId, userId);
    res.status(200).json(lockedService);
  } catch (error) {
    console.error('Error locking service:', error);
    res.status(500).json({ message: 'Failed to lock service' });
  }
};

export const unlockService = async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = Number(req.params.id);

    if (!serviceId || isNaN(serviceId)) {
      res.status(400).json({ message: 'Invalid service ID' });
      return;
    }

    const unlockedService = await repository.unlockService(serviceId);
    res.status(200).json(unlockedService);
  } catch (error) {
    console.error('Error unlocking service:', error);
    res.status(500).json({ message: 'Failed to unlock service' });
  }

};
export const markComplete = async (req: Request, res: Response): Promise<void> => {
  try {
    const indianTime = moment().tz('Asia/Kolkata');
    const indianDate = indianTime.format('YYYY-MM-DD'); // Format as YYYY-MM-DD

    // Find appointments for today where `checkedOut` is true
    const checkedInServices = await prisma.serviceAppointments.findMany({
      where: {
        appointmentDate: indianDate, // Appointments for today
        checkedIn: true, // Only checked out appointments
        appointmentStatus: 'Confirm',
      },
    });
    if (checkedInServices.length === 0) {
      console.log('No appointments found for today with checkedOut: true');
      // res.status(200).json({ message: 'No appointments to process' });
      return;
    }

    // Update the status of these appointments to "Complete"
    await Promise.all(
      checkedInServices.map(async (appointment) => {
        await prisma.service.update({
          where: { id: appointment.id },
          data: { appointmentStatus: 'completed' },
        });

        console.log(`Marked appointment ${appointment.id} as Complete`);

        // Send WhatsApp message
        const url = process.env.WHATSAPP_API_URL;
        const headers = {
          'Content-Type': 'application/json',
          apikey: process.env.WHATSAPP_AUTH_TOKEN,
        };
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

        const whatsappPayload = {
          from: fromPhoneNumber,
          to: appointment.phoneNumber, // Patient's phone number
          type: 'template',
          message: {
            templateid: '751385', // Replace with your actual template ID
            placeholders: [], // Add dynamic placeholders here if needed
          },
        };

        // try {
        //   await axios.post(url!, whatsappPayload, { headers });
        //   console.log('WhatsApp message sent successfully to', appointment.phoneNumber);

        //   // If WhatsApp message is successful, send SMS
        //   const apiKey = process.env.SMS_API_KEY;
        //   const apiUrl = process.env.SMS_API_URL;
        //   const sender = process.env.SMS_SENDER;
        //   const successMessage = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. Please contact 9742020123 for further assistance. Wishing you good health! Regards, Team Rashtrotthana`;
        //   const dltTemplateIdForDoctor = process.env.SMS_DLT_TE_ID_FOR_COMPLETE;

        //   const smsUrl = `${apiUrl}/${sender}/${appointment.phoneNumber}/${encodeURIComponent(
        //     successMessage
        //   )}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForDoctor}`;

        //   const smsResponse = await axios.get(smsUrl);
        //   console.log('SMS sent successfully to', appointment.phoneNumber, smsResponse.data);
        // } catch (error) {
        //   console.error(
        //     'Failed to send WhatsApp or SMS:',
        //     (error as any).response ? (error as any).response.data : (error as any).message
        //   );
        // }
      })
    );


  } catch (error) {
    console.error('Error completing service:', error);
    res.status(500).json({ message: 'Failed to complete service' });
  }
}
export const getAppointmentByServiceId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceId, date } = req.query
    const queryDate: string = typeof date === "string" ? date : moment().tz("Asia/Kolkata").format("YYYY-MM-DD"); // Format: "2025-02-13"

    console.log(`📌 Fetching Appointments for Service ID: ${serviceId} on ${queryDate}`);

    // Fetch today's appointments based on serviceId
    const appointments = await prisma.serviceAppointments.findMany({
      where: {
        serviceId: Number(serviceId), // Match service ID
        appointmentDate: queryDate, // Match today's date in YYYY-MM-DD format
      },
    });

    console.log("✅ Appointments Retrieved:", appointments);

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const getDetailsByPRN = async(req: Request, res: Response): Promise<void>=> {
  try {
    const { prnNumber } = req.body;

    if (!prnNumber) {
      res.status(400).json({ message: 'PNR number is required' });
      return;
    }



    const serviceAppointments = await prisma.serviceAppointments.findMany({
      where: { pnrNumber: prnNumber },
      include: {  RadioService: true }
    });

    const services = await prisma.service.findMany({
      where: { pnrNumber: prnNumber },
      include: { repeatedDates: true, package: true, RadioService: true }
    });

    

    res.json({
      serviceAppointments: serviceAppointments,
      services: services,
    });

  } catch (error) {
    console.error('Error fetching data by PRN:', error);
    res.status(500).json({ message: 'Internal server error', error });
  }
};
export const getTodayConfirmedServices = async (req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0];
    const appointments = await prisma.serviceAppointments.findMany({
      where: {
        OR: [
          { appointmentStatus: 'Confirm' },
          { appointmentStatus: 'confirmed'}
        ],
        appointmentDate: today,
        checkedIn: true
      },
      include: { RadioService : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}