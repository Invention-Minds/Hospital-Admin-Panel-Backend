import { Router } from 'express';
import {
  setPriority,
  getTodayPriorities,
  clearPriority
} from './priority.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

// Mounted at /api/priority in src/index.ts
router.post('/', authenticateToken, setPriority);
router.get('/today', authenticateToken, getTodayPriorities);
router.patch('/:id/clear', authenticateToken, clearPriority);

export default router;
