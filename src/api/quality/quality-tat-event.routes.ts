import express from 'express';
import { createTatEvent, listTatEvents, deleteTatEvent, getTatTargets } from './quality-tat-event.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

router.get('/targets', authenticateToken, requireQualityViewer, getTatTargets);
router.get('/', authenticateToken, requireQualityViewer, listTatEvents);
router.post('/', authenticateToken, requireQualityTeam, createTatEvent);
router.delete('/:id', authenticateToken, requireQualityTeam, deleteTatEvent);

export default router;
