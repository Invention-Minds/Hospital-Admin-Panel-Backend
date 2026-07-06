import { Router } from 'express';
import { PatientController } from './patient.controller';
import { getPatientTimeline } from './patient-timeline.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();
const patientController = new PatientController();

// Phase 2.5 — every patient endpoint now requires a valid JWT. The create
// endpoint was previously open which allowed any caller to write to
// PatientDetails; closing it before staging.
router.post('/', authenticateToken, (req, res) => patientController.createPatient(req, res));
router.post('/get-details-by-prn', authenticateToken, (req, res) => patientController.getDetailsByPRN(req, res));
// Phase 9.23 — unified patient timeline. MUST be before /:prn and /:id.
router.get('/timeline/:prn', authenticateToken, getPatientTimeline);
// Phase 1 — duplicate-check by phone, must come before /:id catch-all.
router.get('/by-phone/:phone', authenticateToken, (req, res) => patientController.getPatientByPhone(req, res));
router.put('/:prn', authenticateToken, (req, res) => patientController.updatePatientByPRN(req, res));
router.get('/:id', authenticateToken, (req, res) => patientController.getPatient(req, res));
router.put('/:id', authenticateToken, (req, res) => patientController.updatePatient(req, res));
router.delete('/:id', authenticateToken, (req, res) => patientController.deletePatient(req, res));
router.get('/', authenticateToken, (req, res) => patientController.getPatients(req, res));

export default router;
