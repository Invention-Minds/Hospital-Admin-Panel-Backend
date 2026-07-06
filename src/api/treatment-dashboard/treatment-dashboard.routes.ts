import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  getWatchboard,
  getPatientAcuity,
  postEscalation,
  refreshSnapshots,
} from './treatment-dashboard.controller';

const router = express.Router();

// Phase 9.13 — Treatment Dashboard (NEWS2 deterioration watchboard).
router.get('/watchboard', authenticateToken, getWatchboard);
router.get('/patient/:admissionId', authenticateToken, getPatientAcuity);
router.post('/patient/:admissionId/escalate', authenticateToken, requireClinicalActor, postEscalation);
router.post('/refresh', authenticateToken, requireClinicalActor, refreshSnapshots);

export default router;
