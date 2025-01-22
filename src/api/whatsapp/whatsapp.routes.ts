// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  checkAndSendReminders,CornSchedular,remainderForAdmin,reminderForServices,sendAdminMessage,sendDoctorMessage,sendServiceWhatsappMessage,sendWhatsAppChatbot,sendWhatsAppMessage } from './whatsapp.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send', sendWhatsAppMessage);
router.post('/run-hourly-task', CornSchedular);
router.post('/remainder', checkAndSendReminders );
router.post('/send-doctor-message',sendDoctorMessage)
router.post('/send-receive-message',sendWhatsAppChatbot);
router.post('/send-service-message', sendServiceWhatsappMessage)
router.post('/send-admin-message', sendAdminMessage)

export default router;  // Make sure this line is present
