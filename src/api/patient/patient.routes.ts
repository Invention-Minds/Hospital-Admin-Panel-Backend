import { Router } from 'express';
import { PatientController } from './patient.controller';

const router = Router();
const patientController = new PatientController();

router.post('/', (req, res) => patientController.createPatient(req, res));
router.get('/:id', (req, res) => patientController.getPatient(req, res));
router.put('/:id', (req, res) => patientController.updatePatient(req, res));
router.delete('/:id', (req, res) => patientController.deletePatient(req, res));

export default router;
