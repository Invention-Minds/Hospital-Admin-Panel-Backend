

import { Request, Response } from 'express';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
import { start } from 'repl';

// import { utcToZonedTime, format } from 'date-fns-tz';
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
            "templateinfo": `1498900~${patientName}~${doctorName}~${status}~${date}~${time}`,
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
            "templateinfo": `1495968~${patientName}~${doctorName}`,
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
            "templateinfo": `1498899~${doctorName}~${status}~${patientName}~${date}~${time}`,
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
                    "to": patientPhoneNumber,
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
                        "templateinfo": `1489537~${appointment.patientName}~${appointment.doctorName}~${appointment.date}~${appointment.time}`,
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
                        "templateinfo": `1489438~${appointment.patientName}~${appointment.doctorName}~${appointment.date}~${appointment.time}`,
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

cron.schedule('0 * * * *', () => {
    // Get the current time in Indian Standard Time (IST)
    const currentIST = moment().tz('Asia/Kolkata');

    // Log the current IST time
    console.log(`Cron job started at (IST): ${currentIST.format('YYYY-MM-DD HH:mm:ss')}`);

    // Use the IST time in your logic
    checkAndSendReminders(); // Modify the function to accept the current IST if necessary
});

export const sendAppointmentReminders = async (req: Request, res: Response) => {
    res.status(200).json({ message: 'Reminder job is running in the background' });
};

export const sendWhatsAppChatbot = async (req: Request, res: Response) => {
    try {
        const { patientName, service, patientPhoneNumber } = req.body;
        const url = process.env.WHATSAPP_API_URL;
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.WHATSAPP_AUTH_TOKEN}` // Replace with your actual token
        };
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        const messages = [];
        messages.push({
            "coding": "1",
            "id": "15b0cc79c0da45771662021",
            "msgtype": "1",
            "text": "",
            "templateinfo": `1490445~${patientName}~${service}`,
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
                const message = `Namaste Dr. ${doctorName}, you have ${appointmentCount} appointment(s) scheduled for tomorrow, ${tomorrow}. Please check your schedule for more details.`;

                const url = process.env.WHATSAPP_API_URL;
                const headers = {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.WHATSAPP_AUTH_TOKEN}`,
                };
                const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
                console.log('message:', message);

                const messages = [
                    // Message for Patient
                    {
                        "coding": "1",
                        "id": "15b0cc79c0da45771662021",
                        "msgtype": "1",
                        "text": "",
                        "templateinfo": `1495858~${doctorName}~${appointmentCount}~${tomorrow}`,
                        "addresses": [
                            {
                                "to": doctorPhoneNumber,
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