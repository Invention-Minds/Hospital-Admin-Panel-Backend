import express from 'express';
import multer from 'multer';
import {
  createIncident, listIncidents, getIncident, updateIncidentStatus, getIncidentStats,
  upsertIncidentCapa, tagIncidentWithQi, uploadIncidentEvidence,
} from './incident.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

// Phase 6f — evidence file upload. 10MB cap; in-memory then push to GCS.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = express.Router();

// Read endpoints — any authenticated user.
router.get('/stats', authenticateToken, getIncidentStats);
router.get('/', authenticateToken, listIncidents);
router.get('/:id', authenticateToken, getIncident);

// Writes — require a clinical actor (manual raise is part of audit chain).
router.post('/', authenticateToken, requireClinicalActor, createIncident);
router.put('/:id/status', authenticateToken, requireClinicalActor, updateIncidentStatus);
router.put('/:id/capa', authenticateToken, requireClinicalActor, upsertIncidentCapa);
// Phase 5c — retag an incident with a specific QI indicator code.
router.patch('/:id/qi-tag', authenticateToken, requireClinicalActor, tagIncidentWithQi);
// Phase 6f — evidence file upload (multipart/form-data; field name 'file').
router.post('/:id/evidence', authenticateToken, requireClinicalActor, upload.single('file'), uploadIncidentEvidence);

export default router;
