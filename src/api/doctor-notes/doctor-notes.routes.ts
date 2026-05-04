import { Router } from 'express';
import {
  createDoctorNote,
  getAllDoctorNotes,
  getDoctorNotesByPRN,
  updateDoctorNoteByPRNAndDate
} from './doctor-notes.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = Router();

router.post('/', authenticateToken, requireClinicalActor, createDoctorNote); // Add doctor note
router.get('/', getAllDoctorNotes); // Get all notes
router.get('/:prn', getDoctorNotesByPRN); // ?date=YYYY-MM-DD
router.put('/:prn', authenticateToken, requireClinicalActor, updateDoctorNoteByPRNAndDate); // ?date=YYYY-MM-DD

export default router;
