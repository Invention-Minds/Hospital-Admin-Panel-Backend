import cron from 'node-cron';
import { ServiceRepository } from './services.repository';
import { Request, Response } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const repository = new ServiceRepository();
const scheduledTasks = new Map<number, NodeJS.Timeout>();


export const scheduleServiceCompletion = async (req: Request, res: Response): Promise<void> => {
    try {
      const serviceId = parseInt(req.query.id as string, 10);
      const delayMinutes = parseInt(req.query.delayMinutes as string, 10);
  
      if (isNaN(serviceId) || isNaN(delayMinutes)) {
        res.status(400).json({ message: 'Invalid service ID or delay minutes.' });
        return;
      }
  
      // Stop or clear any existing task for the service
      if (scheduledTasks.has(serviceId)) {
        const scheduledTask = scheduledTasks.get(serviceId);
        if (scheduledTask) {
          clearTimeout(scheduledTask); // Clear the timeout
        }
        scheduledTasks.delete(serviceId); // Remove from the map
      }
  
      // Calculate delay in milliseconds
      const delayMilliseconds = delayMinutes * 60 * 1000;
      console.log(`Scheduling service ${serviceId} for completion in ${delayMinutes} minutes`);
  
      // Set up a one-time delayed task
      const timeout = setTimeout(async () => {
        try {
          // Mark service as completed
          await repository.completeService(serviceId);
          console.log(`Service ${serviceId} marked as completed.`);
          const service = await repository.getServiceById(serviceId);
          if (service) {
            // Send a message to the patient
            const url = process.env.WHATSAPP_API_URL;
            const headers = {
              "Content-Type": "application/json",
              apikey: process.env.WHATSAPP_AUTH_TOKEN,
            };
            const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
  
            const payload = {
              from: fromPhoneNumber, // Sender's WhatsApp number
              to: service.phoneNumber, // Recipient's WhatsApp number
              type: "template", // Type of the message
              message: {
                templateid: "682641", // Replace with the actual template ID
                placeholders: [], // Dynamic placeholders
              },
            };
            try {
              await axios.post(url!, payload, { headers });
              let success = 'true'
              if (success === 'true') {
                const apiKey = process.env.SMS_API_KEY;
                const apiUrl = process.env.SMS_API_URL;
                const sender = process.env.SMS_SENDER;
                let success_message = `Thank you for visiting Rashtrotthana Hospital! We appreciate your trust in us. If you have any queries or need further assistance, feel free to reach out. Wishing you good health!`;
                const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_COMPLETE;
                const urlforComplete = `${apiUrl}/${sender}/${service.phoneNumber}/${encodeURIComponent(success_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
                const responseofcomplete = await axios.get(urlforComplete);
                console.log('SMS sent successfully to patient', responseofcomplete.data);
                await prisma.service.update({
                  where: { id: serviceId },
                  data: { smsSent: true },
                });
              }
              console.log('WhatsApp message(s) sent successfully');
              await prisma.service.update({
                where: { id: serviceId },
                data: { messageSent: true },
              });
            } catch (error) {
              console.error('Failed to send WhatsApp message(s):', (error as any).response ? (error as any).response.data : (error as any).message);
            }
    
          }
        } catch (error) {
          console.error('Error marking service as completed:', error);
        } finally {
          // Cleanup after execution
          scheduledTasks.delete(serviceId);
        }
      }, delayMilliseconds);
  
      // Store the timeout in the scheduledTasks map
      scheduledTasks.set(serviceId, timeout);
  
      res.status(200).json({
        message: `Service completion scheduled for service ID ${serviceId} after ${delayMinutes} minutes.`,
      });
    } catch (error) {
      console.error('Error scheduling service completion:', error);
      res.status(500).json({ message: 'Failed to schedule service completion.', error });
    }
  };
