// email.routes.ts
import { Router } from 'express';
import { sendEmail, sendMailtoLab } from './email.controller';
import { authenticateToken } from '../../middleware/middleware';
import multer from 'multer';

const router = Router();

// Route to send email
router.post('/send-email', sendEmail);
// router.post('/send-email-lab',sendMailtoLab)


const upload = multer({ dest: 'uploads/' }); // or use a different configuration based on your needs

router.post('/send-email-lab', upload.single('file'), sendMailtoLab);

export default router;