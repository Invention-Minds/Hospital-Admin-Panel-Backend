// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  adminDoctorLateLogin, cancelExpiredAppointments, checkAndSendReminders,CornSchedular,doctorAvailability,individualComplete,loginRemainder,markComplete,remainderForAdmin,reminderForServices,scheduleForWaiting,sendAdminMessage,sendDoctorMessage,sendRadiologyMessage,sendServiceWhatsappMessage,sendWhatsAppChatbot,sendWhatsAppMessage, timeElevenRemainder, timeNineRemainder, timeThreeRemainder, updateEstimation, waitingTimeMessage } from './whatsapp.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send', sendWhatsAppMessage);
router.post('/run-hourly-task', CornSchedular);
router.post('/remainder', updateEstimation );
router.post('/send-doctor-message',sendDoctorMessage)
router.post('/send-receive-message',sendWhatsAppChatbot);
router.post('/send-service-message', sendServiceWhatsappMessage)
router.post('/send-radiology-message', sendRadiologyMessage)
router.post('/send-admin-message', sendAdminMessage)
// router.post('/send-waiting-message', waitingTimeMessage)
router.post('/send-doctor-remainder', loginRemainder)
router.post('/mark-complete', individualComplete)
router.post('/send-admin-late', adminDoctorLateLogin)
router.post('/cancel-appointments', doctorAvailability)
router.post('/nine-remainder', timeNineRemainder)
router.post('/timeEleven-remainder', timeElevenRemainder)
router.post('/timeThree-remainder', timeThreeRemainder)
router.post('/one-min',scheduleForWaiting)
// router.post('/doctor-avail', doctorAvailability)

export default router;  // Make sure this line is present
