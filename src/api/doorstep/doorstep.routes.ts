import { Router } from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { getDoorstepRequests, updateDoorstepStatus } from './doorstep.controller';

const router = Router();

router.get('/inbox', authenticateToken, getDoorstepRequests);
router.post('/:id/status', authenticateToken, updateDoorstepStatus);

export default router;
