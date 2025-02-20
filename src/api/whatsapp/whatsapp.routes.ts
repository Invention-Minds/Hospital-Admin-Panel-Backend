// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  adminDoctorLateLogin, checkAndSendReminders,CornSchedular,individualComplete,loginRemainder,markComplete,remainderForAdmin,reminderForServices,sendAdminMessage,sendDoctorMessage,sendServiceWhatsappMessage,sendWhatsAppChatbot,sendWhatsAppMessage, updateEstimation, waitingTimeMessage } from './whatsapp.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send', sendWhatsAppMessage);
router.post('/run-hourly-task', CornSchedular);
router.post('/remainder', updateEstimation );
router.post('/send-doctor-message',sendDoctorMessage)
router.post('/send-receive-message',sendWhatsAppChatbot);
router.post('/send-service-message', sendServiceWhatsappMessage)
router.post('/send-admin-message', sendAdminMessage)
router.post('/send-waiting-message', waitingTimeMessage)
router.post('/send-doctor-remainder', loginRemainder)
router.post('/mark-complete', individualComplete)
router.post('/send-admin-late', adminDoctorLateLogin)

export default router;  // Make sure this line is present
