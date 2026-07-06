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
  acknowledgeMedicationLog,
} from './ipd-prescription.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  pharmacyQueue, pharmacyAck, pharmacyReject, pharmacyDispense,
  nurseInbox, nurseCollect, nurseReturn,
} from './pharmacy-handshake.controller';

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

// Phase 4 (WF-3) — witness/co-signature on a MAR log entry.
router.post('/medication-log/:logId/acknowledge', authenticateToken, requireClinicalActor, acknowledgeMedicationLog);

// ─── Phase P — Pharmacy + nurse handshake ────────────────────────────────
router.get('/pharmacy/queue', authenticateToken, pharmacyQueue);
router.post('/pharmacy/:rxId/ack', authenticateToken, pharmacyAck);
router.post('/pharmacy/:rxId/reject', authenticateToken, pharmacyReject);
router.post('/pharmacy/:rxId/dispense', authenticateToken, pharmacyDispense);

router.get('/nurse/medication-inbox', authenticateToken, nurseInbox);
router.post('/nurse/:rxId/collect', authenticateToken, requireClinicalActor, nurseCollect);
router.post('/nurse/:rxId/return', authenticateToken, requireClinicalActor, nurseReturn);

export default router;
