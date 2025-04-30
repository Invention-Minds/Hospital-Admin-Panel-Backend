import express from 'express';
import { handleWebhook } from './whatsapp-bot.controller';

const router = express.Router();

// URL: /callback/:apiKey/:whatsappNumber
router.post('/:apiKey/:whatsappNumber', handleWebhook);

export default router;
