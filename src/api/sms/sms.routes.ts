// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  sendSMS, sendSMSChatbot, sendSMSforHealthCheckup, sendSMSforRadiology } from './sms.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send-sms', sendSMS);
router.post('/sms-chatbot',sendSMSChatbot);
router.post('/send-sms-package', sendSMSforHealthCheckup);
router.post('/send-sms-radiology',sendSMSforRadiology)


export default router;  // Make sure this line is present
