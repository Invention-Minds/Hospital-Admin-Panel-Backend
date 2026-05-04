import express from 'express';
import {
  createIpdAdmission,
  getIpdAdmission,
  getIpdAdmissions,
  updateIpdAdmission,
  addProgressNote,
  getProgressNotes,
  createDischarge,
  getDischarge,
  transferPatient,
  downloadDischargePDF,
  getIpdStats,
} from './ipd.controller';
import {
  getAllWards,
  getWardDetails,
  getAvailableBeds,
  updateBedStatus,
  getBedCensus,
} from './ward-management.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

// Specific paths FIRST (read-only; unauthenticated by prior convention).
router.get('/stats', getIpdStats);
router.get('/bed-census', getBedCensus);
router.get('/wards', getAllWards);
router.get('/ward/:wardId', getWardDetails);
router.get('/beds/available', getAvailableBeds);
router.put('/bed/:bedId/status', updateBedStatus);

// IPD Admission routes — clinical writes guarded for NABH MRD.1 (Sprint 4a Phase 1b)
router.post('/admission', authenticateToken, requireClinicalActor, createIpdAdmission);
router.get('/admissions', getIpdAdmissions);
router.get('/admission/:id', getIpdAdmission);
router.put('/admission/:id', authenticateToken, requireClinicalActor, updateIpdAdmission);

// IPD Progress Notes routes
router.post('/admission/:admissionId/progress-note', authenticateToken, requireClinicalActor, addProgressNote);
router.get('/admission/:admissionId/progress-notes', getProgressNotes);

// IPD Discharge routes
router.post('/admission/:admissionId/discharge', authenticateToken, requireClinicalActor, createDischarge);
router.get('/admission/:admissionId/discharge', getDischarge);
router.get('/admission/:admissionId/discharge-pdf', downloadDischargePDF);

// IPD Transfer routes
router.post('/admission/:admissionId/transfer', authenticateToken, requireClinicalActor, transferPatient);

export default router;
