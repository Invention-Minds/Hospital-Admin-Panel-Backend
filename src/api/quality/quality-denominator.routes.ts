import express from 'express';
import { upsertDenominator, listDenominators, deleteDenominator } from './quality-denominator.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

router.get('/', authenticateToken, requireQualityViewer, listDenominators);
router.post('/', authenticateToken, requireQualityTeam, upsertDenominator);
router.delete('/:id', authenticateToken, requireQualityTeam, deleteDenominator);

export default router;
