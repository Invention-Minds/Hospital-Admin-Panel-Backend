import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import {
  listForms,
  getForm,
  signConsent,
  listByContext,
  listByPatient,
} from './consent.controller';

const router = express.Router();

// Read endpoints — any authenticated user. Specific paths first.
router.get('/forms', authenticateToken, listForms);
router.get('/forms/:type/:language', authenticateToken, getForm);
router.get('/forms/:type', authenticateToken, getForm);

router.get('/by-context/:contextType/:contextId', authenticateToken, listByContext);
router.get('/by-patient/:prn', authenticateToken, listByPatient);

// Write endpoint. Patient & attender consents are valid signers, so we do
// NOT apply requireClinicalActor here (the actual signature lives in
// SignatureBlob which carries the signerType + signerName).
router.post('/sign', authenticateToken, signConsent);

export default router;
