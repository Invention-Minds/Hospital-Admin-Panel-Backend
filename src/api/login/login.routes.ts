import { Router } from 'express';
import { userLogin, userRegister, userResetPassword, userChangePassword, getUserDetails, deleteUserByUsername, getAllUsers, toggleUserActive, mobileRefresh, setUserDepartment, challengeMfa, challengeEmailSend, challengeEmailVerify, challengePassword } from './login.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import { rateLimit } from '../../middleware/rate-limit';
const router = Router();

// Brute-force / credential-stuffing protection: block an IP+username after
// repeated failed logins. Counts only 401/403 responses; success clears it.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, mode: 'failures' });

// User management is admin-only (super_admin always allowed by requireRole).
// Sub-admins (nurses, front desk, …) have no user-management tabs in Settings.
const adminOnly = requireRole({ roles: ['admin'] });

router.post('/login', loginLimiter, userLogin);
// Post-password security steps; each takes the challengeToken from /login.
const challengeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, mode: 'failures' });
router.post('/challenge/mfa', challengeLimiter, challengeMfa);
router.post('/challenge/email/send', challengeLimiter, challengeEmailSend);
router.post('/challenge/email/verify', challengeLimiter, challengeEmailVerify);
router.post('/challenge/password', challengeLimiter, challengePassword);
router.post('/mobile/refresh', mobileRefresh);
router.post('/register', authenticateToken, adminOnly, userRegister);
router.post('/reset-password',authenticateToken, userResetPassword);
router.post('/change-password', authenticateToken,userChangePassword);
router.get('/user-details', authenticateToken, getUserDetails); // Protected route
router.get('/get-all-users', authenticateToken, adminOnly, getAllUsers); // Protected route

router.delete('/delete-user/:username', authenticateToken, adminOnly, deleteUserByUsername);
router.patch('/toggle-active/:userId', authenticateToken, adminOnly, toggleUserActive);
router.patch('/user-department/:userId', authenticateToken, adminOnly, setUserDepartment);

export default router;

