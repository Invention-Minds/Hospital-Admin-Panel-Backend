import express from 'express';
import {
  reviewCarryoverPrescriptions,
  continuePrescription,
  modifyPrescription,
  discontinuePrescription,
  createNewPrescription,
  getPendingMedications,
  administerMedication,
  getMedicationAdministrationRecord,
  getAdmissionPrescriptions,
  skipMedication,
  getPrescription,
  getMarReport,
  getPrescriptionHistory,
  downloadMedicationList,
  syncPrescriptionWithHmis,
} from './ipd-prescription.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

// Per-admission endpoints (reads unauthenticated by prior convention).
router.get('/admission/:admissionId/review-carryover', reviewCarryoverPrescriptions);
router.get('/admission/:admissionId/prescriptions', getAdmissionPrescriptions);
router.get('/admission/:admissionId/pending', getPendingMedications);
router.get('/admission/:admissionId/mar', getMedicationAdministrationRecord);
router.get('/admission/:admissionId/mar-report', getMarReport);
router.get('/admission/:admissionId/history', getPrescriptionHistory);
router.get('/admission/:admissionId/download-medication-list', downloadMedicationList);

// Clinical writes — guarded for NABH MRD.1 (Sprint 4a Phase 1b).
router.post('/admission/:admissionId/prescription', authenticateToken, requireClinicalActor, createNewPrescription);
router.post('/admission/:admissionId/continue', authenticateToken, requireClinicalActor, continuePrescription);

// Per-prescription endpoints
router.get('/prescription/:prescriptionId', getPrescription);
router.put('/prescription/:prescriptionId/modify', authenticateToken, requireClinicalActor, modifyPrescription);
router.put('/prescription/:prescriptionId/discontinue', authenticateToken, requireClinicalActor, discontinuePrescription);
router.put('/prescription/:prescriptionId/skip', authenticateToken, requireClinicalActor, skipMedication);
router.post('/prescription/:prescriptionId/administer', authenticateToken, requireClinicalActor, administerMedication);
router.post('/prescription/:prescriptionId/sync-hmis', authenticateToken, requireClinicalActor, syncPrescriptionWithHmis);

export default router;
