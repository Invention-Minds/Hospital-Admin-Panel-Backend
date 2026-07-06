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
import {
  generateAiDraft,
  editDischarge,
  signDischarge,
  recordAttenderAck,
} from '../discharge-ai/discharge-ai.controller';
import {
  listClearances,
  clearDepartment,
  rejectDepartment,
  departmentQueue,
  finalize as finalizeDischarge,
  abandonChain,
  setReadyForDischarge,
  recordMtAck,
  mtQueue,
} from './discharge-clearance.controller';
import {
  getForAdmission as getInitialAssessment,
  upsertForAdmission as upsertInitialAssessment,
  signFilled as signInitialAssessmentFilled,
  signConsultant as signInitialAssessmentConsultant,
} from './initial-assessment.controller';
import {
  getChart as getClinicalChart,
  createVitals as createChartVitals,
  createIntakeOutput as createChartIO,
  upsertDaily as upsertChartDaily,
  signShift as signChartShift,
  deleteVitals as deleteChartVitals,
  deleteIntakeOutput as deleteChartIO,
} from './clinical-chart.controller';
import {
  listInsulinReadings,
  createInsulinReading,
  updateInsulinReading,
  deleteInsulinReading,
  setGlucoseFrequency,
} from './insulin-infusion.controller';
import { getDischargeContext } from './discharge-summary.controller';
import {
  listForAdmission as listHandovers,
  upsertHandover,
  signHandedOver,
  signTakenOver,
  handoverPull,
} from './handover.controller';
import {
  listReconciliation,
  setReconciliationAction,
} from './medication-reconciliation.controller';
import {
  list as listNonDrugOrders,
  create as createNonDrugOrder,
  acknowledge as acknowledgeNonDrugOrder,
  complete as completeNonDrugOrder,
  cancel as cancelNonDrugOrder,
} from './non-drug-order.controller';
import {
  listDiagnosisCodes, addDiagnosisCode, updateDiagnosisCode, removeDiagnosisCode,
} from './diagnosis-code.controller';
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
// authenticateToken added (NS-3) so getIpdAdmissions can ward-scope to the
// logged-in nurse. The frontend attaches the Bearer token to every request.
router.get('/admissions', authenticateToken, getIpdAdmissions);
router.get('/admission/:id', getIpdAdmission);
router.put('/admission/:id', authenticateToken, requireClinicalActor, updateIpdAdmission);

// IPD Progress Notes routes
router.post('/admission/:admissionId/progress-note', authenticateToken, requireClinicalActor, addProgressNote);
router.get('/admission/:admissionId/progress-notes', getProgressNotes);

// IPD Initial Assessment on Admission (Phase 1 — NABH AAC.4)
router.get('/admission/:admissionId/initial-assessment', authenticateToken, getInitialAssessment);
router.post('/admission/:admissionId/initial-assessment', authenticateToken, requireClinicalActor, upsertInitialAssessment);
router.post('/admission/:admissionId/initial-assessment/sign-filled', authenticateToken, requireClinicalActor, signInitialAssessmentFilled);
router.post('/admission/:admissionId/initial-assessment/sign-consultant', authenticateToken, requireClinicalActor, signInitialAssessmentConsultant);

// Phase 2 — Clinical Chart (vitals + I/O + daily rollup). Read is open to
// authenticated users; writes go through the clinical-actor guard for audit.
router.get('/admission/:admissionId/clinical-chart', authenticateToken, getClinicalChart);
router.post('/admission/:admissionId/clinical-chart/vitals', authenticateToken, requireClinicalActor, createChartVitals);
router.delete('/admission/:admissionId/clinical-chart/vitals/:id', authenticateToken, requireClinicalActor, deleteChartVitals);
router.post('/admission/:admissionId/clinical-chart/intake-output', authenticateToken, requireClinicalActor, createChartIO);
router.delete('/admission/:admissionId/clinical-chart/intake-output/:id', authenticateToken, requireClinicalActor, deleteChartIO);
router.post('/admission/:admissionId/clinical-chart/daily', authenticateToken, requireClinicalActor, upsertChartDaily);
router.post('/admission/:admissionId/clinical-chart/sign-shift', authenticateToken, requireClinicalActor, signChartShift);

// Phase 9.14 — Insulin Infusion Chart
router.get('/admission/:admissionId/insulin-chart', authenticateToken, listInsulinReadings);
// Phase 9.18 — doctor-ordered glucose monitoring cadence (drives overdue check)
router.put('/admission/:admissionId/insulin-chart/frequency', authenticateToken, requireClinicalActor, setGlucoseFrequency);
router.post('/admission/:admissionId/insulin-chart', authenticateToken, requireClinicalActor, createInsulinReading);
router.put('/admission/:admissionId/insulin-chart/:id', authenticateToken, requireClinicalActor, updateInsulinReading);
router.delete('/admission/:admissionId/insulin-chart/:id', authenticateToken, requireClinicalActor, deleteInsulinReading);

