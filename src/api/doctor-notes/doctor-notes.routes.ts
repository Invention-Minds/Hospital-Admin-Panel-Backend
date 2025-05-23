import { Router } from 'express';
import {
  createDoctorNote,
  getAllDoctorNotes,
  getDoctorNotesByPRN,
  updateDoctorNoteByPRNAndDate
} from './doctor-notes.controller';

const router = Router();

router.post('/', createDoctorNote); // Add doctor note
router.get('/', getAllDoctorNotes); // Get all notes
router.get('/:prn', getDoctorNotesByPRN); // ?date=YYYY-MM-DD
router.put('/:prn', updateDoctorNoteByPRNAndDate); // ?date=YYYY-MM-DD

export default router;
