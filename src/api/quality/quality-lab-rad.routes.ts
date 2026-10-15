import express from 'express';
import { createLabRadEvent, listLabRadEvents, deleteLabRadEvent } from './quality-lab-rad.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

router.get('/', authenticateToken, requireQualityViewer, listLabRadEvents);
router.post('/', authenticateToken, requireQualityTeam, createLabRadEvent);
router.delete('/:id', authenticateToken, requireQualityTeam, deleteLabRadEvent);

export default router;
