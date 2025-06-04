import { application, Request, Response } from 'express';
import { ServiceRepository } from './services.repository';
import { notifyPendingAppointments } from '../appointments/appointment.controller';
import nodemailer from 'nodemailer';
import moment from 'moment-timezone';
import cron from 'node-cron';
import { sendServiceWhatsappMessage } from '../whatsapp/whatsapp.controller';
import { updateEstimation } from '../whatsapp/whatsapp.controller';
import axios from 'axios';

const repository = new ServiceRepository();
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Create Service
export const createService = async (req: Request, res: Response) => {
  try {
    const {
      repeatChecked,
      daysInterval,
      numberOfTimes,
      repeatedDates,
      packageId,
      packageName,
      ...rest
    } = req.body;

    // Prepare data for the Service table
    const serviceData = {
      ...rest,
      daysInterval: repeatChecked ? daysInterval || null : null,
      numberOfTimes: repeatChecked ? numberOfTimes || null : null,
      repeatChecked: repeatChecked || false,
      repeatedDates: repeatChecked
        ? { create: repeatedDates.map((date: string) => ({ date })) }
        : undefined, // Create related repeated dates only if repeatChecked is true
      packageId: parseInt(packageId),
      packageName: packageName,
    };

    // Create the service record along with related repeated dates
    const newService = await prisma.service.create({
      data: {
        ...serviceData,
      },
      include: {
        repeatedDates: true, // Return the related repeated dates in the response
      },
    });
    if (newService.appointmentStatus === 'pending') {

      const newNotification = await prisma.notification.create({
        data: {

          type: 'appointment_request',
          title: 'New Appointment Request',
          message: `Appointment received for ${newService.packageName} on ${newService.appointmentDate} at ${newService.appointmentTime}.`,
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
      const { firstName, lastName, packageName, phoneNumber, appointmentDate, appointmentTime, appointmentStatus, requestVia } = newService;
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
            placeholders: [name, packageName], // Placeholders for the template
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
    const service = await prisma.service.findUnique({
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
    const { repeatedDates, package: packageDate, ...formData } = req.body;
    console.log(id, formData, repeatedDates)
    const serviceId = Number(id);
    if (isNaN(serviceId)) {
      res.status(400).json({ message: 'Invalid service ID' });
      return
    }


    // Start a transaction to ensure consistency
    const result = await prisma.$transaction(async (prisma) => {
      // Step 1: Update the Service table
      const updatedService = await prisma.service.update({
        where: { id: serviceId },
        data: { ...formData },
      });
      console.log(updatedService, 'service');

      // Step 2: If repeatedDates exist, delete old ones and add new ones
      if (repeatedDates && repeatedDates.length > 0) {
        // Step 1: Delete old repeated dates
        await prisma.repeatedDate.deleteMany({
          where: { serviceId: Number(id) },
        });

        // Step 2: Add new repeated dates
        await prisma.repeatedDate.createMany({
          data: repeatedDates.map((date: { id: number, date: string, serviceId: number }) => ({
            serviceId: date.serviceId,  // Get serviceId from the repeatedDates object
            date: date.date             // Get date from the repeatedDates object
          })),
        });
      }


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

    const updatedService = await prisma.service.update({
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

// Add repeated dates
export const addRepeatedDates = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { repeatedDates } = req.body;
    const result = await repository.addRepeatedDates(Number(id), repeatedDates);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to add repeated dates', error });
  }
};

// Get repeated dates for a specific service
export const getRepeatedDatesByServiceId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await repository.getRepeatedDatesByServiceId(Number(id));
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch repeated dates', error });
  }
};

export const callRepeatedAppointments = async (req: Request, res: Response) => {
  try {
    // Get the current time in Indian Standard Time (IST)

    await updateEstimation();
    // Run the required tasks
    await processRepeatedAppointments();

    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Hourly task executed successfully' });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}

function formatDateYear(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
  return `${day}-${month}-${year}`;
}
export const processRepeatedAppointments = async () => {
  try {
    // Step 1: Get Tomorrow's Date
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowDateStr = tomorrow.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // Step 2: Find all services with repeated dates for tomorrow
    const servicesWithRepeats = await prisma.service.findMany({
      where: {
        repeatedDates: {
          some: { date: tomorrowDateStr }, // Find if repeated date matches tomorrow
        },
      },
      include: { repeatedDates: true },
    });

    if (servicesWithRepeats.length === 0) {
      console.log('No repeated appointments found for tomorrow');
    }

    // Step 3: Create new appointments for the day before tomorrow
    const newAppointments = [];

    for (const service of servicesWithRepeats) {
      // Calculate the date for one day before tomorrow
      const dayBeforeTomorrow = new Date(tomorrow);
      dayBeforeTomorrow.setDate(tomorrow.getDate() - 1);
      const dayBeforeTomorrowStr = dayBeforeTomorrow.toISOString().split('T')[0];
      console.log(dayBeforeTomorrow, dayBeforeTomorrowStr, tomorrowDateStr)

      // Create a new service appointment for the day before
      const newService = await prisma.service.create({
        data: {
          pnrNumber: service.pnrNumber,
          firstName: service.firstName,
          lastName: service.lastName,
          phoneNumber: service.phoneNumber,
          email: service.email,
          packageId: service.packageId,
          appointmentDate: tomorrowDateStr, // Day before tomorrow
          appointmentTime: service.appointmentTime,
          requestVia: service.requestVia,
          appointmentStatus: 'Confirm',
          repeatChecked: false, // New appointment is not a repeat
          packageName: service.packageName,
          userId: service.userId,
          username: service.username,
          role: service.role,
        },
      });

      newAppointments.push(newService);
      try {
        const { firstName, lastName, packageName, phoneNumber, appointmentDate, appointmentTime, appointmentStatus, requestVia } = newService;
        let payload = {};
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        // API endpoint
        const url = process.env.WHATSAPP_API_URL;

        const name = `${firstName} ${lastName}`;
        if (appointmentStatus !== 'pending') {
          // Prepare the payload
          payload = {
            from: fromPhoneNumber, // Sender's WhatsApp number
            to: phoneNumber, // Recipient's WhatsApp number
            type: "template", // Message type
            message: {
              templateid: "751387", // Template ID
              placeholders: [name, packageName, appointmentStatus, formatDateYear(new Date(appointmentDate)), appointmentTime], // Placeholders for the template
            },
          };
        }
        else {
          payload = {
            from: fromPhoneNumber, // Sender's WhatsApp number
            to: phoneNumber, // Recipient's WhatsApp number
            type: "template", // Message type
            message: {
              templateid: "751393", // Template ID
              placeholders: [name, packageName], // Placeholders for the template
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
        await prisma.service.update({
          where: { id: newService.id },
          data: { messageSent: true },
        });

        // Send a success response
        // res.status(200).json({
        //   status: "success",
        //   message: "WhatsApp message sent successfully.",
        //   data: response.data,
        // });
      } catch (error) {
        console.error('Error sending WhatsApp message:', error);
      }
      try {
        const { firstName, lastName, packageName, phoneNumber, appointmentDate, appointmentTime, appointmentStatus, requestVia } = newService;
        const patientName = `${firstName} ${lastName}`;
        let status = 'confirmed';
        let patient_message = "";
        patient_message = `Namaste ${patientName}, Your ${packageName} package is ${status} for ${appointmentDate} at ${appointmentTime}. Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We appreciate your patience and recommend consulting your doctor once the reports are ready. For any assistance, please contact 97420 20123. Thank You! Regards, Team Rashtrotthana	`;

        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        const dltTemplateIdForPatient = process.env.SMS_DLT_TE_ID_FOR_HEALTH_CHECKUP_STATUS;
        const url = `${apiUrl}/${sender}/${phoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForPatient}`;
        const response = await axios.get(url);
        console.log('SMS sent successfully:', response.data);
      }
      catch (error) {
        console.error('Error sending SMS:', error);
        await prisma.service.update({
          where: { id: newService.id },
          data: { smsSent: true },
        });
      }
      try {
        const { firstName, lastName, packageName, phoneNumber, appointmentDate, appointmentTime, appointmentStatus, requestVia, email } = newService;
        const to = email;
        const patientName = `${firstName} ${lastName}`;
        // Nodemailer transporter configuration
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          host: 'smtp.gmail.com',
          port: 587, // Use SSL/TLS for the connection
          // service: 'Gmail', // or any SMTP service you're using
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
        const emailContent = {
          subject: `Appointment Status Update – Rashtrotthana Hospital`,
          text: `
  Dear ${patientName},

  Namaste!
  Your ${packageName} appointment is ${appointmentStatus} for ${appointmentDate} at ${appointmentTime}.

  Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We recommend consulting your doctor once the reports are ready for further guidance.

  If you have any questions or need assistance, please contact us at 97420 20123.

  Thank you for choosing us.

  Regards,
  Team Rashtrotthana
`,
        };
        const mailOptions = {
          from: process.env.SMTP_USER,
          to: to ? (Array.isArray(to) ? to.join(', ') : to) : undefined,
          subject: emailContent.subject,
          text: emailContent.text,
        };
        if (!mailOptions.to) {
          await prisma.service.update({
            where: { id: newService.id },
            data: { emailSent: false },
          });
          throw new Error("Recipient's email address (to) is required.");

        }
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info);
        await prisma.service.update({
          where: { id: newService.id },
          data: { emailSent: true },
        });
      }

      catch (error) {
        console.error('Error sending email:', error);
        await prisma.service.update({
          where: { id: newService.id },
          data: { emailSent: false },
        });
      }
    }

    // Step 4: Send Response
    // res.status(201).json({
    //   message: 'New appointments created for tomorrow\'s repeated dates (day before)',
    //   newAppointments,
    // });
    console.log('New appointments created for tomorrow\'s repeated dates (day before):', newAppointments);
  } catch (error) {
    console.error('Error processing repeated appointments:', error);
    // res.status(500).json({ message: 'Internal server error' });
  }
};

export const stopRepeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceId, stopDate } = req.body;

    if (!serviceId || !stopDate) {
      res.status(400).json({ message: 'Service ID and Stop Date are required.' });
    }

    // Format stopDate
    const stopDateStr = new Date(stopDate).toISOString().split('T')[0];

    // Delete repeated dates greater than or equal to stopDate
    const deletedDates = await prisma.repeatedDate.deleteMany({
      where: {
        serviceId: serviceId, // Match the serviceId
        date: { gte: stopDateStr }, // Delete dates after the stopDate
      },
    });

    res.status(200).json({
      message: `Repeated dates after ${stopDateStr} deleted successfully.`,
      deletedDates,
    });
  } catch (error) {
    console.error('Error stopping repeated appointments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

//   export const getAvailableSlots = async (req: Request, res: Response):  Promise<void> => {
//     try {
//       const date = req.query.date;

//       // Validate and cast `date` to string
//       if (typeof date !== 'string') {
//          res.status(400).json({ message: 'Invalid date format. Date must be a string.' });
//          return;
//       }

//       // Generate all time slots from 7:00 AM to 11:00 AM
//       const allSlots: string[] = [];
//       const startTime = new Date(`${date}T07:00:00`);
//       const endTime = new Date(`${date}T11:00:00`);

//       while (startTime < endTime) {
//         const hours = startTime.getHours();
//         const minutes = startTime.getMinutes();
//         const period = hours >= 12 ? 'PM' : 'AM';
//         const formattedTime = `${hours % 12 || 12}:${minutes
//           .toString()
//           .padStart(2, '0')} ${period}`;
//         allSlots.push(formattedTime);
//         startTime.setMinutes(startTime.getMinutes() + 10); // Increment by 10 minutes
//       }

//       // Fetch booked appointments (direct and repeated)
//       const bookedAppointments = await prisma.service.findMany({
//         where: {
//           OR: [
//             { appointmentDate: date }, // Direct bookings
//             {
//               repeatedDates: {
//                 some: {
//                   date: date, // Repeated bookings
//                 },
//               },
//             },
//           ],
//         },
//         select: {
//           appointmentTime: true, // Select the booked times
//         },
//       });

//       const bookedTimes = bookedAppointments.map((appt) => appt.appointmentTime);

//       // Exclude booked times from allSlots
//       const availableSlots = allSlots.filter((slot) => !bookedTimes.includes(slot));

//       res.status(200).json({ availableSlots });
//     } catch (error) {
//       console.error('Error fetching available slots:', error);
//       res.status(500).json({ message: 'Internal server error' });
//     }
//   };

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
    const startTime = new Date(`${date}T07:00:00`);
    const endTime = new Date(`${date}T12:00:00`);
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
    const bookedAppointments = await prisma.service.findMany({
      where: {
        OR: [
          {
            appointmentDate: date as string, // Direct bookings for the date
            packageId: packageIdParsed, // Specific package
          },
          {
            repeatedDates: {
              some: {
                date: date as string, // Repeated dates
              },
            },
            packageId: packageIdParsed, // Specific package
          },
        ],
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

    const updatedService = await prisma.service.update({
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
    const packages = await prisma.package.findMany();
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
    const checkedInServices = await prisma.service.findMany({
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

        try {
          await axios.post(url!, whatsappPayload, { headers });
          console.log('WhatsApp message sent successfully to', appointment.phoneNumber);

          // If WhatsApp message is successful, send SMS
          const apiKey = process.env.SMS_API_KEY;
          const apiUrl = process.env.SMS_API_URL;
          const sender = process.env.SMS_SENDER;
          const successMessage = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. Please contact 9742020123 for further assistance. Wishing you good health! Regards, Team Rashtrotthana`;
          const dltTemplateIdForDoctor = process.env.SMS_DLT_TE_ID_FOR_COMPLETE;

          const smsUrl = `${apiUrl}/${sender}/${appointment.phoneNumber}/${encodeURIComponent(
            successMessage
          )}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForDoctor}`;

          const smsResponse = await axios.get(smsUrl);
          console.log('SMS sent successfully to', appointment.phoneNumber, smsResponse.data);
        } catch (error) {
          console.error(
            'Failed to send WhatsApp or SMS:',
            (error as any).response ? (error as any).response.data : (error as any).message
          );
        }
      })
    );


  } catch (error) {
    console.error('Error completing service:', error);
    res.status(500).json({ message: 'Failed to complete service' });
  }
}
// export const individualComplete = async (req: Request, res: Response) => {
//   try {
//     const appointment = req.body;
//     console.log(appointment)
//     // Get current Indian time
//     const indianTime = moment().tz('Asia/Kolkata');
//     const indianDate = indianTime.format('YYYY-MM-DD'); // Format as YYYY-MM-DD

//     // Find appointments for today where `checkedOut` is true
//     const checkedOutAppointments = Array.isArray(appointment) ? appointment : [appointment];

//     if (checkedOutAppointments.length === 0) {
//       console.log('No appointments found for today with checkedOut: true');
//       res.status(200).json({ message: 'No appointments to process' });
//       return;
//     }

//     // Update the status of these appointments to "Complete"
//     await Promise.all(
//       checkedOutAppointments.map(async (appointment: any) => {
//         await prisma.service.update({
//           where: { id: appointment.id },
//           data: { appointmentStatus: 'completed' },
//         });

//         console.log(`Marked appointment ${appointment.id} as Complete`);

//         // Send WhatsApp message
//         const url = process.env.WHATSAPP_API_URL;
//         const headers = {
//           'Content-Type': 'application/json',
//           apikey: process.env.WHATSAPP_AUTH_TOKEN,
//         };
//         const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

//         const whatsappPayload = {
//           from: fromPhoneNumber,
//           to: appointment.phoneNumber, // Patient's phone number
//           type: 'template',
//           message: {
//             templateid: '751385', // Replace with your actual template ID
//             placeholders: [], // Add dynamic placeholders here if needed
//           },
//         };

//         try {
//           await axios.post(url!, whatsappPayload, { headers });
//           console.log('WhatsApp message sent successfully to', appointment.phoneNumber);

//           // If WhatsApp message is successful, send SMS
//           const apiKey = process.env.SMS_API_KEY;
//           const apiUrl = process.env.SMS_API_URL;
//           const sender = process.env.SMS_SENDER;
//           const successMessage = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. If you have any queries or need further assistance, feel free to reach out. Wishing you good health!`;
//           const dltTemplateIdForDoctor = process.env.SMS_DLT_TE_ID_FOR_COMPLETE;

//           const smsUrl = `${apiUrl}/${sender}/${appointment.phoneNumber}/${encodeURIComponent(
//             successMessage
//           )}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForDoctor}`;

//           const smsResponse = await axios.get(smsUrl);
//           console.log('SMS sent successfully to', appointment.phoneNumber, smsResponse.data);
//         } catch (error) {
//           console.error(
//             'Failed to send WhatsApp or SMS:',
//             (error as any).response ? (error as any).response.data : (error as any).message
//           );
//         }
//       })
//     );

//     res.status(200).json({ message: 'Appointments marked as complete and notifications sent' });
//   } catch (error) {
//     console.error('Error marking complete:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// };

export const individualComplete = async (req: Request, res: Response) => {
  try {
    const appointments = Array.isArray(req.body) ? req.body : [req.body];
    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      'Content-Type': 'application/json',
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

    if (appointments.length === 0) {
      console.log('No appointments found to process.');
      res.status(200).json({ message: 'No appointments to process.' });
      return
    }

    for (const appointment of appointments) {
      await prisma.service.update({
        where: { id: appointment.id },
        data: { appointmentStatus: 'completed' },
      });

      console.log(`Marked appointment ${appointment.id} as Complete`);

      // Cancel appointments and service appointments with checkedOut: false
      const relatedAppointments = await prisma.appointment.findMany({
        where: {
          serviceId: appointment.id, OR: [
            { checkedOut: false },
            { checkedOut: null }
          ]
        },
        include: { doctor: true },
      });

      for (const appt of relatedAppointments) {
        await prisma.bookedSlot.deleteMany({
          where: { doctorId: appt.doctorId, date: appt.date, time: appt.time },
        });

        await prisma.appointment.update({
          where: { id: appt.id },
          data: { status: 'cancelled' },
        });
        const name = appt.prefix + ' ' + appt.patientName;
        const patientMessagePayload = {
          from: fromPhoneNumber,
          to: appt.phoneNumber, // Patient's WhatsApp number
          type: "template",
          // message: {
          //   templateid: "751725", // Replace with actual template ID
          //   placeholders: [name, appt.doctor?.name || "Doctor", "cancelled", formatDateYear(new Date(appt.date)), appt.time], // Dynamic placeholders
          // },
          message: {
            templateid: "790519", // Replace with the actual template ID
            placeholders: [name, appt.doctor?.name, appt.time, formatDateYear(new Date(appt.date))], // Dynamic placeholders
          },
        };

        try {
          const patientResponse = await axios.post(url!, patientMessagePayload, { headers });
          if (patientResponse.data.code === "200") {
            console.log(`WhatsApp message sent successfully to Patient: ${appt.phoneNumber}`);
          } else {
            console.log(`Failed to send WhatsApp message to Patient: ${appt.phoneNumber}`, patientResponse.data);
          }
        } catch (error) {
          console.error("Error sending WhatsApp message to Patient:", error);
        }

        // **Send WhatsApp message to doctor**
        if (appt.doctor?.phone_number) {
          const doctorMessagePayload = {
            from: fromPhoneNumber,
            to: appt.doctor.phone_number, // Doctor's WhatsApp number
            type: "template",
            message: {
              templateid: "774273", // Replace with actual doctor template ID
              placeholders: [appt.doctor.name, "cancelled", name, appt.time, appt.date], // Dynamic placeholders
            },
          };

          try {
            const doctorResponse = await axios.post(url!, doctorMessagePayload, { headers });
            if (doctorResponse.data.code === "200") {
              console.log(`WhatsApp message sent successfully to Doctor: ${appt.doctor.phone_number}`);
            } else {
              console.log(`Failed to send WhatsApp message to Doctor: ${appt.doctor.phone_number}`, doctorResponse.data);
            }
          } catch (error) {
            console.error("Error sending WhatsApp message to Doctor:", error);
          }
        }

        console.log(`Cancelled appointment ${appt.id}`);
      }

      const relatedServiceAppointments = await prisma.serviceAppointments.findMany({
        where: {
          serviceId: appointment.id, OR: [
            { checkedOut: false },
            { checkedOut: null }
          ]
        },
      });
      console.log(relatedServiceAppointments)

      for (const serviceAppt of relatedServiceAppointments) {


        await prisma.serviceAppointments.update({
          where: { id: serviceAppt.id },
          data: { appointmentStatus: 'Cancel' },
        });
        const name = serviceAppt.prefix + ' ' + serviceAppt.firstName + ' ' + serviceAppt.lastName;
        const payload = {
          from: fromPhoneNumber, // Sender's WhatsApp number
          to: serviceAppt.phoneNumber, // Recipient's WhatsApp number
          type: "template", // Message type
          message: {
            templateid: "765791", // Template ID
            placeholders: [name, serviceAppt.radioServiceName, formatDateYear(new Date(serviceAppt.appointmentDate))], // Placeholders for the template
          },
        };
        try {
          const doctorResponse = await axios.post(url!, payload, { headers });
          if (doctorResponse.data.code === "200") {
            console.log(`WhatsApp message sent successfully to radio patient: ${serviceAppt.phoneNumber}`);
          } else {
            console.log(`Failed to send WhatsApp message to radio patient: ${serviceAppt.phoneNumber}`, doctorResponse.data);
          }
        } catch (error) {
          console.error("Error sending WhatsApp message to radio patient:", error);
        }
        console.log(`Cancelled service appointment ${serviceAppt.id}`);
      }

      // Send WhatsApp and SMS notifications
      try {
        const whatsappPayload = {
          from: process.env.WHATSAPP_FROM_PHONE_NUMBER,
          to: appointment.phoneNumber,
          type: 'template',
          message: { templateid: '751385', placeholders: [] },
        };

        await axios.post(process.env.WHATSAPP_API_URL!, whatsappPayload, {
          headers: { 'Content-Type': 'application/json', apikey: process.env.WHATSAPP_AUTH_TOKEN },
        });

        console.log('WhatsApp message sent successfully to', appointment.phoneNumber);

        const successMessage = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. Please contact 9742020123 for further assistance. Wishing you good health! Regards, Team Rashtrotthana`;

        const smsUrl = `${process.env.SMS_API_URL}/${process.env.SMS_SENDER}/${appointment.phoneNumber}/${encodeURIComponent(successMessage)}/TXT?apikey=${process.env.SMS_API_KEY}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${process.env.SMS_DLT_TE_ID_FOR_COMPLETE}`;

        await axios.get(smsUrl);
        console.log('SMS sent successfully to', appointment.phoneNumber);
      } catch (error) {
        console.error('Failed to send WhatsApp or SMS:', (error as any).response ? (error as any).response.data : (error as any).message);
      }
    }

    res.status(200).json({ message: 'Appointments processed successfully.' });
  } catch (error) {
    console.error('Error processing appointments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const confirmedAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.service.findMany({
      where: {
        OR: [
          { appointmentStatus: 'Confirm' },
          { appointmentStatus: 'confirmed'}
        ],
      },
      include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const cancelledAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.service.findMany({
      where: {
        OR: [
          { appointmentStatus: 'Cancel' },
          { appointmentStatus: 'Cancelled'}
        ],
      },
      include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const completedAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.service.findMany({
      where: {
        OR: [
          { appointmentStatus: 'Completed' },
          { appointmentStatus: 'complete'},
          { appointmentStatus: 'completed'}
        ],
      },
      include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const PendingAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.service.findMany({
      where: {
        appointmentStatus: 'pending'
      },
      include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const getTodayConfirmedServices = async (req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0];
    const appointments = await prisma.service.findMany({
      where: {
        OR: [
          { appointmentStatus: 'Confirm' },
          { appointmentStatus: 'confirmed'}
        ],
        appointmentDate: today,
        checkedIn: true
      },
      include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const getTodayMHCConfirmedServices = async (req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0];
    const appointments = await prisma.service.findMany({
      where: {
        OR: [
          { appointmentStatus: 'Confirm' },
          { appointmentStatus: 'confirmed'}
        ],
        appointmentDate: today,
      },
      include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const getMhcOverview = async (req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.service.findMany({
      select:{
        id: true,
        package: true,
        appointmentDate: true,
        appointmentStatus: true,
        appointmentTime: true,
        packageId: true,
        
      },
      // include: { repeatedDates: true, package : true },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}