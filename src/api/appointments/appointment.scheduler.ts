import cron from 'node-cron';
import AppointmentRepository from './appointment.repository';
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.controller';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const repository = new AppointmentRepository();
const scheduledTasks = new Map<number, cron.ScheduledTask>();

export function scheduleAppointmentCompletionJob(appointmentId: number, delayMinutes: number): void {
  // Stop the existing task for the appointment if there's any
  if (scheduledTasks.has(appointmentId)) {
    scheduledTasks.get(appointmentId)?.stop();
  }

  const cronExpression = `*/${delayMinutes} * * * *`;
  const task = cron.schedule(cronExpression, async () => {
    try {
      await repository.completeAppointment(appointmentId);
      const appointment = await repository.getAppointmentById(appointmentId);
      if(appointment){
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
            "templateinfo": `1489098`,
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
        } catch (error) {
          console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
        }
      
      }
      console.log(`Appointment ${appointmentId} marked as completed.`);
      task.stop();
      scheduledTasks.delete(appointmentId);
    } catch (error) {
      console.error('Error marking appointment as completed:', error);
    }
  });

  scheduledTasks.set(appointmentId, task);
}

