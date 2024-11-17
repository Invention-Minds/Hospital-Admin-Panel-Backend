// email.routes.ts
import { Router } from 'express';
import { sendEmail, sendMailtoLab } from './email.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

// Route to send email
router.post('/send-email', sendEmail);
router.post('/send-email-lab',sendMailtoLab)

export default router;