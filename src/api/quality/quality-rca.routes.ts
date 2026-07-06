import express from 'express';
import { listRcas, getRcaStats, getRca, updateRca } from './quality-rca.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

// Read endpoints — staff visibility.
router.get('/stats', authenticateToken, getRcaStats);
router.get('/', authenticateToken, listRcas);
router.get('/:id', authenticateToken, getRca);

// Write endpoints — clinical actor (matches incident CAPA pattern).
router.put('/:id', authenticateToken, requireClinicalActor, updateRca);

export default router;
