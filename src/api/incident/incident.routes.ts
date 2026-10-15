import express from 'express';
import multer from 'multer';
import {
  createIncident, listIncidents, getIncident, updateIncidentStatus, getIncidentStats,
  upsertIncidentCapa, tagIncidentWithQi, uploadIncidentEvidence,
} from './incident.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import { requireIncidentManager } from '../_shared/quality-roles';

// Phase 6f — evidence file upload. 10MB cap; in-memory then push to GCS.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = express.Router();

// Read endpoints — any authenticated user; the controller applies the caller's
// read scope (own/assigned, department, or all — see _shared/quality-roles.ts).
router.get('/stats', authenticateToken, getIncidentStats);
router.get('/', authenticateToken, listIncidents);
router.get('/:id', authenticateToken, getIncident);

// Raise + attach evidence — any staff (non-punitive reporting).
router.post('/', authenticateToken, requireClinicalActor, createIncident);
// Phase 6f — evidence file upload (multipart/form-data; field name 'file').
router.post('/:id/evidence', authenticateToken, requireClinicalActor, upload.single('file'), uploadIncidentEvidence);

// Investigation workflow — incident managers only (see _shared/quality-roles.ts).
router.put('/:id/status', authenticateToken, requireIncidentManager, updateIncidentStatus);
router.put('/:id/capa', authenticateToken, requireIncidentManager, upsertIncidentCapa);
// Phase 5c — retag an incident with a specific QI indicator code.
router.patch('/:id/qi-tag', authenticateToken, requireIncidentManager, tagIncidentWithQi);

export default router;
