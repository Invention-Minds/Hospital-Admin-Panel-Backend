import express from 'express';
import {
  createSurvey, listSurveys, surveyStats, getSurveyByToken, submitSurveyByToken,
  triggerExpirySweep, triggerReminderSweep, requestWalkUpOtp, verifyWalkUpOtp,
} from './feedback.controller';
import { authenticateToken } from '../../middleware/middleware';
import { rateLimit } from '../../middleware/rate-limit';
import {
  requireComplaintHandler, requireFeedbackCollector, requireFeedbackViewer,
} from '../_shared/quality-roles';

const router = express.Router();

// Per-IP cap on the unauthenticated POSTs. Keyed on req.ip (trust proxy is
// set), not the raw X-Forwarded-For header.
const publicPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  mode: 'all',
  keyGenerator: (req) => `feedback-public|${req.ip || req.socket?.remoteAddress || 'unknown'}`,
  message: 'Too many requests. Please try again in a few minutes.',
});

// Public token-based endpoints — patient opens the link on phone/kiosk.
// No JWT; the token in the URL is the auth.
router.get('/surveys/by-token/:token', getSurveyByToken);
router.post('/surveys/by-token/:token/respond', publicPostLimiter, submitSurveyByToken);
// Walk-up kiosk: patient scans a permanent poster QR, enters their PRN and
// verifies an SMS OTP; only then is a survey minted.
router.post('/surveys/walk-up/request-otp', publicPostLimiter, requestWalkUpOtp);
router.post('/surveys/walk-up/verify', publicPostLimiter, verifyWalkUpOtp);

// Authenticated (staff) endpoints.
router.get('/surveys/stats', authenticateToken, requireFeedbackViewer, surveyStats);
router.get('/surveys', authenticateToken, requireComplaintHandler, listSurveys);
router.post('/surveys', authenticateToken, requireFeedbackCollector, createSurvey);

// Phase 6d — manual triggers for the expiry + reminder sweeps.
router.post('/surveys/expiry-sweep', authenticateToken, requireComplaintHandler, triggerExpirySweep);
router.post('/surveys/reminder-sweep', authenticateToken, requireComplaintHandler, triggerReminderSweep);

export default router;
