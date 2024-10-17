// src/whatsapp/whatsapp.routes.ts

import { Router } from 'express';
import { sendWhatsAppMessage } from './whatsapp.controller'; // Ensure this path is correct

const router = Router();

// Define the route for sending WhatsApp messages
router.post('/send', sendWhatsAppMessage);

export default router;  // Make sure this line is present
