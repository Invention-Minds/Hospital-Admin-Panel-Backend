

import { Request, Response } from 'express';

import { notifyPendingAppointments } from './../appointments/appointment.controller';
import axios from 'axios';
import https from 'https';
import { parse, isAfter, isBefore, subHours, setMinutes, setSeconds } from 'date-fns';
import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
import { start } from 'repl';

// import { utcToZonedTime, format } from 'date-fns-tz';
dotenv.config();
const prisma = new PrismaClient();
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

export const sendWhatsAppMessage = async (req: Request, res: Response) => {
  console.log('req.body:', req.body);
  const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status } = req.body;
  console.log(patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status);

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
        placeholders: [doctorName, status, patientName, date, time], // Dynamic placeholders
      },
    }
    let patientPayload = {
      from: fromPhoneNumber,
      to: patientPhoneNumber,
      type: "template",
      message: {
        templateid: "674445", // Replace with the actual template ID
        placeholders: [patientName, doctorName, status, date, time], // Dynamic placeholders
      },
    };
    const patientResponse = await axios.post(url!, patientPayload, { headers });
    res.status(200).json({ message: 'WhatsApp message(s) sent successfully', response: patientResponse.data });
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
            placeholders: [appointment.patientName, appointment.doctorName, appointment.date, appointment.time], // Dynamic placeholders
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
            let success_message = `Namaste ${appointment.patientName}, This is a kind reminder of your upcoming appointment with ${appointment.doctorName} is scheduled for tomorrow, ${appointment.date} at ${appointment.time}. Thank you. Regards, Team Rashtrotthana`;
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
            placeholders: [appointment.patientName, appointment.doctorName, appointment.date, appointment.time], // Dynamic placeholders
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
            let success_message = `Namaste ${appointment.patientName}, This is a gentle reminder of your upcoming appointment with ${appointment.doctorName} is scheduled for today, ${appointment.date} at ${appointment.time}. Please note: 1. Kindly arrive at least 10 minutes prior to complete the billing process. 2. Appointments are attended on a first-come, first-served basis. 3. Delays may occur if the doctor is handling an emergency. Thank you for your cooperation. Regards, Team Rashtrotthana`;
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
    const tomorrow = indianTime.clone().add(1, 'day').format('YYYY-MM-DD');

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
cron.schedule('0 21 * * *', async () => {
  console.log('Running scheduled task to send doctor appointment reminders');
  await sendDoctorMessage();
}, {
  timezone: 'Asia/Kolkata',
});



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
          title: 'Remainder for Pending Request',
          message: `${pendingRequests.length} appointment requests are pending. Kindly check`,
          entityType: 'remainder',
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
        status: 'confirmed',
        time: {

          lt: formatTime(endHour),    // Less than start of the current hour
        },
      },
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
          title: 'Remainder',
          message: `${pendingAppointments.length} appointments require action. Please mark them as complete or cancel`,
          entityType: 'remainder',
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
        appointmentStatus: {
          in: ['Confirm', 'confirmed'], // Matches either 'Confirm' or 'confirmed'
        },
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
          placeholders: [name, packageName, appointmentStatus, appointmentDate, appointmentTime], // Placeholders for the template
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
          placeholders: [name, packageName, appointmentDate], // Placeholders for the template
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
    const { doctorName, startDate, endDate, adminPhoneNumber } = req.body;
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const url = process.env.WHATSAPP_API_URL;
    const payload = {
      from: fromPhoneNumber, // Sender's WhatsApp number
      to: adminPhoneNumber, // Recipient's WhatsApp number
      type: "template", // Type of the message
      message: {
        templateid: "701223", // Replace with the actual template ID
        placeholders: [doctorName, startDate, endDate], // Dynamic placeholders
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

export const markComplete = async (req: Request, res: Response) => {
  try {
    // Get current Indian time
    const indianTime = moment().tz('Asia/Kolkata');
    const indianDate = indianTime.format('YYYY-MM-DD'); // Format as YYYY-MM-DD

    // Find appointments for today where `checkedOut` is true
    const checkedOutAppointments = await prisma.appointment.findMany({
      where: {
        date: indianDate, // Appointments for today
        checkedOut: true, // Only checked out appointments
      },
    });

    if (checkedOutAppointments.length === 0) {
      console.log('No appointments found for today with checkedOut: true');
       res.status(200).json({ message: 'No appointments to process' });
       return;
    }

    // Update the status of these appointments to "Complete"
    await Promise.all(
      checkedOutAppointments.map(async (appointment) => {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { status: 'completed' },
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