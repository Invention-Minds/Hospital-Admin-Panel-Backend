// // src/whatsapp/whatsapp.controller.ts

// import { Request, Response } from 'express';
// import axios from 'axios';

// export const sendWhatsAppMessage = async (req: Request, res: Response) => {
//     const { patientName, doctorName, time, date, phoneNumber,status } = req.body;
//     console.log(patientName, doctorName, time, date, phoneNumber,status);

//     const url = "https://103.229.250.150/unified/v2/send?=null";
//     const headers = {
//         "Content-Type": "application/json",
//         "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJJbmZpbml0byIsImlhdCI6MTcyODk3ODAxOSwic3ViIjoiUmFzaHRyb3R0aGFuYWFwaXJzbGN1bXl5In0.nyimuGTcfskkFLaE87hNtZ75tjEaFktsSNBPblKG5k4" // Replace with your actual token
//     };

//     const data = {
//         "apiver": "1.0",
//         "whatsapp": {
//           "ver": "2.0",
//           "dlr": {
//             "url": ""
//           },
//           "messages": [
//             {
//               "coding": "1",
//               "id": "15b0cc79c0da45771662021",
//               "msgtype": "1",
//               "text": "",
//               "templateinfo": `1480342~${patientName}~${doctorName}~${status}~${date}~${time}`,
//               "type": "",
//               "contenttype":"",
//               "filename": "",
//                 "mediadata": "",
//               "b_urlinfo": "",              
//               "addresses": [
//                 {
//                   "seq": "6310710c80900d37f7b9-20220901",
//                   "to": phoneNumber,
//                   "from": "918050110333",
//                   "tag": ""
//                 }
//               ]
//             }
//           ]
//         }
//       };

//     try {
//         const response = await axios.post(url, data, { headers });
//         res.status(200).json({ message: 'WhatsApp message sent successfully', response: response.data });
//     } catch (error) {
//         res.status(500).json({
//             error: 'Failed to send WhatsApp message',
//             details: (error as any).response ? (error as any).response.data : (error as any).message
//         });
//     }
//     // res.status(200).json({ message: 'WhatsApp API function is working without sending a message' });
// };
// src/whatsapp/whatsapp.controller.ts

import { Request, Response } from 'express';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
dotenv.config();
const prisma = new PrismaClient();

