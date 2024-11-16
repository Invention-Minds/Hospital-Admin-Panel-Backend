// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import {  sendSMS } from './sms.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send-sms', sendSMS);


export default router;  // Make sure this line is present
