import express from 'express';
import { upsertDenominator, listDenominators, deleteDenominator } from './quality-denominator.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

router.get('/', authenticateToken, listDenominators);
router.post('/', authenticateToken, requireClinicalActor, upsertDenominator);
router.delete('/:id', authenticateToken, requireClinicalActor, deleteDenominator);

export default router;