// Phase 3 — Per-admission SBAR Hand-off (NABH HRM.5 / PSQ.5).
router.get('/admission/:admissionId/handovers', authenticateToken, listHandovers);
router.post('/admission/:admissionId/handover', authenticateToken, requireClinicalActor, upsertHandover);
router.post('/admission/:admissionId/handover/:id/sign-handed-over', authenticateToken, requireClinicalActor, signHandedOver);
router.post('/admission/:admissionId/handover/:id/sign-taken-over', authenticateToken, requireClinicalActor, signTakenOver);
router.get('/admission/:admissionId/handover-pull', authenticateToken, handoverPull);

// Phase 4a — Medication reconciliation (NABH MOM.1.c).
router.get('/admission/:admissionId/medication-reconciliation', authenticateToken, listReconciliation);
router.post('/admission/:admissionId/medication-reconciliation/:prescriptionId', authenticateToken, requireClinicalActor, setReconciliationAction);

// Phase 7 — Non-drug doctor orders (diet, mobility, investigations, etc.)
router.get('/admission/:admissionId/non-drug-orders', authenticateToken, listNonDrugOrders);
router.post('/admission/:admissionId/non-drug-orders', authenticateToken, requireClinicalActor, createNonDrugOrder);
router.post('/admission/:admissionId/non-drug-orders/:id/acknowledge', authenticateToken, requireClinicalActor, acknowledgeNonDrugOrder);
router.post('/admission/:admissionId/non-drug-orders/:id/complete', authenticateToken, requireClinicalActor, completeNonDrugOrder);
router.post('/admission/:admissionId/non-drug-orders/:id/cancel', authenticateToken, requireClinicalActor, cancelNonDrugOrder);

// Phase 9.3c — MRD ICD-10 + CPT codes per admission
router.get('/admission/:admissionId/diagnosis-codes', authenticateToken, listDiagnosisCodes);
router.post('/admission/:admissionId/diagnosis-codes', authenticateToken, requireClinicalActor, addDiagnosisCode);
router.put('/admission/:admissionId/diagnosis-codes/:id', authenticateToken, requireClinicalActor, updateDiagnosisCode);
router.delete('/admission/:admissionId/diagnosis-codes/:id', authenticateToken, requireClinicalActor, removeDiagnosisCode);

// IPD Discharge routes
router.post('/admission/:admissionId/discharge', authenticateToken, requireClinicalActor, createDischarge);
router.get('/admission/:admissionId/discharge', getDischarge);
// Phase 9.17 — assembled full discharge summary (paper layout, read-only gather)
router.get('/admission/:admissionId/discharge-context', authenticateToken, getDischargeContext);
router.get('/admission/:admissionId/discharge-pdf', downloadDischargePDF);

// Phase 6 (WF-5) — AI-drafted discharge summary chain.
router.post('/admission/:admissionId/discharge/ai-draft', authenticateToken, requireClinicalActor, generateAiDraft);
router.put('/admission/:admissionId/discharge/edit', authenticateToken, requireClinicalActor, editDischarge);
router.post('/admission/:admissionId/discharge/sign', authenticateToken, requireClinicalActor, signDischarge);
router.post('/admission/:admissionId/discharge/attender-ack', authenticateToken, requireClinicalActor, recordAttenderAck);

// ─── Phase D — Discharge cross-admission queues (no :admissionId param) ──
// Each department coordinator polls their own pending queue.
router.get('/discharge-queue/:dept', authenticateToken, departmentQueue);
// Medical transcriptionist's pending queue (cases where the doctor has flipped
// "ready for discharge" and the summary isn't signed yet).
router.get('/mt-queue', authenticateToken, mtQueue);

// ─── Phase D — Discharge clearance chain ────────────────────────────────
// Ward doctor flips "ready for discharge". Pre-notifies MT + Diet + Billing.
router.post('/admission/:admissionId/discharge/ready', authenticateToken, requireClinicalActor, setReadyForDischarge);
// MT acknowledges they're working the case (claim it off the MT queue).
router.post('/admission/:admissionId/discharge/mt-ack', authenticateToken, recordMtAck);
// Per-admission clearance board + gate.
router.get('/admission/:admissionId/discharge/clearances', authenticateToken, listClearances);
router.post('/admission/:admissionId/discharge/clearances/:dept/clear', authenticateToken, clearDepartment);
router.post('/admission/:admissionId/discharge/clearances/:dept/reject', authenticateToken, rejectDepartment);
// Front Desk button — runs the gate and finalises.
router.post('/admission/:admissionId/discharge/finalize', authenticateToken, finalizeDischarge);
// LAMA / DAMA bypass.
router.post('/admission/:admissionId/discharge/abandon', authenticateToken, requireClinicalActor, abandonChain);

// IPD Transfer routes
router.post('/admission/:admissionId/transfer', authenticateToken, requireClinicalActor, transferPatient);

export default router;
