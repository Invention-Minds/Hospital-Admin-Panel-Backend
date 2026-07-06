import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

import {
  listSessions,
  getSession,
  upsertSession,
  addReading,
  deleteReading,
} from './day-care.controller';

const router = express.Router();

router.get('/sessions', authenticateToken, listSessions);
router.get('/sessions/:id', authenticateToken, getSession);
router.post('/sessions', authenticateToken, requireClinicalActor, upsertSession);
router.put('/sessions/:id', authenticateToken, requireClinicalActor, upsertSession);

router.post('/sessions/:id/readings', authenticateToken, requireClinicalActor, addReading);
router.delete('/sessions/:id/readings/:readingId', authenticateToken, requireClinicalActor, deleteReading);

export default router;
