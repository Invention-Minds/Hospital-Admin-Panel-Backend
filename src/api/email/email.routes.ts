// email.routes.ts
import { Router } from 'express';
import { sendEmail, sendEmailForApprover, sendHealthCheckupConfirmationEmail, sendMailtoLab, sendPackageMail, sendServiceEmail, conditionalEmail,
     verifyRecaptcha, verifyCaptcha, 
     sendEmailOtp} from './email.controller';
import { authenticateToken } from '../../middleware/middleware';
import multer from 'multer';
import { verify } from 'crypto';

const router = Router();

// Route to send email
router.post('/send-email', sendEmail);
router.post('/send-email-service', sendHealthCheckupConfirmationEmail);
router.post('/send-package-email', sendPackageMail);
router.post('/send-website-email', sendServiceEmail); // This seems to be a duplicate, consider removing or renaming for clarity
// router.post('/send-email-lab',sendMailtoLab)

router.post('/verify', verifyRecaptcha);
router.post('/captcha/verify', verifyCaptcha);

router.post('/send-pages-email', conditionalEmail);


const upload = multer({ dest: 'uploads/' }); // or use a different configuration based on your needs

router.post('/send-email-lab', upload.single('file'), sendMailtoLab);
router.post('/send-approver-email', sendEmailForApprover);
router.post('/send-email-otp', sendEmailOtp);


export default router;