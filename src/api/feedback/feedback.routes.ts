import express from 'express';
import {
  createSurvey, listSurveys, surveyStats, getSurveyByToken, submitSurveyByToken,
  triggerExpirySweep, triggerReminderSweep, walkUpStartSurvey,
} from './feedback.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

// Public token-based endpoints — patient opens the link on phone/kiosk.
// No JWT; the token in the URL is the auth.
router.get('/surveys/by-token/:token', getSurveyByToken);
router.post('/surveys/by-token/:token/respond', submitSurveyByToken);
// Phase 6 — walk-up kiosk: patient scans a permanent poster QR, enters
// PRN/name, and the server mints a fresh survey on the spot.
router.post('/surveys/walk-up', walkUpStartSurvey);

// Authenticated (staff) endpoints.
router.get('/surveys/stats', authenticateToken, surveyStats);
router.get('/surveys', authenticateToken, listSurveys);
router.post('/surveys', authenticateToken, createSurvey);

// Phase 6d — manual triggers for the expiry + reminder sweeps.
router.post('/surveys/expiry-sweep', authenticateToken, triggerExpirySweep);
router.post('/surveys/reminder-sweep', authenticateToken, triggerReminderSweep);

export default router;
