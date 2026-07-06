import express from 'express';
import {
  createObservation, listObservations, periodSummary, deleteObservation,
} from './quality-audit-observation.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

// Read endpoints — staff visibility.
router.get('/summary', authenticateToken, periodSummary);
router.get('/', authenticateToken, listObservations);

// Write endpoints — clinical actor (matches the rest of Phase 9.26).
router.post('/', authenticateToken, requireClinicalActor, createObservation);
router.delete('/:id', authenticateToken, requireClinicalActor, deleteObservation);

export default router;
