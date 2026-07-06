import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  listIcuVitals, addIcuVitals, removeIcuVitals,
  listIcuProgressNotes, addIcuProgressNote, updateIcuProgressNote,
  listSedationLogs, addSedationLog,
  listRestraintLogs, addRestraintLog, appendRestraintReview,
  listBundleLogs, upsertBundleLog,
  listFamilyComms, addFamilyComm,
  listStepDowns, proposeStepDown, acknowledgeStepDown, acceptStepDown, completeStepDown,
  getIcuWorkbench,
} from './icu-clinical.controller';
import {
  listInvasiveLines, addInvasiveLine, updateInvasiveLine, removeInvasiveLine,
  listCarePlans, createCarePlan, updateCarePlan, removeCarePlan,
  listNurseNotes, addNurseNote, removeNurseNote,
} from './icu-nurses-care.controller';

const router = express.Router();

// Phase 9.6 — ICU clinical artefacts (NABH COP.3). All admission-scoped.
const base = '/admission/:admissionId/icu';

// Workbench aggregator — one GET returns everything for the tabbed shell
router.get(`${base}/workbench`, authenticateToken, getIcuWorkbench);

// Vitals
router.get(`${base}/vitals`, authenticateToken, listIcuVitals);
router.post(`${base}/vitals`, authenticateToken, requireClinicalActor, addIcuVitals);
router.delete('/icu/vitals/:id', authenticateToken, requireClinicalActor, removeIcuVitals);

// Progress notes
router.get(`${base}/progress-notes`, authenticateToken, listIcuProgressNotes);
router.post(`${base}/progress-notes`, authenticateToken, requireClinicalActor, addIcuProgressNote);
router.put('/icu/progress-notes/:id', authenticateToken, requireClinicalActor, updateIcuProgressNote);

// Sedation
router.get(`${base}/sedation`, authenticateToken, listSedationLogs);
router.post(`${base}/sedation`, authenticateToken, requireClinicalActor, addSedationLog);

// Restraints
router.get(`${base}/restraints`, authenticateToken, listRestraintLogs);
router.post(`${base}/restraints`, authenticateToken, requireClinicalActor, addRestraintLog);
router.post('/icu/restraints/:id/review', authenticateToken, requireClinicalActor, appendRestraintReview);

// Bundles
router.get(`${base}/bundles`, authenticateToken, listBundleLogs);
router.put(`${base}/bundles`, authenticateToken, requireClinicalActor, upsertBundleLog);

// Family communication
router.get(`${base}/family-comms`, authenticateToken, listFamilyComms);
router.post(`${base}/family-comms`, authenticateToken, requireClinicalActor, addFamilyComm);

// Step-down
router.get(`${base}/step-downs`, authenticateToken, listStepDowns);
router.post(`${base}/step-downs`, authenticateToken, requireClinicalActor, proposeStepDown);
router.post('/icu/step-downs/:id/acknowledge', authenticateToken, requireClinicalActor, acknowledgeStepDown);
router.post('/icu/step-downs/:id/accept', authenticateToken, requireClinicalActor, acceptStepDown);
router.post('/icu/step-downs/:id/complete', authenticateToken, requireClinicalActor, completeStepDown);

// Phase 9.16 — Nurses Care Record: invasive lines
router.get(`${base}/invasive-lines`, authenticateToken, listInvasiveLines);
router.post(`${base}/invasive-lines`, authenticateToken, requireClinicalActor, addInvasiveLine);
router.put('/icu/invasive-lines/:id', authenticateToken, requireClinicalActor, updateInvasiveLine);
router.delete('/icu/invasive-lines/:id', authenticateToken, requireClinicalActor, removeInvasiveLine);

// Phase 9.16 — Nursing care plan
router.get(`${base}/care-plans`, authenticateToken, listCarePlans);
router.post(`${base}/care-plans`, authenticateToken, requireClinicalActor, createCarePlan);
router.put('/icu/care-plans/:id', authenticateToken, requireClinicalActor, updateCarePlan);
router.delete('/icu/care-plans/:id', authenticateToken, requireClinicalActor, removeCarePlan);

// Phase 9.16 — Nurse special notes
router.get(`${base}/nurse-notes`, authenticateToken, listNurseNotes);
router.post(`${base}/nurse-notes`, authenticateToken, requireClinicalActor, addNurseNote);
router.delete('/icu/nurse-notes/:id', authenticateToken, requireClinicalActor, removeNurseNote);

export default router;
