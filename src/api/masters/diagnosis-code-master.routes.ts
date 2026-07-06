import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  listDiagnosisMaster,
  createDiagnosisMaster,
  updateDiagnosisMaster,
  removeDiagnosisMaster,
} from './diagnosis-code-master.controller';

// Phase 9.4a — ICD-10 + CPT master catalog routes (mounted at
// /api/masters/diagnosis-codes).

const router = express.Router();

router.get('/', authenticateToken, listDiagnosisMaster);
router.post('/', authenticateToken, requireClinicalActor, createDiagnosisMaster);
router.put('/:id', authenticateToken, requireClinicalActor, updateDiagnosisMaster);
router.delete('/:id', authenticateToken, requireClinicalActor, removeDiagnosisMaster);

export default router;
