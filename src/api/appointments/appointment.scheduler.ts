import cron from 'node-cron';
import AppointmentRepository from './appointment.repository';
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.controller';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();




// export function scheduleAppointmentCompletionJob(appointmentId: number, delayMinutes: number): void {
//   // Stop the existing task for the appointment if there's any
//   // if (scheduledTasks.has(appointmentId)) {
//   //   scheduledTasks.get(appointmentId)?.stop();
//   // }

//   // const cronExpression = `*/${delayMinutes} * * * *`;
//   // const task = cron.schedule(cronExpression, async () => {
//   //   try {
//   //     await repository.completeAppointment(appointmentId);
//   //     const appointment = await repository.getAppointmentById(appointmentId);
//   //     if(appointment){
//   //       // Send a message to the patient
//   //       const url = process.env.WHATSAPP_API_URL;
//   //       const headers = {
//   //         "Content-Type": "application/json",
//   //         "Authorization": `Bearer ${process.env.WHATSAPP_AUTH_TOKEN}`
//   //       };
//   //       const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

//   //       const messages = [
//   //         // Message for Patient
//   //         {
//   //           "coding": "1",
//   //           "id": "15b0cc79c0da45771662021",
//   //           "msgtype": "1",
//   //           "text": "",
//   //           "templateinfo": `1489098`,
//   //           "addresses": [
//   //             {
//   //               "to": appointment.phoneNumber,
//   //               "from": fromPhoneNumber,
//   //             }
//   //           ]
//   //         },
//   //         // Message for Doctor
//   //       ];

//   //       const data = {
//   //         "apiver": "1.0",
//   //         "whatsapp": {
//   //           "ver": "2.0",
//   //           "dlr": {
//   //             "url": ""
//   //           },
//   //           "messages": messages
//   //         }
//   //       };

//   //       try {
//   //         await axios.post(url!, data, { headers });
//   //         console.log('WhatsApp message(s) sent successfully');
//   //       } catch (error) {
//   //         console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
//   //       }

//   //     }
//   //     console.log(`Appointment ${appointmentId} marked as completed.`);
//   //     task.stop();
//   //     scheduledTasks.delete(appointmentId);
//   //   } catch (error) {
//   //     console.error('Error marking appointment as completed:', error);
//   //   }
//   // });


// }


const repository = new AppointmentRepository();
const scheduledTasks = new Map<number, cron.ScheduledTask | NodeJS.Timeout>();
// Type guard function to check if an object is a cron.ScheduledTask
function isCronTask(task: any): task is cron.ScheduledTask {
  return task && typeof task.stop === 'function';
}

export function scheduleAppointmentCompletionJob(appointmentId: number, delayMinutes: number): void {
  // Stop or clear the existing task for the appointment if there's any
  if (scheduledTasks.has(appointmentId)) {
    const scheduledTask = scheduledTasks.get(appointmentId);

    if (scheduledTask) {
      if (isCronTask(scheduledTask)) {
        scheduledTask.stop(); // Stop the cron job if it is a cron task
      } else {
        clearTimeout(scheduledTask); // Clear the timeout if it is a timeout
      }
    }

    scheduledTasks.delete(appointmentId); // Remove the task from the map after stopping
  }

  // Calculate the delay in milliseconds
  const delayMilliseconds = delayMinutes * 60 * 1000;
  console.log(`Scheduling appointment ${appointmentId} for completion in ${delayMinutes} minutes`);

  // Set up a one-time delayed appointment completion
  const timeout = setTimeout(async () => {
    try {
      // Mark appointment as completed
      await repository.completeAppointment(appointmentId);
      console.log(`Appointment ${appointmentId} marked as completed.`);

      // Retrieve appointment details to send WhatsApp message
      const appointment = await repository.getAppointmentById(appointmentId);
      if (appointment) {
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
          let success = 'true'
          if (success === 'true') {
            const apiKey = process.env.SMS_API_KEY;
            const apiUrl = process.env.SMS_API_URL;
            const sender = process.env.SMS_SENDER;
            let success_message = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. If you have any queries or need further assistance, feel free to reach out. Wishing you good health!`;
            const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_COMPLETE;
            const urlforComplete = `${apiUrl}/${sender}/${appointment.phoneNumber}/${encodeURIComponent(success_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
            const responseofcomplete = await axios.get(urlforComplete);
            console.log('SMS sent successfully to patient', responseofcomplete.data);
          }
          console.log('WhatsApp message(s) sent successfully');
        } catch (error) {
          console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
        }

      }
      // Cleanup after completion
      scheduledTasks.delete(appointmentId);
    } catch (error) {
      console.error("Error marking appointment as completed:", error);
    }
  }, delayMinutes);

  // Store the timeout in the scheduledTasks map
  scheduledTasks.set(appointmentId, timeout);
}



