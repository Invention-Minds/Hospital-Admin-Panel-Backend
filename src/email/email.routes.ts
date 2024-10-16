// email.routes.ts
import { Router } from 'express';
import { sendEmail } from './email.controller';

const router = Router();

// Route to send email
router.post('/send-email', sendEmail);

export default router;