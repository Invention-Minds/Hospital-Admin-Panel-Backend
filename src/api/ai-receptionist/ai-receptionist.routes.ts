import express, { Request, Response, NextFunction } from 'express';
import {
  getDepartments,
  getDoctors,
  getDoctorDates,
  getDoctorSlots,
  getPatientsByPhone,
  requestAppointment,
  postEnquiry,
  postEscalation,
} from './ai-receptionist.controller';
import { verifyWebhookSecret } from '../../middleware/webhook-secret';
import { rateLimit } from '../../middleware/rate-limit';

const router = express.Router();

/**
 * MACHINE-TO-MACHINE — AI receptionist agent only. Caller sends
 * `X-Webhook-Secret: <AI_RECEPTIONIST_SECRET>`. Unlike other webhooks this module
 * refuses to run without the secret, since it exposes patient lookup.
 */
const requireSecretConfigured = (_req: Request, res: Response, next: NextFunction): void => {
  if (!process.env.AI_RECEPTIONIST_SECRET) {
    res.status(503).json({ message: 'AI receptionist is not configured' });
    return;
  }
  next();
};

router.use(
  requireSecretConfigured,
  verifyWebhookSecret('AI_RECEPTIONIST_SECRET'),
  rateLimit({ windowMs: 60 * 1000, max: 300, mode: 'all', keyGenerator: () => 'ai-receptionist' }),
);

router.get('/departments', getDepartments);
router.get('/doctors', getDoctors);
router.get('/doctors/:id/dates', getDoctorDates);
router.get('/doctors/:id/slots', getDoctorSlots);
router.get('/patients/by-phone/:phone', getPatientsByPhone);
router.post('/appointments', requestAppointment);
router.post('/enquiries', postEnquiry);
router.post('/escalations', postEscalation);

export default router;
