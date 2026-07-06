import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  listProcedures, getProcedure, createProcedure, updateProcedure,
  startProcedure, completeProcedure, cancelProcedure,
} from './op-procedure.controller';

// Phase 9.4d — OP Procedures routes (mounted at /api/op-procedures).

const router = express.Router();

router.get('/', authenticateToken, listProcedures);
router.get('/:id', authenticateToken, getProcedure);
router.post('/', authenticateToken, requireClinicalActor, createProcedure);
router.put('/:id', authenticateToken, requireClinicalActor, updateProcedure);
router.post('/:id/start', authenticateToken, requireClinicalActor, startProcedure);
router.post('/:id/complete', authenticateToken, requireClinicalActor, completeProcedure);
router.post('/:id/cancel', authenticateToken, requireClinicalActor, cancelProcedure);

export default router;
