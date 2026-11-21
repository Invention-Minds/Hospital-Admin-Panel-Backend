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
import {
  getMyOpdQueue,
  getMyConsultation,
  startMyConsultation,
  finishMyConsultation,
  saveMyAssessment,
  sendMyNotes,
  getMyEstimates,
  signMyPrescription,
} from './doctor-opd-mobile.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireDoctor } from '../../middleware/require-doctor';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = Router();

// Phase 9.21 — AI auto-fill of a note template from dictation
router.post('/ai-draft', authenticateToken, requireClinicalActor, aiDraftOpd);

// Doctor mobile app — the logged-in doctor's OPD day. Registered before '/:id'
// so 'my-queue' is not captured as an assessment id.
router.get('/my-queue', authenticateToken, requireDoctor, getMyOpdQueue);
router.get('/my-estimates', authenticateToken, requireDoctor, getMyEstimates);
router.get('/my-queue/:appointmentId', authenticateToken, requireDoctor, getMyConsultation);
router.post('/my-queue/:appointmentId/start', authenticateToken, requireDoctor, requireClinicalActor, startMyConsultation);
router.post('/my-queue/:appointmentId/finish', authenticateToken, requireDoctor, requireClinicalActor, finishMyConsultation);
router.put('/my-queue/:appointmentId/assessment', authenticateToken, requireDoctor, requireClinicalActor, saveMyAssessment);
router.post('/my-queue/:appointmentId/send-notes', authenticateToken, requireDoctor, requireClinicalActor, sendMyNotes);
router.post('/my-queue/:appointmentId/prescription', authenticateToken, requireDoctor, requireClinicalActor, signMyPrescription);

router.post('/', authenticateToken, requireClinicalActor, createOpdAssessment);
router.get('/:id', getOpdAssessmentById);
router.put('/:id', authenticateToken, requireClinicalActor, updateOpdAssessment);
router.delete('/:id', deleteOpdAssessment);
router.get('/by-appointment/:appointmentId', getOpdAssessmentById);
router.post('/admit-to-ipd', admitToIpd);
router.post('/refer-for-admission', authenticateToken, requireClinicalActor, referForAdmission);

export default router;
