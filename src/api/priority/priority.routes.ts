import { Router } from 'express';
import {
  setPriority,
  getTodayPriorities,
  clearPriority
} from './priority.controller';

const router = Router();

// Mounted at /api/priority in src/index.ts
router.post('/', setPriority);
router.get('/today', getTodayPriorities);
router.patch('/:id/clear', clearPriority);

export default router;
