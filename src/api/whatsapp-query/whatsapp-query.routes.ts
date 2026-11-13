import { Router } from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { getInbox, getQuery, replyToQuery, closeQuery } from './whatsapp-query.controller';
import { draftMyReply, getMyInbox, getMyQuery, requireOwnQuery } from './doctor-queries-mobile.controller';

const router = Router();

// All doctor-inbox endpoints are authenticated (panel users).
router.get('/inbox', authenticateToken, getInbox);

// Doctor mobile app — same inbox with an ownership check on every query.
// Reply/close reuse the web handlers. Registered before '/:id'.
router.get('/my-inbox', authenticateToken, getMyInbox);
router.get('/my/:id', authenticateToken, requireOwnQuery, getMyQuery);
router.post('/my/:id/draft', authenticateToken, requireOwnQuery, draftMyReply);
router.post('/my/:id/reply', authenticateToken, requireOwnQuery, replyToQuery);
router.post('/my/:id/close', authenticateToken, requireOwnQuery, closeQuery);

router.get('/:id', authenticateToken, getQuery);
router.post('/:id/reply', authenticateToken, replyToQuery);
router.post('/:id/close', authenticateToken, closeQuery);

export default router;
