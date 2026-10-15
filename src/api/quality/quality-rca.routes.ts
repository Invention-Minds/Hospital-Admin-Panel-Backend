import express from 'express';
import { listRcas, getRcaStats, getRca, updateRca } from './quality-rca.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

// Reads: Quality viewers; writes: Quality team (see _shared/quality-roles.ts).
router.get('/stats', authenticateToken, requireQualityViewer, getRcaStats);
router.get('/', authenticateToken, requireQualityViewer, listRcas);
router.get('/:id', authenticateToken, requireQualityViewer, getRca);
router.put('/:id', authenticateToken, requireQualityTeam, updateRca);

export default router;