export const sendWhatsAppMessage = async (req: Request, res: Response) => {
    console.log('req.body:', req.body);
    const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status } = req.body;
    console.log(patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status);

    const url = process.env.WHATSAPP_API_URL;
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.WHATSAPP_AUTH_TOKEN}` // Replace with your actual token
    };
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
    const messages = [];

    // Message for Patient (regardless of the status)
    if (status !== 'received') {
        messages.push({
            "coding": "1",
            "id": "15b0cc79c0da45771662021",
            "msgtype": "1",
            "text": "",
            "templateinfo": `1489096~${patientName}~${doctorName}~${status}~${date}~${time}`,
            "type": "",
            "contenttype": "",
            "filename": "",
            "mediadata": "",
            "b_urlinfo": "",
            "addresses": [
                {
                    "seq": "6310710c80900d37f7b9-20220901",
                    "to": patientPhoneNumber,
                    "from": fromPhoneNumber,
                    "tag": ""
                }
            ]
        });
    }
    if (status === 'received') {
        messages.push({
            "coding": "1",
            "id": "15b0cc79c0da45771662022",
            "msgtype": "1",
            "text": "",
            "templateinfo": `1484424~${patientName}~${doctorName}`,
            "type": "",
            "contenttype": "",
            "filename": "",
            "mediadata": "",
            "b_urlinfo": "",
            "addresses": [
                {
                    "seq": "6310710c80900d37f7b9-20220902",
                    "to": patientPhoneNumber,
                    "from": fromPhoneNumber,
                    "tag": ""
                }
            ]
        });
    }
    // Message for Doctor (only if the status is 'confirmed')
    if (status === 'confirmed' || status === 'cancelled' || status === 'rescheduled') {
        messages.push({
            "coding": "1",
            "id": "15b0cc79c0da45771662022",
            "msgtype": "1",
            "text": "",
            "templateinfo": `1489095~${doctorName}~${status}~${patientName}~${date}~${time}`,
            "type": "",
            "contenttype": "",
            "filename": "",
            "mediadata": "",
            "b_urlinfo": "",
            "addresses": [
                {
                    "seq": "6310710c80900d37f7b9-20220902",
                    "to": doctorPhoneNumber,
                    "from": fromPhoneNumber,
                    "tag": ""
                }
            ]
        });
    }
    if (status === 'completed') {
        messages.push({
            "coding": "1",
            "id": "15b0cc79c0da45771662022",
            "msgtype": "1",
            "text": "",
            "templateinfo": `1489098`,
            "type": "",
            "contenttype": "",
            "filename": "",
            "mediadata": "",
            "b_urlinfo": "",
            "addresses": [
                {
                    "seq": "6310710c80900d37f7b9-20220902",
                    "to": doctorPhoneNumber,
                    "from": fromPhoneNumber,
                    "tag": ""
                }
            ]
        });
    }

    const data = {
        "apiver": "1.0",
        "whatsapp": {
            "ver": "2.0",
            "dlr": {
                "url": ""
            },
            "messages": messages
        }
    };

    try {
        const response = await axios.post(url!, data, { headers });
        res.status(200).json({ message: 'WhatsApp message(s) sent successfully', response: response.data });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to send WhatsApp message(s)',
            details: (error as any).response ? (error as any).response.data : (error as any).message
        });
    }
};
// Function to check appointments and send reminders
export const checkAndSendReminders = async () => {
    try {
        // Find appointments for tomorrow (1 day before)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1); // Add 1 day to today's date
        const tomorrowDateString = tomorrow.toLocaleDateString('en-CA'); // Convert to YYYY-MM-DD format
        console.log(tomorrowDateString);


        const today = new Date();
        const todayDateString = today.toLocaleDateString('en-CA');
        console.log(todayDateString);

        const appointmentsTomorrow = await prisma.appointment.findMany({
            where: {
                date: tomorrowDateString,
                remainder1Sent: false
            }
        });

        // Send reminder for tomorrow's appointments
        appointmentsTomorrow.forEach(async (appointment) => {
            if (appointment.date == tomorrowDateString) {
                // Send a message to the patient
                const url = process.env.WHATSAPP_API_URL;
                const headers = {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.WHATSAPP_AUTH_TOKEN}`
                };
                const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

                const messages = [
                    // Message for Patient
                    {
                        "coding": "1",
                        "id": "15b0cc79c0da45771662021",
                        "msgtype": "1",
                        "text": "",
                        "templateinfo": `1489351~${appointment.patientName}~${appointment.doctorName}~${appointment.date}~${appointment.time}`,
                        "addresses": [
                            {
                                "to": appointment.phoneNumber,
                                "from": fromPhoneNumber,
                            }
                        ]
                    },
                    // Message for Doctor
                ];

                const data = {
                    "apiver": "1.0",
                    "whatsapp": {
                        "ver": "2.0",
                        "dlr": {
                            "url": ""
                        },
                        "messages": messages
                    }
                };

                try {
                    await axios.post(url!, data, { headers });
                    await prisma.appointment.update({
                        where: { id: appointment.id },
                        data: { remainder1Sent: true }
                    });
                    console.log('WhatsApp message(s) sent successfully');
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
            //     'Reminder: Tomorrow, you have an appointment'
            // );
           
            console.log(`Reminder sent for tomorrow's appointment: ${appointment.patientName}`);
        });

        // Find appointments for today, 4 hours before
        // const now = new Date();
        // // const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000); // Add 4 hours to the current time
        // // const fourHoursLaterTimeString = fourHoursLater.toISOString().split('T')[1].split('.')[0]; // Convert to HH:MM:SS format

        // console.log('Current time (local):', now);

        // // Add 4 hours to the current time
        // const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000); // Add 4 hours (in milliseconds)
        // console.log('4 hours later (local):', fourHoursLater);

        // // Extract time in 24-hour format (HH:mm) in local time zone
        // const fourHoursTimeString = fourHoursLater.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        // console.log('4 hours time string (local, 24-hour format):', fourHoursTimeString);
        const now = new Date();  // Get the current time
        console.log('Current time (local):', now);
        
        // Add 4 hours to the current time
        const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000); // Add 4 hours
        const fourHoursTimeString = fourHoursLater.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        console.log('4 hours later (local):', fourHoursLater);
        console.log('4 hours time string (local, 24-hour format):', fourHoursTimeString);
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
                remainder2Sent: false // To avoid re-sending reminders
            }
        });

        console.log(appointmentsToday, 'appointmentsToday');

        // Send reminder for today, 4 hours before the appointment
        appointmentsToday.forEach(async (appointment) => {
            const [startTime, endTime] = appointment.time.split('-');  // Extract start time
            const reminderTime = calculateReminderTime(startTime);  // Calculate 4 hours before the start time
            console.log('Start time:', startTime);
            console.log('Reminder time:', reminderTime);

            if (startTime === fourHoursTimeString) {
                console.log('Sending reminder for 4 hours before appointment:', appointment.patientName);
                // Send a message to the patient
                const url = process.env.WHATSAPP_API_URL;
                const headers = {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.WHATSAPP_AUTH_TOKEN}`
                };
                const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

                const messages = [
                    // Message for Patient
                    {
                        "coding": "1",
                        "id": "15b0cc79c0da45771662021",
                        "msgtype": "1",
                        "text": "",
                        "templateinfo": `1489350~${appointment.patientName}~${appointment.doctorName}~${appointment.date}~${appointment.time}`,
                        "addresses": [
                            {
                                "to": appointment.phoneNumber,
                                "from": fromPhoneNumber,
                            }
                        ]
                    },
                    // Message for Doctor
                ];

                const data = {
                    "apiver": "1.0",
                    "whatsapp": {
                        "ver": "2.0",
                        "dlr": {
                            "url": ""
                        },
                        "messages": messages
                    }
                };

                try {
                    await axios.post(url!, data, { headers });
                    console.log('WhatsApp message(s) sent successfully');
                    await prisma.appointment.update({
                        where: { id: appointment.id },
                        data: { remainder2Sent: true }
                    });
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
            console.log(`Reminder sent for 4 hours before appointment: ${appointment.patientName}`);
        });

    } catch (error) {
        console.error('Error checking and sending reminders:', error);
    }
};

// Set up cron job to check and send reminders every minute
cron.schedule('*/1 * * * *', checkAndSendReminders); // Every minute

export const sendAppointmentReminders = async (req: Request, res: Response) => {
    res.status(200).json({ message: 'Reminder job is running in the background' });
};