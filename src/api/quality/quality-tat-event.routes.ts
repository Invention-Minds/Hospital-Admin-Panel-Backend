import express from 'express';
import { createTatEvent, listTatEvents, deleteTatEvent, getTatTargets } from './quality-tat-event.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

router.get('/targets', authenticateToken, getTatTargets);
router.get('/', authenticateToken, listTatEvents);
router.post('/', authenticateToken, requireClinicalActor, createTatEvent);
router.delete('/:id', authenticateToken, requireClinicalActor, deleteTatEvent);

export default router;
