import { Router } from 'express';
import {
  createOpdAssessment,
  getOpdAssessmentById,
  updateOpdAssessment,
  deleteOpdAssessment
} from './opd.controller';

const router = Router();

router.post('/', createOpdAssessment);
router.get('/:id', getOpdAssessmentById);
router.put('/:id', updateOpdAssessment);
router.delete('/:id', deleteOpdAssessment);
router.get('/by-appointment/:appointmentId', getOpdAssessmentById);

export default router;
