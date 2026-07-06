import { Router } from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { getInbox, getQuery, replyToQuery, closeQuery } from './whatsapp-query.controller';

const router = Router();

// All doctor-inbox endpoints are authenticated (panel users).
router.get('/inbox', authenticateToken, getInbox);
router.get('/:id', authenticateToken, getQuery);
router.post('/:id/reply', authenticateToken, replyToQuery);
router.post('/:id/close', authenticateToken, closeQuery);

export default router;
