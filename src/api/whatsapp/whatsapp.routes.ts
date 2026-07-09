// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  adminDoctorLateLogin, cancelExpiredAppointments, checkAndSendReminders,CornSchedular,doctorAvailability,individualComplete,loginRemainder,markComplete,remainderForAdmin,reminderForServices,scheduleForWaiting,sendAdminMessage,sendDoctorMessage,sendLabReportMessage,sendRadiologyMessage,sendRadioReportMessage,sendServiceWhatsappMessage,sendWhatsAppChatbot,sendWhatsAppFollowUpMessage,sendWhatsAppMessage, timeElevenRemainder, timeNineRemainder, timeThreeRemainder, updateEstimation, waitingTimeMessage } from './whatsapp.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send', sendWhatsAppMessage);
// Cloud Scheduler — removed. Its work (checkAndSendReminders + remainderForAdmin
// + reminderForServices) already runs on the internal hourly cron.
// router.post('/run-hourly-task', CornSchedular);
router.post('/remainder', updateEstimation );
router.post('/send-doctor-message',sendDoctorMessage)
router.post('/send-receive-message',sendWhatsAppChatbot);
router.post('/send-service-message', sendServiceWhatsappMessage)
router.post('/send-radiology-message', sendRadiologyMessage)
router.post('/send-admin-message', sendAdminMessage)
router.post('/send-lab-message', sendLabReportMessage)
router.post('/send-radio-message', sendRadioReportMessage);
router.post('/send-followup-message', sendWhatsAppFollowUpMessage);
// router.post('/send-waiting-message', waitingTimeMessage)
router.post('/send-doctor-remainder', loginRemainder)
router.post('/mark-complete', individualComplete)
router.post('/send-admin-late', adminDoctorLateLogin)
// ===== Cloud Scheduler endpoints — REMOVED. Now handled by internal node-cron
// in whatsapp.controller (hourly cancelExpiredAppointments + checkDoctorAvailability,
// per-minute checkPatientWaitingTime). Commenting so an external scheduler can't
// double-trigger the WhatsApp sends. =====
// router.post('/cancel-appointments', doctorAvailability)
// Cloud Scheduler — removed. Their work already runs on internal cron:
//   sendDoctorMessage → 0 21 * * *   |   markComplete(+Radio) → 0 23 & 50 15 * * *
// router.post('/nine-remainder', timeNineRemainder)
// router.post('/timeEleven-remainder', timeElevenRemainder)
// router.post('/timeThree-remainder', timeThreeRemainder)
// router.post('/one-min',scheduleForWaiting)
// router.post('/doctor-avail', doctorAvailability)

export default router;  // Make sure this line is present
