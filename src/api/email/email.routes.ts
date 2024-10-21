// email.routes.ts
import { Router } from 'express';
import { sendEmail } from './email.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

// Route to send email
router.post('/send-email',authenticateToken, sendEmail);

export default router;