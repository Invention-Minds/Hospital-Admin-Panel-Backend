import express from 'express';
import { createLabRadEvent, listLabRadEvents, deleteLabRadEvent } from './quality-lab-rad.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

router.get('/', authenticateToken, listLabRadEvents);
router.post('/', authenticateToken, requireClinicalActor, createLabRadEvent);
router.delete('/:id', authenticateToken, requireClinicalActor, deleteLabRadEvent);

export default router;
