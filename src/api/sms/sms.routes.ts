// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  sendOtpSmsNettyfish, sendSMS, sendSMSChatbot, sendSMSforHealthCheckup, sendSMSforRadiology } from './sms.controller'; // Ensure this path is correct
import { rateLimit } from '../../middleware/rate-limit';

const router = Router();

// OTP send stays public (pre-auth login flow) but is rate-limited per IP+phone
// to stop SMS flooding/abuse. Counts every request, not just failures.
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, mode: 'all' });

// Define the route for sending WhatsApp messages
router.post('/send-sms', sendSMS);
router.post('/sms-chatbot',sendSMSChatbot);
router.post('/send-sms-package', sendSMSforHealthCheckup);
router.post('/send-sms-radiology',sendSMSforRadiology);
router.post('/send-otp-vasavi', otpLimiter, sendOtpSmsNettyfish )


export default router;  // Make sure this line is present
