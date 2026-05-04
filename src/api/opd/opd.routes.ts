import { Router } from 'express';
import {
  createOpdAssessment,
  getOpdAssessmentById,
  updateOpdAssessment,
  deleteOpdAssessment,
  admitToIpd
} from './opd.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = Router();

router.post('/', authenticateToken, requireClinicalActor, createOpdAssessment);
router.get('/:id', getOpdAssessmentById);
router.put('/:id', authenticateToken, requireClinicalActor, updateOpdAssessment);
router.delete('/:id', deleteOpdAssessment);
router.get('/by-appointment/:appointmentId', getOpdAssessmentById);
router.post('/admit-to-ipd', admitToIpd);

export default router;
