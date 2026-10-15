import express from 'express';
import {
  createObservation, listObservations, periodSummary, deleteObservation, listAuditBackedCodes,
} from './quality-audit-observation.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

// Reads: Quality viewers; writes: Quality team (see _shared/quality-roles.ts).
router.get('/summary', authenticateToken, requireQualityViewer, periodSummary);
router.get('/codes', authenticateToken, requireQualityViewer, listAuditBackedCodes);
router.get('/', authenticateToken, requireQualityViewer, listObservations);
router.post('/', authenticateToken, requireQualityTeam, createObservation);
router.delete('/:id', authenticateToken, requireQualityTeam, deleteObservation);

export default router;
