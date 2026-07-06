import { Router } from 'express';
import {
  createOpdAssessment,
  getOpdAssessmentById,
  updateOpdAssessment,
  deleteOpdAssessment,
  admitToIpd,
  referForAdmission,
  aiDraftOpd,
} from './opd.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = Router();

// Phase 9.21 — AI auto-fill of a note template from dictation
router.post('/ai-draft', authenticateToken, requireClinicalActor, aiDraftOpd);

router.post('/', authenticateToken, requireClinicalActor, createOpdAssessment);
router.get('/:id', getOpdAssessmentById);
router.put('/:id', authenticateToken, requireClinicalActor, updateOpdAssessment);
router.delete('/:id', deleteOpdAssessment);
router.get('/by-appointment/:appointmentId', getOpdAssessmentById);
router.post('/admit-to-ipd', admitToIpd);
router.post('/refer-for-admission', authenticateToken, requireClinicalActor, referForAdmission);

export default router;
