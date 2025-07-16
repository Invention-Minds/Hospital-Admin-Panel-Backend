// email.routes.ts
import { Router } from 'express';
import { sendEmail, sendEmailForApprover, sendHealthCheckupConfirmationEmail, sendMailtoLab, sendServiceEmail } from './email.controller';
import { authenticateToken } from '../../middleware/middleware';
import multer from 'multer';

const router = Router();

// Route to send email
router.post('/send-email', sendEmail);
router.post('/send-email-service', sendHealthCheckupConfirmationEmail);
router.post('/send-website-email', sendServiceEmail); // This seems to be a duplicate, consider removing or renaming for clarity
// router.post('/send-email-lab',sendMailtoLab)


const upload = multer({ dest: 'uploads/' }); // or use a different configuration based on your needs

router.post('/send-email-lab', upload.single('file'), sendMailtoLab);
router.post('/send-approver-email', sendEmailForApprover)

export default router;