import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  uploadResult,
  listByPrn,
  listByAdmission,
  listByOrder,
  pendingOrders,
  getResult,
  updateResult,
  acknowledgeResult,
  deleteResult,
  unackCritical,
} from './investigation-result.controller';
import { handleWebhook } from './investigation-result.webhook';

const router = express.Router();

// Phase 9.11 Phase B — Third-party webhook ingest. Auth is via the
// X-Webhook-Token header (per-provider shared secret in env), NOT via
// authenticateToken — vendors don't have JWTs.
router.post('/webhook/:provider', handleWebhook);

// 25 MB cap — lab/radiology reports rarely exceed this. PDFs are kept in
// memory only long enough to push to GCS; same pattern as signature upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ─── Phase 9.11 — Lab & Radiology results ──────────────────────────────

// Pending-orders worklist for the /lab-radiology/reports admin page.
router.get('/pending-orders', authenticateToken, pendingOrders);

// Unacknowledged critical results — used to drive the patient/admission banner.
router.get('/unack-critical', authenticateToken, unackCritical);

// List
router.get('/patient/:prn', authenticateToken, listByPrn);
router.get('/admission/:admissionId', authenticateToken, listByAdmission);
router.get('/order/:orderId', authenticateToken, listByOrder);

// Single
router.get('/:id', authenticateToken, getResult);

// Mutations
router.post('/', authenticateToken, requireClinicalActor, upload.single('file'), uploadResult);
router.patch('/:id', authenticateToken, requireClinicalActor, upload.single('file'), updateResult);
router.post('/:id/ack', authenticateToken, requireClinicalActor, acknowledgeResult);
router.delete('/:id', authenticateToken, requireClinicalActor, deleteResult);

export default router;
