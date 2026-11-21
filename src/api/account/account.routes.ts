import { Router } from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { rateLimit } from '../../middleware/rate-limit';
import { listMyAlerts, markMyAlertsRead } from './account-alerts.controller';
import { changeMyPassword, forgotFinish, forgotStart, getMe, sendEmailChangeCode, verifyEmailChange } from './account.controller';

// The signed-in user's own account. Mounted at /api/account.
const router = Router();

// Wrong current passwords / codes count against the caller (same policy as the login steps).
const guarded = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, mode: 'failures' });
// Forgot-password start always succeeds, so cap every call, not just failures.
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, mode: 'all' });

router.get('/me', authenticateToken, getMe);
router.post('/email/send', authenticateToken, guarded, sendEmailChangeCode);
router.post('/email/verify', authenticateToken, guarded, verifyEmailChange);
router.post('/password', authenticateToken, guarded, changeMyPassword);
router.post('/forgot/start', forgotLimiter, forgotStart);
router.post('/forgot/finish', guarded, forgotFinish);
// The app's Alerts screen — only the caller's own alerts.
router.get('/alerts', authenticateToken, listMyAlerts);
router.post('/alerts/read', authenticateToken, markMyAlertsRead);

export default router;
