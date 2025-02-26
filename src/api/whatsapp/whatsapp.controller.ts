

import { Request, Response } from 'express';

import { notifyPendingAppointments } from './../appointments/appointment.controller';
import { messageSent } from './../appointments/appointment.controller';
import { adminAlertSent } from './../appointments/appointment.controller';
import ScreenshotController from '../screenshot/screenshot.controller';
import axios from 'axios';
import https from 'https';
import { parse, isAfter, isBefore, subHours, setMinutes, setSeconds } from 'date-fns';
import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
import { start } from 'repl';
import { Console } from 'console';

// import { utcToZonedTime, format } from 'date-fns-tz';
dotenv.config();
const prisma = new PrismaClient();
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

export const sendWhatsAppMessage = async (req: Request, res: Response) => {
  console.log('req.body:', req.body);
  const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status, requestVia } = req.body;
  console.log(patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status);
  // const date = formatDateYear(date)

  const url = process.env.WHATSAPP_API_URL;
  const headers = {
    "Content-Type": "application/json",
    apikey: process.env.WHATSAPP_AUTH_TOKEN,
  };
  const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
  let payload = {};

  // Message for Patient (regardless of the status)
  if (status !== 'received') {
    // messages.push({
    //     "coding": "1",
    //     "id": "15b0cc79c0da45771662021",
    //     "msgtype": "1",
    //     "text": "",
    //     "templateinfo": `1498900~${patientName}~${doctorName}~${status}~${date}~${time}`,
    //     "type": "",
    //     "contenttype": "",
    //     "filename": "",
    //     "mediadata": "",
    //     "b_urlinfo": "",
    //     "addresses": [
    //         {
    //             "seq": "6310710c80900d37f7b9-20220901",
    //             "to": patientPhoneNumber,
    //             "from": fromPhoneNumber,
    //             "tag": ""
    //         }
    //     ]
    // });
    // payload = {
    //     from: fromPhoneNumber,
    //     to: patientPhoneNumber,
    //     type: "template",
    //     message: {
    //       templateid: "674445", // Replace with the actual template ID
    //       placeholders:[patientName, doctorName, status, date, time], // Dynamic placeholders
    //     },
    //   };
    //   console.log(payload, 'payload for patient');
  }
  if (status === 'received') {
    // messages.push({
    //     "coding": "1",
    //     "id": "15b0cc79c0da45771662022",
    //     "msgtype": "1",
    //     "text": "",
    //     "templateinfo": `1495968~${patientName}~${doctorName}`,
    //     "type": "",
    //     "contenttype": "",
    //     "filename": "",
    //     "mediadata": "",
    //     "b_urlinfo": "",
    //     "addresses": [
    //         {
    //             "seq": "6310710c80900d37f7b9-20220902",
    //             "to": patientPhoneNumber,
    //             "from": fromPhoneNumber,
    //             "tag": ""
    //         }
    //     ]
    // });
    payload = {
      from: fromPhoneNumber, // Sender's WhatsApp number
      to: patientPhoneNumber, // Recipient's WhatsApp number
      type: "template", // Type of the message
      message: {
        templateid: "674495", // Replace with the actual template ID
        placeholders: [patientName, doctorName], // Dynamic placeholders
      },
    };

  }
  // Message for Doctor (only if the status is 'confirmed')
  if (status === 'confirmed' || status === 'cancelled' || status === 'rescheduled') {
    // messages.push({
    //     "coding": "1",
    //     "id": "15b0cc79c0da45771662022",
    //     "msgtype": "1",
    //     "text": "",
    //     "templateinfo": `1498899~${doctorName}~${status}~${patientName}~${date}~${time}`,
    //     "type": "",
    //     "contenttype": "",
    //     "filename": "",
    //     "mediadata": "",
    //     "b_urlinfo": "",
    //     "addresses": [
    //         {
    //             "seq": "6310710c80900d37f7b9-20220902",
    //             "to": doctorPhoneNumber,
    //             "from": fromPhoneNumber,
    //             "tag": ""
    //         }
    //     ]
    // });
    payload = {
      from: fromPhoneNumber, // Sender's WhatsApp number
      to: doctorPhoneNumber, // Recipient's WhatsApp number
      type: "template", // Type of the message
      message: {
        templateid: "674491", // Replace with the actual template ID
        placeholders: [doctorName, status, patientName, formatDateYear(new Date(date)), time], // Dynamic placeholders
      },
    }
    let patientPayload = {}
    if (requestVia === 'Walk-In') {
      patientPayload = {
        from: fromPhoneNumber,
        to: patientPhoneNumber,
        type: "template",
        message: {
          templateid: "718883", // Replace with the actual template ID
          placeholders: [patientName, doctorName, status, formatDateYear(new Date(date)), time], // Dynamic placeholders
        },
      };
      const patientResponse = await axios.post(url!, patientPayload, { headers });
      res.status(200).json({ message: 'WhatsApp message(s) sent successfully', response: patientResponse.data });
    } else {
      patientPayload = {
        from: fromPhoneNumber,
        to: patientPhoneNumber,
        type: "template",
        message: {
          templateid: "674445", // Replace with the actual template ID
          placeholders: [patientName, doctorName, status, formatDateYear(new Date(date)), time], // Dynamic placeholders
        },
      };
      const patientResponse = await axios.post(url!, patientPayload, { headers });
      res.status(200).json({ message: 'WhatsApp message(s) sent successfully', response: patientResponse.data });
    }


    //   console.log(patientResponse, 'payload for patient');
    console.log(payload, 'payload for doctor');
  }
  if (status === 'completed') {
    // messages.push({
    //     "coding": "1",
    //     "id": "15b0cc79c0da45771662022",
    //     "msgtype": "1",
    //     "text": "",
    //     "templateinfo": `1489098`,
    //     "type": "",
    //     "contenttype": "",
    //     "filename": "",
    //     "mediadata": "",
    //     "b_urlinfo": "",
    //     "addresses": [
    //         {
    //             "seq": "6310710c80900d37f7b9-20220902",
    //             "to": patientPhoneNumber,
    //             "from": fromPhoneNumber,
    //             "tag": ""
    //         }
    //     ]
    // });
    payload = {
      from: fromPhoneNumber, // Sender's WhatsApp number
      to: patientPhoneNumber, // Recipient's WhatsApp number
      type: "template", // Type of the message
      message: {
        templateid: "682641", // Replace with the actual template ID
        placeholders: [], // Dynamic placeholders
      },
    };
  }

  // const data = {
  //     "apiver": "1.0",
  //     "whatsapp": {
  //         "ver": "2.0",
  //         "dlr": {
  //             "url": ""
  //         },
  //         "messages": messages
  //     }
  // };

  try {
    const response = await axios.post(url!, payload, { headers });
    res.status(200).json({ message: 'WhatsApp message(s) sent successfully', response: response.data });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to send WhatsApp message(s)',
      details: (error as any).response ? (error as any).response.data : (error as any).message
    });
  }
};

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
  return `${year}-${month}-${day}`;
}
function formatDateYear(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
  return `${day}-${month}-${year}`;
}
// // Function to check appointments and send reminders
export const checkAndSendReminders = async () => {
  try {
    const usEasternTime = moment.tz("America/New_York");

    // Convert US Eastern Time to Indian Standard Time (IST)
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");
    console.log(indianTime, 'indianTime')

    // Store the date and time in two separate variables
    const indianDate = indianTime.format('YYYY-MM-DD');
    const indianTimeOnly = indianTime.format('HH:mm:ss');

    // Print the converted date and time
    console.log("Indian Date:", indianDate);
    console.log("Indian Time:", indianTimeOnly);

    // Find appointments for tomorrow (1 day before)
    // const tomorrow = new Date();
    // tomorrow.setDate(tomorrow.getDate() + 1); // Add 1 day to today's date
    // const tomorrowDateString = isoString.split('T')[0]; // Convert to ISO format  
    // console.log(tomorrowDateString);
    let tomorrow = new Date(indianDate.split('T')[0]);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateString = tomorrow.toISOString().split('T')[0];
    console.log(tomorrowDateString, 'tomorrow')
    // console.log(formatDate(tomorrow),'tomorrow in formatdate');

    const today = new Date(indianDate.split('T')[0]);
    today.setDate(today.getDate());
    const todayDateString = today.toISOString().split('T')[0];
    console.log(todayDateString, 'today');

    const appointmentsTomorrow = await prisma.appointment.findMany({
      where: {
        date: tomorrowDateString,
        remainder1Sent: false,
        status: 'confirmed'
      }
    });

    // Send reminder for tomorrow's appointments
    appointmentsTomorrow.forEach(async (appointment) => {
      if (appointment.date == tomorrowDateString) {
        // Send a message to the patient
        const url = process.env.WHATSAPP_API_URL;
        const headers = {
          "Content-Type": "application/json",
          apikey: process.env.WHATSAPP_AUTH_TOKEN,
        };
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

        // const messages = [
        //     // Message for Patient
        //     {
        //         "coding": "1",
        //         "id": "15b0cc79c0da45771662021",
        //         "msgtype": "1",
        //         "text": "",
        //         "templateinfo": `1489537~${appointment.patientName}~${appointment.doctorName}~${appointment.date}~${appointment.time}`,
        //         "addresses": [
        //             {
        //                 "to": appointment.phoneNumber,
        //                 "from": fromPhoneNumber,
        //             }
        //         ]
        //     },
        //     // Message for Doctor
        // ];

        // const data = {
        //     "apiver": "1.0",
        //     "whatsapp": {
        //         "ver": "2.0",
        //         "dlr": {
        //             "url": ""
        //         },
        //         "messages": messages
        //     }
        // };
        const payload = {
          from: fromPhoneNumber, // Sender's WhatsApp number
          to: appointment.phoneNumber, // Recipient's WhatsApp number
          type: "template", // Type of the message
          message: {
            templateid: "674507", // Replace with the actual template ID
            placeholders: [appointment.patientName, appointment.doctorName, formatDateYear(new Date(appointment.date)), appointment.time], // Dynamic placeholders
          },
        };


        try {
          const response = await axios.post(url!, payload, { headers });
          if (response.data.code === '200') {
            console.log({
              message: 'WhatsApp message sent successfully',
              data: response.data, // Optional: Include response data
            });
          }
          else {
            console.log({
              message: 'Failed to send',
              data: response.data
            })
          }
          console.log(payload);
          let success = 'true'
          if (success === 'true') {
            const apiKey = process.env.SMS_API_KEY;
            const apiUrl = process.env.SMS_API_URL;
            const sender = process.env.SMS_SENDER;
            let success_message = `Namaste ${appointment.patientName}, This is a kind reminder of your upcoming appointment with ${appointment.doctorName} is scheduled for tomorrow, ${formatDateYear(new Date(appointment.date))} at ${appointment.time}. Thank you. Regards, Team Rashtrotthana`;
            const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_TOMORROW;
            const urlforComplete = `${apiUrl}/${sender}/${appointment.phoneNumber}/${encodeURIComponent(success_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
            const responseofcomplete = await axios.get(urlforComplete);
            console.log('SMS sent successfully to patient', responseofcomplete.data);
          }
          await prisma.appointment.update({
            where: { id: appointment.id },
            data: { remainder1Sent: true }
          });
          console.log('WhatsApp message(s) sent successfully');
          console.log(`Reminder sent for tomorrow's appointment: ${appointment.patientName}`);
        } catch (error) {
          console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
        }

      }


    });

    // const now = new Date(isoString.split('T')[0]);  // Get the current time
    // console.log('Current time (local):', now);

    // // Add 4 hours to the current time
    // const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000); // Add 4 hours
    // const fourHoursTimeString = fourHoursLater.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    // const fiveHoursLater = new Date(now.getTime() + 5 * 60 * 60 * 1000); // Add 5 hours
    // const fiveHoursTimeString = fiveHoursLater.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    // console.log('4 hours later (local):', fourHoursLater);
    console.log(indianDate, 'isoString');
    const now = new Date(indianDate);
    // const timeiso = indianTime;
    console.log('Current time (local) in get time:', indianTimeOnly);


    // Add 4 hours to the current time
    // const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000); // Add 4 hours
    // const fourHoursTimeString = fourHoursLater.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const indianTimePlus4 = indianTime.clone().add(4, 'hours');
    const indianTimePlus4Str = indianTimePlus4.format('HH:mm');
    const indianTimePlus5 = indianTime.clone().add(5, 'hours');
    const indianTimePlusHoursStr = indianTimePlus5.format('HH:mm');

    // Add 5 hours to the current time
    // const fiveHoursLater = new Date(now.getTime() + 5 * 60 * 60 * 1000); // Add 5 hours
    // const fiveHoursTimeString = fiveHoursLater.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    console.log('4 hours later (local):', indianTimePlus4Str);
    // console.log('4 hours time string (local, 24-hour format):', fourHoursTimeString);
    console.log('5 hours later (local):', indianTimePlusHoursStr);
    // console.log('5 hours time string (local, 24-hour format):', fiveHoursTimeString);
    // console.log('4 hours time string (local, 24-hour format):', fourHoursTimeString);
    // Helper function to convert time (HH:mm) to minutes for comparison
    function convertTimeToMinutes(time: string): number {
      const [hours, minutes] = time.split(':').map(Number);  // Split and convert to numbers
      return hours * 60 + minutes;  // Convert to minutes
    }

    // Calculate 4 hours before appointment start time
    function calculateReminderTime(startTime: string): string {
      const startTimeInMinutes = convertTimeToMinutes(startTime); // Convert start time to minutes
      const reminderTimeInMinutes = startTimeInMinutes - (4 * 60); // Subtract 4 hours (in minutes)
      const reminderHour = Math.floor(reminderTimeInMinutes / 60); // Get hour
      const reminderMinutes = reminderTimeInMinutes % 60; // Get minutes

      // Format the reminder time as HH:mm (24-hour format)
      return `${reminderHour.toString().padStart(2, '0')}:${reminderMinutes.toString().padStart(2, '0')}`;
    }

    // Loop through all appointments and calculate 4 hours before the start time
    const appointmentsToday = await prisma.appointment.findMany({
      where: {
        date: todayDateString, // For tomorrow's appointments
        remainder2Sent: false,
        status: 'confirmed' // To avoid re-sending reminders
      }
    });

    console.log(appointmentsToday, 'appointmentsToday');
    // Utility function to convert 12-hour time format to 24-hour format
    const convertTo24HourFormat = (time: string): { hours: number, minutes: number } => {
      const period = time.slice(-2); // Extract AM or PM
      let [hours, minutes] = time.slice(0, -2).split(':').map(Number); // Extract hour and minutes as numbers

      if (period.toLowerCase() === 'pm' && hours < 12) {
        hours += 12; // Add 12 hours if it's PM and not 12 PM
      } else if (period.toLowerCase() === 'am' && hours === 12) {
        hours = 0; // Convert 12 AM to 00 hours
      }

      return { hours, minutes };
    };

    // Send reminder for today, 4 hours before the appointment
    appointmentsToday.forEach(async (appointment) => {
      const startTime = appointment.time.trim(); // Example format: '01:15 PM'
      console.log(startTime, 'startTime');
      // Convert start time to 24-hour format
      const { hours: startTimeHour, minutes: startTimeMinute } = convertTo24HourFormat(startTime);
      console.log(startTimeHour, 'startTimeHour');

      // Extract hours for checking
      const fourHoursLater = Number(indianTimePlus4Str.split(':')[0]); // Extract hour for 4 hours later
      const fiveHoursLater = Number(indianTimePlusHoursStr.split(':')[0]); // Extract hour for 5 hours later

      // Log debug information (optional)
      console.log(indianTimePlus4Str, 'four', indianTimePlusHoursStr, 'five');
      console.log('Start time hour:', startTimeHour, 'Four hours later:', fourHoursLater, 'Five hours later:', fiveHoursLater);


      if (startTimeHour >= fourHoursLater && startTimeHour < fiveHoursLater) {
        console.log('Sending reminder for 4 hours before appointment:', appointment.patientName);
        // Send a message to the patient
        const url = process.env.WHATSAPP_API_URL;
        const headers = {
          "Content-Type": "application/json",
          apikey: process.env.WHATSAPP_AUTH_TOKEN,
        };
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

        // const messages = [
        //     // Message for Patient
        //     {
        //         "coding": "1",
        //         "id": "15b0cc79c0da45771662021",
        //         "msgtype": "1",
        //         "text": "",
        //         "templateinfo": `1489438~${appointment.patientName}~${appointment.doctorName}~${appointment.date}~${appointment.time}`,
        //         "addresses": [
        //             {
        //                 "to": appointment.phoneNumber,
        //                 "from": fromPhoneNumber,
        //             }
        //         ]
        //     },
        //     // Message for Doctor
        // ];

        // const data = {
        //     "apiver": "1.0",
        //     "whatsapp": {
        //         "ver": "2.0",
        //         "dlr": {
        //             "url": ""
        //         },
        //         "messages": messages
        //     }
        // };
        const payload1 = {
          from: fromPhoneNumber, // Sender's WhatsApp number
          to: appointment.phoneNumber, // Recipient's WhatsApp number
          type: "template", // Type of the message
          message: {
            templateid: "674503", // Replace with the actual template ID
            placeholders: [appointment.patientName, appointment.doctorName, formatDateYear(new Date(appointment.date)), appointment.time], // Dynamic placeholders
          },
        };


        try {
          const response = await axios.post(url!, payload1, { headers });
          if (response.data.code === '200') {
            console.log({
              message: 'WhatsApp message sent successfully',
              data: response.data, // Optional: Include response data
            });
          }
          else {
            console.log({
              message: 'Failed to send',
              data: response.data
            })
          }
          console.log('WhatsApp message(s) sent successfully', payload1);
          console.log('WhatsApp message(s) sent successfully');
          let success = 'true'
          if (success === 'true') {
            const apiKey = process.env.SMS_API_KEY;
            const apiUrl = process.env.SMS_API_URL;
            const sender = process.env.SMS_SENDER;
            let success_message = `Namaste ${appointment.patientName}, This is a gentle reminder of your upcoming appointment with ${appointment.doctorName} is scheduled for today, ${formatDateYear(new Date(appointment.date))} at ${appointment.time}. Please note: 1. Kindly arrive at least 10 minutes prior to complete the billing process. 2. Appointments are attended on a first-come, first-served basis. 3. Delays may occur if the doctor is handling an emergency. Thank you for your cooperation. Regards, Team Rashtrotthana`;
            const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_REMAINDER;
            const urlforComplete = `${apiUrl}/${sender}/${appointment.phoneNumber}/${encodeURIComponent(success_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
            const responseofcomplete = await axios.get(urlforComplete);
            console.log('SMS sent successfully to patient', responseofcomplete.data);
          }
          await prisma.appointment.update({
            where: { id: appointment.id },
            data: { remainder2Sent: true }
          });
          console.log(`Reminder sent for 4 hours before appointment: ${appointment.patientName}`);
        } catch (error) {
          console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
        }

      }
      // await sendWhatsAppMessage(
      //     appointment.patientName, 
      //     appointment.doctorName, 
      //     appointment.time,  // Slot like "10:00-10:20"
      //     appointment.date, 
      //     appointment.patientPhoneNumber, 
      //     appointment.doctorPhoneNumber, 
      //     'Reminder: Your appointment is in 4 hours'
      // );
      // await prisma.appointment.update({
      //     where: { id: appointment.id },
      //     data: { remainder2Sent: true }
      // });

    });

  } catch (error) {
    console.error('Error checking and sending reminders:', error);
  }
};

// export const CornSchedular = async (req: Request, res: Response) => { 
// cron.schedule('0 * * * *', () => {
//     // Get the current time in Indian Standard Time (IST)
//     const currentIST = moment().tz('Asia/Kolkata');

//     // Log the current IST time
//     console.log(`Cron job started at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

//     // Use the IST time in your logic
//     checkAndSendReminders(); // Modify the function to accept the current IST if necessary
//     remainderForAdmin();
// });
// };
export const CornSchedular = async (req: Request, res: Response) => {
  try {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cloud Scheduler task triggered at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    // Run the required tasks
    await checkAndSendReminders();
    await remainderForAdmin();
    await reminderForServices();

    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Hourly task executed successfully', time: currentIST.format('YYYY-MM-DD HH:mm:ss') });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}

export const sendAppointmentReminders = async (req: Request, res: Response) => {
  res.status(200).json({ message: 'Reminder job is running in the background' });
};

export const sendWhatsAppChatbot = async (req: Request, res: Response) => {
  try {
    const { patientName, service, patientPhoneNumber } = req.body;
    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    // const messages = [];
    // messages.push({
    //     "coding": "1",
    //     "id": "15b0cc79c0da45771662021",
    //     "msgtype": "1",
    //     "text": "",
    //     "templateinfo": `1490445~${patientName}~${service}`,
    //     "type": "",
    //     "contenttype": "",
    //     "filename": "",
    //     "mediadata": "",
    //     "b_urlinfo": "",
    //     "addresses": [
    //         {
    //             "seq": "6310710c80900d37f7b9-20220901",
    //             "to": patientPhoneNumber,
    //             "from": fromPhoneNumber,
    //             "tag": ""
    //         }
    //     ]
    // });

    // const data = {
    //     "apiver": "1.0",
    //     "whatsapp": {
    //         "ver": "2.0",
    //         "dlr": {
    //             "url": ""
    //         },
    //         "messages": messages
    //     }
    // };
    const payload = {
      from: fromPhoneNumber, // Sender's WhatsApp number
      to: patientPhoneNumber, // Recipient's WhatsApp number
      type: "template", // Type of the message
      message: {
        templateid: "674511", // Replace with the actual template ID
        placeholders: [patientName, service], // Dynamic placeholders
      },
    };

    try {
      const response = await axios.post(url!, payload, { headers });
      res.status(200).json({ message: 'WhatsApp message(s) sent successfully', response: response.data });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to send WhatsApp message(s)',
        details: (error as any).response ? (error as any).response.data : (error as any).message
      });
    }

  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export const sendDoctorMessage = async () => {
  try {
    const indianTime = moment.tz("Asia/Kolkata");
    const tomorrow = indianTime.clone().add(1, 'day').format('DD-MM-YYYY');

    // Fetch all doctors who have appointments tomorrow
    const appointmentsTomorrow = await prisma.appointment.findMany({
      where: {
        date: tomorrow,
        status: 'confirmed',
      },
      select: {
        doctorId: true,
        doctorName: true,
        date: true,
      },
    });
    console.log('Appointments for tomorrow:', appointmentsTomorrow);
    // Get doctor phone numbers from the doctor table
    const doctorIds = [...new Set(appointmentsTomorrow.map(app => app.doctorId).filter(id => id !== null))];
    const doctors = await prisma.doctor.findMany({
      where: {
        id: { in: doctorIds },
      },
      select: {
        id: true,
        phone_number: true,
      },
    });

    // Create a map to get the phone number by doctor ID
    const doctorPhoneMap = new Map(doctors.map(doctor => [doctor.id, doctor.phone_number]));

    // Create a map to store the appointment count per doctor
    const doctorAppointmentsMap = new Map();

    // Group appointments by doctor ID
    appointmentsTomorrow.forEach(appointment => {
      if (appointment.doctorId !== null) {
        if (!doctorAppointmentsMap.has(appointment.doctorId)) {
          doctorAppointmentsMap.set(appointment.doctorId, {
            doctorName: appointment.doctorName,
            appointments: [],
          });
        }
        doctorAppointmentsMap.get(appointment.doctorId).appointments.push(appointment);
      }
    });

    // Send message to each doctor
    for (const [doctorId, { doctorName, appointments }] of doctorAppointmentsMap) {
      const appointmentCount = appointments.length;
      const doctorPhoneNumber = doctorPhoneMap.get(doctorId);

      if (doctorPhoneNumber) {
        console.log("doctor Message")
        const message = `Namaste Dr. ${doctorName}, you have ${appointmentCount} appointment(s) scheduled for tomorrow, ${tomorrow}. Please check your schedule for more details.`;

        const url = process.env.WHATSAPP_API_URL;
        const headers = {
          "Content-Type": "application/json",
          apikey: process.env.WHATSAPP_AUTH_TOKEN,
        };
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        console.log('message:', message);

        // const messages = [
        //     // Message for Patient
        //     {
        //         "coding": "1",
        //         "id": "15b0cc79c0da45771662021",
        //         "msgtype": "1",
        //         "text": "",
        //         "templateinfo": `1495858~${doctorName}~${appointmentCount}~${tomorrow}`,
        //         "addresses": [
        //             {   
        //                 "seq": "6310710c80900d37f7b9-20220901",
        //                 "to": doctorPhoneNumber,
        //                 "from": fromPhoneNumber,
        //             }
        //         ]
        //     },
        //     // Message for Doctor
        // ];

        // const data = {
        //     "apiver": "1.0",
        //     "whatsapp": {
        //         "ver": "2.0",
        //         "dlr": {
        //             "url": ""
        //         },
        //         "messages": messages
        //     }
        // };
        const payload = {
          from: fromPhoneNumber, // Sender's WhatsApp number
          to: doctorPhoneNumber, // Recipient's WhatsApp number
          type: "template", // Type of the message
          message: {
            templateid: "674515", // Replace with the actual template ID
            placeholders: [doctorName, appointmentCount, tomorrow], // Dynamic placeholders
          },
        };


        try {
          await axios.post(url!, payload, { headers });
          console.log(`WhatsApp message sent successfully to ${doctorName}`);
        } catch (error) {
          console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
        }
      }
    }
  }
  catch (error) {
    console.error('Error sending WhatsApp message:', error);
    // res.status(500).json({ error: 'Internal server error' });
  }
}

export const timeNineRemainder = async (req: Request, res: Response) => {
  // cron.schedule('0 21 * * *', async () => {
  //   console.log('Running scheduled task to send doctor appointment reminders and screenshot');
  //   await sendDoctorMessage();
  //   await ScreenshotController.captureDashboard();
  // }, {
  //   timezone: 'Asia/Kolkata',
  // });
  try {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cloud Scheduler task triggered at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    // Run the required tasks
    // await markComplete()
    await sendDoctorMessage();
    await ScreenshotController.captureDashboard();
    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Hourly task executed successfully', time: currentIST.format('YYYY-MM-DD HH:mm:ss') });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}

export const timeElevenRemainder = async (req: Request, res: Response) => {
  try {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cloud Scheduler task triggered at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    // Run the required tasks
    await markComplete()

    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Hourly task executed successfully', time: currentIST.format('YYYY-MM-DD HH:mm:ss') });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}
export const timeThreeRemainder = async (req: Request, res: Response) => {
  try {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cloud Scheduler task triggered at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    // Run the required tasks
    await markComplete()

    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Hourly task executed successfully', time: currentIST.format('YYYY-MM-DD HH:mm:ss') });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}

function formatTime(date: Date): string {
  return `${date.getHours()}:${date.getMinutes()} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
}
export const remainderForAdmin = async () => {
  try {
    const usEasternTime = moment().tz('America/New_York');
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");

    const indianDate = indianTime.toDate();
    const currentTime = indianDate;
    const oneHourAgo = subHours(currentTime, 1); // One hour ago

    // Get the hour range to check appointments
    const startHour = setMinutes(setSeconds(oneHourAgo, 0), 0); // Start of the previous hour (e.g., 4:00 PM if current is 5:00 PM)
    const endHour = setMinutes(setSeconds(currentTime, 0), 0); // Start of the current hour (e.g., 5:00 PM)

    const pendingRequests = await prisma.appointment.findMany({
      where: {
        status: 'pending',
      },
    });
    console.log('Pending Requests:', pendingRequests);

    if (pendingRequests.length > 0) {
      const newNotification = await prisma.notification.create({
        data: {
          type: 'appointment_request',
          title: 'Reminder for Pending Request',
          message: `${pendingRequests.length} appointment requests are pending. Kindly check`,
          entityType: 'reminder',
          isCritical: false,
          targetRole: 'sub_admin', // Associate the notification with the specific receptionist
        },
      });
      notifyPendingAppointments(newNotification)
    }

    // Fetch confirmed appointments for today that fall within the previous hour
    const pendingAppointments = await prisma.appointment.findMany({
      where: {
        date: {
          equals: currentTime.toISOString().split('T')[0], // Appointments for today
        },
        checkedIn: false,
        status: 'confirmed',
        time: {

          lt: formatTime(endHour),    // Less than start of the current hour
        },
      },
      include: {
        doctor: true
      }
    });
    console.log('Pending Appointments:', pendingAppointments);
    // Step 4: If there are pending appointments, create a notification for sub-admin
    if (pendingAppointments.length > 0) {
      const receptionists = await prisma.user.findMany({
        where: {
          role: 'sub_admin',
          isReceptionist: true, // Assuming `isReceptionist` is a boolean column in the `user` table
        },
      });

      if (receptionists.length === 0) {
        console.log('No receptionists found to send the notification');
        return;
      }
      //   for (const receptionist of receptionists) {
      const newNotification = await prisma.notification.create({
        data: {
          type: 'appointment_remainder',
          title: 'Reminder',
          message: `${pendingAppointments.length} appointments require action. Please mark them as complete or cancel`,
          entityType: 'reminder',
          isCritical: false,
          targetRole: 'sub_admin' // Associate the notification with the specific receptionist
        },
      });
      notifyPendingAppointments(newNotification)

      console.log(`Notification sent to receptionist: `, newNotification);



    } else {
      console.log('No confirmed appointments found for the upcoming hour.');
    }
  }
  catch (error) {
    console.error('Error sending Notification message:', error);
    // res.status(500).json({ error: 'Internal server error' });
  }
}
export const reminderForServices = async () => {
  try {
    const usEasternTime = moment().tz('America/New_York');
    const indianTime = usEasternTime.clone().tz("Asia/Kolkata");

    const indianDate = indianTime.toDate();
    const currentTime = indianDate;
    const oneHourAgo = subHours(currentTime, 1); // One hour ago

    // Get the hour range to check services
    const startHour = setMinutes(setSeconds(oneHourAgo, 0), 0); // Start of the previous hour (e.g., 4:00 PM if current is 5:00 PM)
    const endHour = setMinutes(setSeconds(currentTime, 0), 0); // Start of the current hour (e.g., 5:00 PM)

    // Fetch pending services
    const pendingServices = await prisma.service.findMany({
      where: {
        appointmentStatus: 'pending',
      },
    });

    console.log('Pending Services:', pendingServices);

    if (pendingServices.length > 0) {
      const newNotification = await prisma.notification.create({
        data: {
          type: 'service_request',
          title: 'Reminder for Pending Service Requests',
          message: `${pendingServices.length} service requests are pending. Kindly check.`,
          entityType: 'reminder',
          isCritical: false,
          targetRole: 'sub_admin',
        },
      });
      notifyPendingAppointments(newNotification);
    }
    console.log('Notification sent for pending service requests.', currentTime.toISOString().split('T')[0], formatTime(endHour));
    // Fetch confirmed services for today that fall within the previous hour
    const confirmedServices = await prisma.service.findMany({
      where: {
        appointmentDate: {
          equals: currentTime.toISOString().split('T')[0], // Services for today
        },
        checkedIn: false,
        appointmentTime: {
          lt: formatTime(endHour), // Less than the start of the current hour
        },
      },
    });

    console.log('Confirmed Services:', confirmedServices);

    // If there are confirmed services, create a notification for sub-admin
    if (confirmedServices.length > 0) {
      const subAdmins = await prisma.user.findMany({
        where: {
          role: 'sub_admin',
          isReceptionist: true
        },
      });

      if (subAdmins.length === 0) {
        console.log('No sub-admins found to send the notification');
        return;
      }

      // for (const subAdmin of subAdmins) {
      const newNotificationforRemainder = await prisma.notification.create({
        data: {
          type: 'service_reminder',
          title: 'Reminder',
          message: `${confirmedServices.length} services require action. Please mark them as complete or cancel.`,
          entityType: 'reminder',
          isCritical: false,
          targetRole: 'sub_admin' // Associate the notification with the specific sub-admin
        },
      });
      notifyPendingAppointments(newNotificationforRemainder);
      console.log(`Notification sent to sub-admin: `, newNotificationforRemainder);

    } else {
      console.log('No confirmed services found for the upcoming hour.');
    }
  } catch (error) {
    console.error('Error sending service reminder notification:', error);
  }
};

export const sendServiceWhatsappMessage = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, packageName, phoneNumber, appointmentDate, appointmentTime, appointmentStatus, requestVia } = req.body;
    let payload = {};
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    // API endpoint
    const url = process.env.WHATSAPP_API_URL;

    const name = `${firstName} ${lastName}`;
    if (appointmentStatus === 'Confirm' || appointmentStatus === 'confirmed' || appointmentStatus === 'rescheduled') {
      // Prepare the payload
      payload = {
        from: fromPhoneNumber, // Sender's WhatsApp number
        to: phoneNumber, // Recipient's WhatsApp number
        type: "template", // Message type
        message: {
          templateid: "682645", // Template ID
          placeholders: [name, packageName, appointmentStatus, formatDateYear(new Date(appointmentDate)), appointmentTime], // Placeholders for the template
        },
      };
    }
    else if (appointmentStatus === 'cancelled' || appointmentStatus === 'Cancel' || appointmentStatus === 'Cancelled') {
      const time = appointmentStatus === 'pending' ? '' : appointmentTime;

      payload = {
        from: fromPhoneNumber, // Sender's WhatsApp number
        to: phoneNumber, // Recipient's WhatsApp number
        type: "template", // Message type
        message: {
          templateid: "688775", // Template ID
          placeholders: [name, packageName, formatDateYear(new Date(appointmentDate))], // Placeholders for the template
        },
      };
    }
    else {
      payload = {
        from: fromPhoneNumber, // Sender's WhatsApp number
        to: phoneNumber, // Recipient's WhatsApp number
        type: "template", // Message type
        message: {
          templateid: "682649", // Template ID
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
    console.log('WhatsApp message sent successfully:1', response.data);

    // Send a success response
    res.status(200).json({
      status: "success",
      message: "WhatsApp message sent successfully.2",
      data: response.data,
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);

    // Send an error response
    res.status(500).json({
      status: "error",
      message: "Failed to send WhatsApp message."
    });
  }
};

export const sendAdminMessage = async (req: Request, res: Response) => {
  try {
    const { doctorName, departmentName, startDate, endDate, adminPhoneNumber } = req.body;
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL_BULK;
    const payload = {
      from: fromPhoneNumber, // Sender's WhatsApp number
      to: adminPhoneNumber, // Recipient's WhatsApp number
      type: "template", // Type of the message
      message: {
        templateid: "738057", // Replace with the actual template ID
        placeholders: [doctorName, departmentName, formatDateYear(startDate), endDate], // Dynamic placeholders
      },
    };


    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN, // Replace with your actual API key
    };
    const response = await axios.post(url!, payload, { headers });
    if (response.data.code === '200') {
      res.status(200).json({
        message: 'WhatsApp message sent successfully',
        data: response.data, // Optional: Include response data
      });
    }
    else {
      res.status(500).json({
        message: 'Failed to send',
        data: response.data
      })
    }


    // Log the response
    console.log('WhatsApp message sent successfully:1', response.data);

  }
  catch (error) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export const markComplete = async () => {
  try {
    // Get current Indian time
    const indianTime = moment().tz('Asia/Kolkata');
    const indianDate = indianTime.format('YYYY-MM-DD'); // Format as YYYY-MM-DD

    // Find appointments for today where `checkedOut` is true
    const checkedOutAppointments = await prisma.appointment.findMany({
      where: {
        date: indianDate, // Appointments for today
        checkedOut: true, // Only checked out appointments
        status: 'confirmed'
      },
    });

    if (checkedOutAppointments.length === 0) {
      console.log('No appointments found for today with checkedOut: true');
      // res.status(200).json({ message: 'No appointments to process' });
      return;
    }

    // Update the status of these appointments to "Complete"
    await Promise.all(
      checkedOutAppointments.map(async (appointment) => {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { status: 'completed' },
        });
        await prisma.bookedSlot.updateMany({
          where: {
            doctorId: appointment.doctorId, // Match doctor ID
            date: appointment.date, // Match appointment date
            time: appointment.time, // Match appointment time
          },
          data: { complete: true }, // Mark as complete
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
            templateid: '682641', // Replace with your actual template ID
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
          const successMessage = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. If you have any queries or need further assistance, feel free to reach out. Wishing you good health!`;
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

    // res.status(200).json({ message: 'Appointments marked as complete and notifications sent' });
  } catch (error) {
    console.error('Error marking complete:', error);
    // res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateEstimation = async () => {
  try {
    const currentDate = new Date();

    // Step 1: Find estimations with status "pending", "approved", or "confirmed"
    const estimations = await prisma.estimationDetails.findMany({
      where: {
        statusOfEstimation: {
          in: ["pending", "approved", "confirmed", "submitted", "rejected"], // Filter by statuses
        },
      },
    });

    // Step 2: Process each estimation to calculate `ageBucketOfSurgery` and check overdue
    const updatedEstimations = await Promise.all(
      estimations.map(async (estimation) => {
        console.log(estimation.estimationCreatedTime)
        const estimationCreatedTime = estimation.estimationCreatedTime!;
        const estimatedDate = estimation.estimatedDate ? new Date(estimation.estimatedDate) : null;
        console.log(estimatedDate)
        let ageBucket: number = 0
        if (estimationCreatedTime) {
          // Calculate ageBucketOfSurgery
          ageBucket = Math.ceil(
            (currentDate.getTime() - estimationCreatedTime.getTime()) / (1000 * 60 * 60 * 24) // Days difference
          );
        }
        let updatedData: any = {
          ageBucketOfSurgery: ageBucket,
        };

        // Check if estimation is overdue
        let updatedStatus = estimation.statusOfEstimation;
        if (
          (estimatedDate && estimatedDate < currentDate) || // Condition 1: Estimated date is past today
          (estimation.estimationType !== "Maternity" && estimation.statusOfEstimation === "approved" && ageBucket > 20) // Condition 2: Approved & 20+ days old
        ) {
          if (estimation.statusOfEstimation !== "completed" && estimation.statusOfEstimation !== "cancelled") {
            updatedStatus = "overDue";
            updatedData.statusOfEstimation = updatedStatus;
            updatedData.overDueDateAndTIme = new Date(); // Set overdue timestamp

            console.log(`Estimation ID: ${estimation.id} marked as Overdue`);
            const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
            const url = process.env.WHATSAPP_API_URL;
            const payload = {
              from: fromPhoneNumber, // Sender's WhatsApp number
              to: estimation.patientPhoneNumber, // Recipient's WhatsApp number
              type: "template", // Type of the message
              message: {
                templateid: "719369", // Replace with the actual template ID
                placeholders: [estimation.patientName], // Dynamic placeholders
              },
            };


            const headers = {
              "Content-Type": "application/json",
              apikey: process.env.WHATSAPP_AUTH_TOKEN, // Replace with your actual API key
            };
            const response = await axios.post(url!, payload, { headers });
          }

          // if (response.data.code === '200') {
          //   res.status(200).json({
          //     message: 'WhatsApp message sent successfully',
          //     data: response.data, // Optional: Include response data
          //   });
          // } else {
          //   return res.status(400).json({
          //     message: 'Failed to send WhatsApp message',
          //     error: response.data,
          //   });
          // }
        }
        console.log(updatedData, 'overdue')
        // Update estimation in database
        return prisma.estimationDetails.update({
          where: { id: estimation.id },
          data: updatedData
        });
      })
    );
    console.log(updatedEstimations)
    // Step 3: Respond with updated estimations
    // res.status(200).json({ success: true, data: updatedEstimations });
  }
  catch (error) {
    console.error('Error updating Estimation:', error);
    // res.status(500).json({ error: 'Internal server error' });
  }
}

// export const waitingTimeMessage = async (req: Request, res: Response) => {
//   try {
//     const { adminPhoneNumbers, doctorPhoneNumber, noOfPatients, doctorName, waitingMultiplier } = req.body;
//     console.log(doctorPhoneNumber, adminPhoneNumbers)

//     const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
//     const url = process.env.WHATSAPP_API_URL;
//     const headers = {
//       "Content-Type": "application/json",
//       apikey: process.env.WHATSAPP_AUTH_TOKEN,
//     };

//     // Ensure adminPhoneNumbers is an array
//     const maxAdminsToNotify = Math.min(waitingMultiplier, 3);  // Ensure max limit is 3
//     const adminsToNotify = adminPhoneNumbers.slice(0, maxAdminsToNotify);
//     console.log('Admins to Notify:', adminsToNotify);

//     // Send message to Admins
//     const adminPromises = adminsToNotify.map(async (adminPhoneNumber) => {
//       const adminPayload = {
//         from: fromPhoneNumber,
//         to: adminPhoneNumber,
//         type: "template",
//         message: {
//           templateid: "721975",
//           placeholders: [doctorName, noOfPatients],
//         },
//       };

//       try {
//         const response = await axios.post(url!, adminPayload, { headers });
//         console.log(`✅ Message sent to Admin: ${adminPhoneNumber}`, response.data);
//       } catch (err) {
//         console.error(`❌ Failed to send message to Admin: ${adminPhoneNumber}`, err);
//       }
//     }

//     // Send message to Doctor
//     if (doctorPhoneNumber) {
//       const doctorPayload = {
//         from: fromPhoneNumber,
//         to: doctorPhoneNumber,
//         type: "template",
//         message: {
//           templateid: "718875",
//           placeholders: [noOfPatients],
//         },
//       };

//       try {
//         const doctorResponse = await axios.post(url!, doctorPayload, { headers });
//         console.log(`✅ Message sent to Doctor: ${doctorPhoneNumber}`, doctorResponse.data);
//       } catch (err) {
//         console.error(`❌ Failed to send message to Doctor: ${doctorPhoneNumber}`, err);
//       }
//     } else {
//       console.warn("⚠️ No doctorPhoneNumber provided.");
//     }
//      res.status(200).json({
//       message: "WhatsApp messages sent successfully",
//     });

//   } catch (error) {
//     console.error("Error sending WhatsApp message:", error);
//      res.status(500).json({ error: "Internal server error" });
//   }
// };
export const waitingTimeMessage = async (adminPhoneNumbers: string[], doctorPhoneNumber: string, noOfPatients: number, doctorName: string, waitingMultiplier: number) => {
  try {
    // const { adminPhoneNumbers, doctorPhoneNumber, noOfPatients, doctorName, waitingMultiplier } = req.body;
    console.log('Doctor:', doctorPhoneNumber, 'Admins:', adminPhoneNumbers);

    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };

    // const maxAdminsToNotify = Math.min(waitingMultiplier, 3);
    // const adminsToNotify = adminPhoneNumbers.slice(0, maxAdminsToNotify);

    // ✅ Debug Logs
    console.log('🟢 Waiting Multiplier:', waitingMultiplier);
    console.log('🟢 Admin Phone Numbers:', adminPhoneNumbers);
    console.log('🟢 Admins to Notify:', adminPhoneNumbers);

    if (adminPhoneNumbers.length === 0) {
      console.warn('⚠️ No admins selected for notification. Check adminPhoneNumbers array.');
    }

    // ✅ Send messages to Admins in parallel
    const adminPromises = adminPhoneNumbers.map(async (adminPhoneNumber: any) => {
      console.log(adminPhoneNumber)
      const adminPayload = {
        from: fromPhoneNumber,
        to: adminPhoneNumber,
        type: "template",
        message: {
          templateid: "731041", // Ensure this template ID is valid for Admins
          placeholders: [doctorName, noOfPatients],
        },
      };

      console.log(`🚀 Sending message to Admin: ${adminPhoneNumber}...`);

      try {
        const response = await axios.post(url!, adminPayload, { headers });
        console.log(`✅ Message sent to Admin: ${adminPhoneNumber}`, response.data);
        return response.data;
      } catch (err) {
        console.error(`❌ Failed to send message to Admin: ${adminPhoneNumber}`, err);
        return null;
      }
    });

    // ✅ Ensure all requests complete before proceeding
    Promise.all(adminPromises)
      .then(() => console.log('✅ All Admin Messages Sent'))
      .catch((error) => console.error('❌ Error sending messages:', error));


    // ✅ Send message to Doctor
    if (doctorPhoneNumber) {
      const doctorPayload = {
        from: fromPhoneNumber,
        to: doctorPhoneNumber,
        type: "template",
        message: {
          templateid: "718875",  // Ensure this template ID is valid for Doctors
          placeholders: [noOfPatients],
        },
      };

      try {
        const doctorResponse = await axios.post(url!, doctorPayload, { headers });
        console.log(`✅ Message sent to Doctor: ${doctorPhoneNumber}`, doctorResponse.data);
      } catch (err: any) {
        console.error(`❌ Failed to send message to Doctor: ${doctorPhoneNumber}`, err.response?.data || err);
      }
    } else {
      console.warn("⚠️ No doctorPhoneNumber provided.");
    }

    // res.status(200).json({
    //   message: "WhatsApp messages processed successfully",
    //   adminResponses,
    // });

  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error);
    // res.status(500).json({ error: "Internal server error" });
  }
};


export const loginRemainder = async (req: Request, res: Response) => {
  try {
    const { doctorPhoneNumber, noOfPatients, doctorName, doctorId } = req.body;


    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const doctorPayload = {
      from: fromPhoneNumber,
      to: doctorPhoneNumber,
      type: "template",
      message: {
        templateid: "731635",  // Ensure this template ID is valid for Doctors
        placeholders: [doctorName, noOfPatients],
      },
    };

    try {
      const doctorResponse = await axios.post(url!, doctorPayload, { headers });
      console.log(`✅ Message sent to Doctor: ${doctorPhoneNumber}`, doctorResponse.data);
      messageSent(doctorId)
    } catch (err: any) {
      console.error(`❌ Failed to send message to Doctor: ${doctorPhoneNumber}`, err.response?.data || err);
    }

  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const adminDoctorLateLogin = async (req: Request, res: Response) => {
  try {
    const { adminPhoneNumber, noOfPatients, doctorName, doctorId } = req.body;


    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL_BULK;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const doctorPayload = {
      from: fromPhoneNumber,
      to: adminPhoneNumber,
      type: "template",
      message: {
        templateid: "731637",  // Ensure this template ID is valid for Doctors
        placeholders: [doctorName, noOfPatients],
      },
    };

    try {
      const doctorResponse = await axios.post(url!, doctorPayload, { headers });
      console.log(`✅ Message sent to Doctor: ${adminPhoneNumber}`, doctorResponse.data);
      adminAlertSent(doctorId)
    } catch (err: any) {
      console.error(`❌ Failed to send message to Doctor: ${adminPhoneNumber}`, err.response?.data || err);
    }

  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const individualComplete = async (req: Request, res: Response) => {
  try {
    const appointment = req.body;
    console.log(appointment)
    // Get current Indian time
    const indianTime = moment().tz('Asia/Kolkata');
    const indianDate = indianTime.format('YYYY-MM-DD'); // Format as YYYY-MM-DD

    // Find appointments for today where `checkedOut` is true
    const checkedOutAppointments = Array.isArray(appointment) ? appointment : [appointment];

    if (checkedOutAppointments.length === 0) {
      console.log('No appointments found for today with checkedOut: true');
      res.status(200).json({ message: 'No appointments to process' });
      return;
    }

    // Update the status of these appointments to "Complete"
    await Promise.all(
      checkedOutAppointments.map(async (appointment: any) => {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { status: 'completed' },
        });
        await prisma.bookedSlot.updateMany({
          where: {
            doctorId: appointment.doctorId, // Match doctor ID
            date: appointment.date, // Match appointment date
            time: appointment.time, // Match appointment time
          },
          data: { complete: true }, // Mark as complete
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
            templateid: '682641', // Replace with your actual template ID
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
          const successMessage = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. If you have any queries or need further assistance, feel free to reach out. Wishing you good health!`;
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

    res.status(200).json({ message: 'Appointments marked as complete and notifications sent' });
  } catch (error) {
    console.error('Error marking complete:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// const cancelExpiredAppointments = async () => {
//   try {
//     // Get current time in IST
//     const currentTimeIST = moment().tz("Asia/Kolkata");
//     console.log("⏰ Current IST Time:", currentTimeIST.format("YYYY-MM-DD HH:mm:ss"));

//     // Fetch expired appointments (Older than 30 mins)
//     const expiredAppointments = await prisma.appointment.findMany({
//       where: {
//         checkedIn: false,
//         checkedOut: false,
//         status: 'confirmed',
//         date: currentTimeIST.format("YYYY-MM-DD"), // Get only today's date
//         time: {
//           lt: currentTimeIST.subtract(30, "minutes").format("HH:mm:ss"), // Subtract 30 mins
//         },
//       },
//     });

//     if (expiredAppointments.length === 0) {
//       console.log("✅ No expired appointments to cancel.");
//       return;
//     }

//     console.log(`⚠️ Found ${expiredAppointments.length} expired appointments. Canceling...`);

//     // Cancel appointments
//     await prisma.appointment.updateMany({
//       where: {
//         id: {
//           in: expiredAppointments.map((appt) => appt.id),
//         },
//       },
//       data: {
//         status: 'cancelled',
//       },
//     });

//     console.log("✅ Expired appointments canceled successfully.");
//   } catch (error) {
//     console.error("❌ Error canceling expired appointments:", error);
//   }
// };

export const cancelExpiredAppointments = async () => {

  // Get current time in IST
  const currentTimeIST = moment().tz("Asia/Kolkata");
  console.log("⏰ Current IST Time:", currentTimeIST.format("YYYY-MM-DD HH:mm:ss"));

  // **Step 1: Fetch Expired Appointments (Older than 30 mins)**
  const expiredAppointments = await prisma.appointment.findMany({
    where: {
      checkedIn: false,
      checkedOut: false,
      status: 'confirmed',
      date: currentTimeIST.format("YYYY-MM-DD"), // Only today's date
    },
    include: { doctor: true }, // Fetch doctor details
  });
  // const thresholdTime = currentTimeIST.subtract(30, "minutes").format("HH:mm:ss");
  // const currentTimeIST = moment().tz("Asia/Kolkata"); // Get current IST time
  const thresholdTime = moment().tz("Asia/Kolkata").subtract(30, "minutes"); // Subtract 30 mins from current time
  
  const filteredAppointments = expiredAppointments.filter((appt) => {
    // Ensure appointment date and time are correctly parsed together
    const appointmentTime = moment.tz(`${appt.date} ${appt.time}`, "YYYY-MM-DD hh:mm A", "Asia/Kolkata");
  
    console.log(`📅 Appointment Time: ${appointmentTime.format("YYYY-MM-DD hh:mm A")}`);
    console.log(`⏳ Threshold Time: ${thresholdTime.format("YYYY-MM-DD hh:mm A")}`);
    console.log(`🕒 Current Time: ${currentTimeIST.format("YYYY-MM-DD hh:mm A")}`);
  
    // Only cancel if the appointment time is *before* the threshold and is still today's appointment
    return appointmentTime.isBefore(thresholdTime) && appointmentTime.isSame(currentTimeIST, "day");
  });
  
  console.log(filteredAppointments)

  if (filteredAppointments.length === 0) {
    console.log("✅ No expired appointments to cancel.");
    return;
  }

  console.log(`⚠️ Found ${filteredAppointments.length} expired appointments. Cancelling...`);

  const whatsappUrl = process.env.WHATSAPP_API_URL;
  const smsApiKey = process.env.SMS_API_KEY;
  const smsApiUrl = process.env.SMS_API_URL;
  const smsSender = process.env.SMS_SENDER;
  const smsDltEntityId = process.env.DLT_ENTITY_ID;
  const smsPatientTemplateId = process.env.SMS_DLT_TE_ID_FOR_PATIENT;
  const smsDoctorTemplateId = process.env.SMS_DLT_TE_ID_FOR_DOCTOR;

  const headers = {
    "Content-Type": "application/json",
    apikey: process.env.WHATSAPP_AUTH_TOKEN,
  };
  const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

  const cancelPromises = filteredAppointments.map(async (appointment) => {
    const { id, doctorId, date, time, phoneNumber, patientName, doctor } = appointment;

    // **Step 2: Delete Booked Slot**
    await prisma.bookedSlot.deleteMany({
      where: { doctorId, date, time },
    });
    console.log(`🗑️ Deleted booked slot for Doctor ID: ${doctorId}, Date: ${date}, Time: ${time}`);

    // **Step 3: Update Appointment Status to "Cancelled"**
    await prisma.appointment.update({
      where: { id },
      data: { status: "cancelled" },
    });
    console.log(`❌ Updated appointment status to cancelled for Appointment ID: ${id}`);

    // **Step 4: Send WhatsApp message to Patient**
    if (phoneNumber) {
      const patientMessagePayload = {
        from: fromPhoneNumber,
        to: phoneNumber, // Patient's WhatsApp number
        type: "template",
        message: {
          templateid: "674445", // Replace with actual template ID
          placeholders: [patientName, doctor?.name || "Doctor", "cancelled", formatDateYear(new Date(date)), time],
        },
      };

      try {
        const patientResponse = await axios.post(whatsappUrl!, patientMessagePayload, { headers });
        console.log(
          patientResponse.data.code === "200"
            ? `✅ WhatsApp message sent successfully to Patient: ${phoneNumber}`
            : `⚠️ Failed to send WhatsApp message to Patient: ${phoneNumber}`,
          patientResponse.data
        );
      } catch (error) {
        console.error("❌ Error sending WhatsApp message to Patient:", error);
      }
    }

    // **Step 5: Send WhatsApp message to Doctor**
    if (doctor?.phone_number) {
      const doctorMessagePayload = {
        from: fromPhoneNumber,
        to: doctor.phone_number, // Doctor's WhatsApp number
        type: "template",
        message: {
          templateid: "674491", // Replace with actual doctor template ID
          placeholders: [doctor.name, "cancelled", patientName, formatDateYear(new Date(date)), time],
        },
      };

      try {
        const doctorResponse = await axios.post(whatsappUrl!, doctorMessagePayload, { headers });
        console.log(
          doctorResponse.data.code === "200"
            ? `✅ WhatsApp message sent successfully to Doctor: ${doctor.phone_number}`
            : `⚠️ Failed to send WhatsApp message to Doctor: ${doctor.phone_number}`,
          doctorResponse.data
        );
      } catch (error) {
        console.error("❌ Error sending WhatsApp message to Doctor:", error);
      }
    }
    const status = 'cancelled'
    // **Step 6: Send SMS to Patient**
    if (phoneNumber) {
      const patientMessage = `Hello ${patientName}, your appointment with ${doctor?.name} is ${status} on ${formatDateYear(new Date(date))} at ${time}. For any questions, contact 97420 20123. hank You! Regards, Rashtrotthana Team`;
      const smsUrlPatient = `${smsApiUrl}/${smsSender}/${phoneNumber}/${encodeURIComponent(patientMessage)}/TXT?apikey=${smsApiKey}&dltentityid=${smsDltEntityId}&dlttempid=${smsPatientTemplateId}`;

      try {
        const smsResponsePatient = await axios.get(smsUrlPatient);
        console.log(`📩 SMS sent successfully to Patient: ${phoneNumber}`, smsResponsePatient.data);
      } catch (error) {
        console.error(`❌ Error sending SMS to Patient: ${phoneNumber}`, error);
      }
    }

    // **Step 7: Send SMS to Doctor**
    if (doctor?.phone_number) {
      const doctorMessage = `Hi ${doctor.name}, you have a ${status} appointment with ${patientName} on ${formatDateYear(new Date(date))} at ${time}. For any questions, please contact 8904943673. Thank You! Regards, Rashtrotthana Team`;
      const smsUrlDoctor = `${smsApiUrl}/${smsSender}/${doctor.phone_number}/${encodeURIComponent(doctorMessage)}/TXT?apikey=${smsApiKey}&dltentityid=${smsDltEntityId}&dlttempid=${smsDoctorTemplateId}`;

      try {
        const smsResponseDoctor = await axios.get(smsUrlDoctor);
        console.log(`📩 SMS sent successfully to Doctor: ${doctor.phone_number}`, smsResponseDoctor.data);
      } catch (error) {
        console.error(`❌ Error sending SMS to Doctor: ${doctor.phone_number}`, error);
      }
    }

    // **Step 8: Insert into `unavailableSlot` table**
    // await prisma.unavailableSlot.create({
    //   data: {
    //     doctorId: Number(doctorId),
    //     date: date,
    //     time: time,
    //   },
    // });

    // console.log(`📌 Slot added to unavailableSlot for Doctor ID: ${doctorId}, Date: ${date}, Time: ${time}`);

    return id; // Return the appointment ID after processing
  });

  // Wait for all updates to complete
  await Promise.all(cancelPromises);

  console.log("✅ All expired appointments cancelled successfully.");

};

// Schedule the cron job every 5 minutes


export const doctorAvailability = async (req: Request, res: Response) => {
  try {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cloud Scheduler task triggered at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    // await cancelExpiredAppointments();
    await checkDoctorAvailability();

    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Hourly task executed successfully', time: currentIST.format('YYYY-MM-DD HH:mm:ss') });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}

async function checkDoctorAvailability() {
  console.log("⏳ Running Doctor Availability Check...");

  const todayDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
  console.log(todayDate)

  // Get all doctors
  const doctors = await prisma.doctor.findMany({
    include: {
      availability: {
        where: {
          OR: [
            {
              updatedAt: null, // Include availability where updatedAt is null (for older records)
            },
            {
              updatedAt: {
                lte: new Date(), // Get availability updated on or before the requested date
              },
            },
          ],
        },
        orderBy: {
          updatedAt: 'desc', // For today, get the most recent past availability, for future use the latest, otherwise ascending for past dates
          // updatedAt: isToday || isFuture ? 'desc' : 'asc',
        },
      }, unavailableDates: true
    },
  });

  // console.log(doctors)

  for (const doctor of doctors) {
    if (!doctor || !doctor.availability || doctor.userId === null || doctor.doctorType === 'Visiting Consultant') {
      continue; // Skip invalid doctors
    }
    // console.log(doctor)
    // ✅ Check if the doctor is unavailable today
    const isUnavailableToday = doctor.unavailableDates.some((unavailableDate) =>
      moment(unavailableDate.date).tz("Asia/Kolkata").format("YYYY-MM-DD") === todayDate
    );
    // console.log(isUnavailableToday)
    if (isUnavailableToday) {
      console.log(`🚫 Dr. ${doctor.name} is unavailable today.`);
      continue; // Skip processing for this doctor
    }


    const allUpdatedAtNull = doctor.availability.every((avail: any) => !avail.updatedAt);
    // console.log(allUpdatedAtNull)

    // Step 2: Calculate the latest timestamp if any `updatedAt` is not null
    let latestTimestamp: string | null = null;
    if (!allUpdatedAtNull) {
      const maxTimestamp = doctor.availability
        .filter((avail: any) => avail.updatedAt) // Filter entries with non-null `updatedAt`
        .map((avail: any) => new Date(avail.updatedAt).getTime()) // Convert to timestamp
        .reduce((max: any, curr: any) => Math.max(max, curr), 0); // Find the max timestamp

      // Convert the max timestamp back to an ISO string
      latestTimestamp = new Date(maxTimestamp).toISOString();
      console.log(latestTimestamp, 'latest')
    }

    const latestAvailability = allUpdatedAtNull
      ? doctor.availability // If all are null, consider all availability as the latest
      : doctor.availability.filter((avail: any) => {
        // console.log("🔍 Checking Availability:", avail.updatedAt, "===", latestTimestamp);
        return new Date(avail.updatedAt).toISOString() === latestTimestamp;
      });

    const today = new Date().toLocaleString('en-us', { weekday: 'short' }).toLowerCase();
    const todayAvailability = latestAvailability.find((avail: any) => avail.day.toLowerCase() === today);

    if (!todayAvailability || !todayAvailability.availableFrom) {
      // console.log('skip')
      continue; // Skip if doctor is not available today
    }
    // ✅ Get first available slot time
    const firstSlot = todayAvailability?.availableFrom.split(',')[0].trim();
    const firstAvailableTime = firstSlot?.split("-")[0].trim();
    console.log(firstAvailableTime, 'first')
    const todayDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD"); // Get today's date

    // Convert 24-hour format (HH:mm) to 12-hour format (hh:mm A)
    const formattedTime = moment(firstAvailableTime, "HH:mm").format("hh:mm A");

    // Construct availableTime in Asia/Kolkata timezone
    const availableTime = moment.tz(`${todayDate} ${formattedTime}`, "YYYY-MM-DD hh:mm A", "Asia/Kolkata");

    // Get current IST time
    const currentTime = moment().tz("Asia/Kolkata");

    // // Compare only the minute-level precision
    // if (currentTime.isSame(availableTime, 'minute')) {
    //   console.log("🔔 Notification Triggered! It's time.");
    // } else {
    //   console.log("⏳ Not yet time for notification.");
    // }

    // const availableTime = moment.tz(`${todayDate} ${firstAvailableTime}`, "YYYY-MM-DD hh:mm A", "Asia/Kolkata");
    console.log(availableTime, doctor.id)

    // ✅ Fetch doctor's appointments
    const appointments = await prisma.appointment.findMany({
      where: { doctorId: doctor.id, date: todayDate, status: "confirmed", checkedIn: true },
    });
    console.log(appointments)

    // ✅ If appointments exist, check doctor's login status
    // if (appointments.length > 0) {
    const user = await prisma.user.findUnique({ where: { id: doctor.userId } });

    if (user && user.loggedInDate === todayDate) {
      console.log(`✅ Dr. ${doctor.name} is already logged in.`);
      continue;
    }

    // ✅ Send a login reminder 5 minutes before shift
    const notificationTime = availableTime.clone().subtract(5, "minutes");
    // const todayDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    if (currentTime.isSame(availableTime, 'minute')) {
      const sentAlert = await prisma.sentMessage.findFirst({
        where: {
          doctorId: doctor.id,
          alertType: "lateLogin",
          sentAt: {
            gte: moment().tz("Asia/Kolkata").startOf("day").toISOString(),  // ✅ Reset every day
            lte: moment().tz("Asia/Kolkata").toISOString(),  // ✅ Only check today
          },
        },
      });

      if (!sentAlert) {
        console.warn(`🚨 Sending login reminder to Dr. ${doctor.name}...`);

        await sendMessageToDoctor(doctor.phone_number, appointments.length, doctor.name, doctor.id);
      } else {
        console.log(`🚫 WhatsApp alert already sent to Dr. ${doctor.name}, skipping.`);
      }
    }


    // ✅ Check waiting time for first appointment
    if (appointments.length > 0) {
      const firstAppointment = appointments[0];
      console.log(firstAppointment)


      // const adminPhoneNumbers = ["919880544866", "916364833988"]
      const adminPhoneNumbers = ["919342287945", "919342287945"];
      const now = moment().tz("Asia/Kolkata").toDate();

      const thresholdTime = moment(availableTime).add(10, "minutes"); // Keeps thresholdTime as Moment

      if (!firstAppointment.checkedOut && now.getTime() > thresholdTime.toDate().getTime()) {
        console.warn(`⏳ Alert: First checked-in patient for Dr. ${doctor.name} has exceeded waiting time!`);
        await sendAdminAlertMessage(adminPhoneNumbers, appointments.length, doctor.name, doctor.id);
      }

    }
  }

  console.log("✅ Doctor Availability Check Completed.");
}


const sendMessageToDoctor = async (doctorPhoneNumber: string, noOfPatients: number, doctorName: string, doctorId: number) => {
  try {
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    let doctorPayload = {}
    if (noOfPatients > 0) {
      doctorPayload = {
        from: fromPhoneNumber,
        to: doctorPhoneNumber,
        type: "template",
        message: {
          templateid: "731635", // Ensure this template ID is valid for Doctors
          placeholders: [doctorName, noOfPatients],
        },
      };
    } else {
      doctorPayload = {
        from: fromPhoneNumber,
        to: doctorPhoneNumber,
        type: "template",
        message: {
          templateid: "743637", // Ensure this template ID is valid for Doctors
          placeholders: [doctorName],
        },
      };
    }

    const doctorResponse = await axios.post(url!, doctorPayload, { headers });
    console.log(`✅ Message sent to Doctor: ${doctorPhoneNumber}`, doctorResponse.data);

    // ✅ Log the message as sent
    await prisma.sentMessage.create({
      data: { doctorId, alertType: "lateLogin", sentAt: new Date() },
    });

  } catch (err: any) {
    console.error(`❌ Failed to send message to Doctor: ${doctorPhoneNumber}`, err.response?.data || err);
  }
};
const sendAdminAlertMessage = async (adminPhoneNumbers: string[], noOfPatients: number, doctorName: string, doctorId: number) => {
  try {
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL_BULK;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };

    const adminPayload = {
      from: fromPhoneNumber,
      to: adminPhoneNumbers,
      type: "template",
      message: {
        templateid: "731637", // Ensure this template ID is valid for Admins
        placeholders: [doctorName, noOfPatients],
      },
    };

    const adminResponse = await axios.post(url!, adminPayload, { headers });
    console.log(`✅ Admin Alert Sent: ${adminPhoneNumbers}`, adminResponse.data);

    // ✅ Log the message as sent
    await prisma.sentMessage.create({
      data: { doctorId, alertType: "adminAlert", sentAt: new Date() },
    });

  } catch (err: any) {
    console.error(`❌ Failed to send message to Admins: ${adminPhoneNumbers}`, err.response?.data || err);
  }
};
async function checkPatientWaitingTime() {
  console.log("⏳ Running Patient Waiting Time Check...");

  const todayDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
  console.log(todayDate)

  // Get all doctors
  const doctors = await prisma.doctor.findMany({
    include: {
      availability: {
        where: {
          OR: [
            {
              updatedAt: null, // Include availability where updatedAt is null (for older records)
            },
            {
              updatedAt: {
                lte: new Date(), // Get availability updated on or before the requested date
              },
            },
          ],
        },
        orderBy: {
          updatedAt: 'desc', // For today, get the most recent past availability, for future use the latest, otherwise ascending for past dates
          // updatedAt: isToday || isFuture ? 'desc' : 'asc',
        },
      }, unavailableDates: true
    },
  });

  // console.log(doctors)

  for (const doctor of doctors) {
    if (!doctor || !doctor.availability || doctor.userId === null || doctor.doctorType === 'Visiting Consultant') {
      continue; // Skip invalid doctors
    }
    // console.log(doctor)
    // ✅ Check if the doctor is unavailable today
    const isUnavailableToday = doctor.unavailableDates.some((unavailableDate) =>
      moment(unavailableDate.date).tz("Asia/Kolkata").format("YYYY-MM-DD") === todayDate
    );
    // console.log(isUnavailableToday)
    if (isUnavailableToday) {
      console.log(`🚫 Dr. ${doctor.name} is unavailable today.`);
      continue; // Skip processing for this doctor
    }


    const allUpdatedAtNull = doctor.availability.every((avail: any) => !avail.updatedAt);
    // console.log(allUpdatedAtNull)

    // Step 2: Calculate the latest timestamp if any `updatedAt` is not null
    let latestTimestamp: string | null = null;
    if (!allUpdatedAtNull) {
      const maxTimestamp = doctor.availability
        .filter((avail: any) => avail.updatedAt) // Filter entries with non-null `updatedAt`
        .map((avail: any) => new Date(avail.updatedAt).getTime()) // Convert to timestamp
        .reduce((max: any, curr: any) => Math.max(max, curr), 0); // Find the max timestamp

      // Convert the max timestamp back to an ISO string
      latestTimestamp = new Date(maxTimestamp).toISOString();
      console.log(latestTimestamp, 'latest')
    }

    const latestAvailability = allUpdatedAtNull
      ? doctor.availability // If all are null, consider all availability as the latest
      : doctor.availability.filter((avail: any) => {
        // console.log("🔍 Checking Availability:", avail.updatedAt, "===", latestTimestamp);
        return new Date(avail.updatedAt).toISOString() === latestTimestamp;
      });

    const today = new Date().toLocaleString('en-us', { weekday: 'short' }).toLowerCase();
    const todayAvailability = latestAvailability.find((avail: any) => avail.day.toLowerCase() === today);

    if (!todayAvailability || !todayAvailability.availableFrom) {
      // console.log('skip')
      continue; // Skip if doctor is not available today
    }
    // ✅ Get first available slot time
    const firstSlot = todayAvailability?.availableFrom.split(',')[0].trim();
    const firstAvailableTime = firstSlot?.split("-")[0].trim();
    console.log(firstAvailableTime, 'first')
    const todayDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD"); // Get today's date

    // Convert 24-hour format (HH:mm) to 12-hour format (hh:mm A)
    const formattedTime = moment(firstAvailableTime, "HH:mm").format("hh:mm A");

    // Construct availableTime in Asia/Kolkata timezone
    const availableTime = moment.tz(`${todayDate} ${formattedTime}`, "YYYY-MM-DD hh:mm A", "Asia/Kolkata");

    // Get current IST time
    const currentTime = moment().tz("Asia/Kolkata");

    // // Compare only the minute-level precision
    // if (currentTime.isSame(availableTime, 'minute')) {
    //   console.log("🔔 Notification Triggered! It's time.");
    // } else {
    //   console.log("⏳ Not yet time for notification.");
    // }

    // const availableTime = moment.tz(`${todayDate} ${firstAvailableTime}`, "YYYY-MM-DD hh:mm A", "Asia/Kolkata");
    console.log(availableTime, doctor.id)

    // ✅ Fetch doctor's appointments
    const appointments = await prisma.appointment.findMany({
      where: { doctorId: doctor.id, date: todayDate, status: "confirmed", checkedIn: true },
    });
    console.log(appointments)

    const user = await prisma.user.findUnique({ where: { id: doctor.userId } });

    // if (user && user.loggedInDate !== todayDate) {
    //   console.log(`✅ Dr. ${doctor.name} is not logged in.`);
    //   continue;
    // }
    // ✅ Check waiting time for first appointment
    if (appointments.length > 0) {
      const pendingAppointments = appointments.filter(
        (appt) => appt.checkedIn === true && appt.checkedOut === false
      );

      const pendingCount = pendingAppointments.length;
      console.log(`🚨 Pending Appointments: ${pendingCount}`);

      // Step 2: Find the ongoing consultation
      const ongoingAppointment = appointments.find(
        (appt) => appt.checkedOut === true && appt.endConsultationTime === null
      );

      if (!ongoingAppointment) {
        console.log("✅ No ongoing consultation.");
        continue;
      }

      // Extract appointment details
      const { checkedOutTime, doctorId, doctorName, patientName } = ongoingAppointment;
      const slotDuration = todayAvailability?.slotDuration ?? 20; // Default slot duration of 15 mins
      if (!checkedOutTime) {
        continue
      }
      // Step 3: Calculate elapsed waiting time
      const checkedOutTimestamp = new Date(checkedOutTime)!.getTime();
      const currentTime = new Date().getTime();
      const elapsedMinutes = Math.floor((currentTime - checkedOutTimestamp) / 60000);
      console.log(`⏳ Elapsed Time for ${patientName}: ${elapsedMinutes} mins`);

      // Step 4: Define alert thresholds
      const firstThreshold = slotDuration + 10; // Alert at slot duration + 10 mins
      const repeatThreshold = 5; // Repeat alerts every 5 mins
      const waitingMultiplier = Math.floor((elapsedMinutes - firstThreshold) / repeatThreshold) + 1;
      console.log(waitingMultiplier)

      const sortedPendingAppointments = pendingAppointments.sort((a, b) => {
        return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
      });

      // Step 6: Select the next patient in line based on time
      const nextAppointment = sortedPendingAppointments.length > 0 ? sortedPendingAppointments[0] : null;

      if (!nextAppointment) {
        console.log("✅ No next appointment found.");
        continue;
      }

      // Step 5: Trigger alert if time exceeds threshold
      if (elapsedMinutes >= firstThreshold && (elapsedMinutes - firstThreshold) % repeatThreshold === 0) {
        console.warn(`⚠️ Alert: ${patientName} under Dr. ${doctorName} has exceeded waiting time by ${elapsedMinutes - slotDuration} mins!`);



        if (nextAppointment) {
          nextAppointment.extraWaitingTime = elapsedMinutes - slotDuration;
          const extraWaitingTime = nextAppointment.extraWaitingTime;


          await prisma.appointment.update({
            where: { id: nextAppointment.id },
            data: { extraWaitingTime: nextAppointment.extraWaitingTime },
          });



          // Step 7: Send WhatsApp notifications to Admins & Doctor
          const adminPhoneNumbers = ['919342287945', '919342287945']; // Admin List
          // const adminPhoneNumbers = ["919880544866", "916364833988"]
          const adminsToSend = Array.isArray(adminPhoneNumbers)
            ? adminPhoneNumbers.slice(0, waitingMultiplier) // Send message to more admins based on waiting multiplier
            : [];


          await waitingTimeMessage(
            adminsToSend,
            doctor.phone_number,
            pendingCount,
            doctorName,
            waitingMultiplier, // Include waiting multiplier in the alert
          )

        }
      }
    }
  }


}
export const scheduleForWaiting = async (req: Request, res: Response) => {
  try {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cloud Scheduler task triggered at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    await checkPatientWaitingTime();

    // Send a response back to Cloud Scheduler
    res.status(200).json({ message: 'Minute task executed successfully', time: currentIST.format('YYYY-MM-DD HH:mm:ss') });
  } catch (error) {
    console.error('Error executing hourly task:', error);
    res.status(500).json({ error: 'An error occurred while executing the hourly task' });
  }
}
// cron.schedule("* * * * *", checkPatientWaitingTime);
function parseTimeToMinutes(time: string): number {
  const [hours, minutesPart] = time.split(':');
  const minutes = parseInt(minutesPart.slice(0, 2), 10); // Extract the numeric minutes
  const isPM = time.toLowerCase().includes('pm');

  let hoursInMinutes = parseInt(hours, 10) * 60;
  if (isPM && parseInt(hours, 10) !== 12) {
    hoursInMinutes += 12 * 60; // Add 12 hours for PM times
  } else if (!isPM && parseInt(hours, 10) === 12) {
    hoursInMinutes -= 12 * 60; // Subtract 12 hours for 12 AM
  }

  return hoursInMinutes + minutes;
}

// Run the function every 5 minutes
// setInterval(checkDoctorAvailability, 300000); // 5 minutes
