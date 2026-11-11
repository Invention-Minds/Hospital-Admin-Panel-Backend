import express from 'express';
import multer from 'multer';
import {
  createIncident, listIncidents, getIncident, updateIncidentStatus, getIncidentStats,
  upsertIncidentCapa, tagIncidentWithQi, uploadIncidentEvidence,
} from './incident.controller';
import { createCapaAction, updateCapaAction, recordEffectivenessReview } from './incident-capa.controller';
import {
  getTaxonomy, listPublicUnits, createPublicIncident, addParticipant, removeParticipant,
} from './incident-extras.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import { requireIncidentManager } from '../_shared/quality-roles';
import { rateLimit } from '../../middleware/rate-limit';

// Phase 6f — evidence file upload. 10MB cap; in-memory then push to GCS.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Anonymous QR reports: a few per device per hour (keyed on req.ip — trust
// proxy is set in index.ts — never the raw X-Forwarded-For header).
const publicReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  mode: 'all',
  keyGenerator: (req) => `incident-public|${req.ip || req.socket?.remoteAddress || 'unknown'}`,
  message: 'Too many reports from this device. Please try again later or tell the Quality team directly.',
});

const router = express.Router();

// Public — no login. Categories / sub-types, the area list for the QR form,
// and the anonymous report itself.
router.get('/taxonomy', getTaxonomy);
router.get('/public/units', listPublicUnits);
router.post('/public', publicReportLimiter, createPublicIncident);

// Read endpoints — any authenticated user; the controller applies the caller's
// read scope (own/assigned, department, or all — see _shared/quality-roles.ts).
router.get('/stats', authenticateToken, getIncidentStats);
router.get('/', authenticateToken, listIncidents);
router.get('/:id', authenticateToken, getIncident);

// Raise + attach evidence — any staff (non-punitive reporting).
router.post('/', authenticateToken, requireClinicalActor, createIncident);
// Phase 6f — evidence file upload (multipart/form-data; field name 'file').
router.post('/:id/evidence', authenticateToken, requireClinicalActor, upload.single('file'), uploadIncidentEvidence);

// Investigation workflow — incident managers, or the HOD / deputy of the
// incident's unit (checked in the controller: HODs can't close / cancel /
// reopen or change the unit).
router.put('/:id/status', authenticateToken, updateIncidentStatus);
router.put('/:id/capa', authenticateToken, upsertIncidentCapa);
// CAPA actions (owner may complete their own) + 30/60/90-day effectiveness checks.
router.post('/:id/capa/actions', authenticateToken, createCapaAction);
router.put('/:id/capa/actions/:actionId', authenticateToken, updateCapaAction);
router.post('/:id/effectiveness-reviews/:reviewId', authenticateToken, recordEffectivenessReview);
// Staff also involved (besides the lead investigator).
router.post('/:id/participants', authenticateToken, addParticipant);
router.delete('/:id/participants/:userId', authenticateToken, removeParticipant);
// Phase 5c — retag an incident with a specific QI indicator code.
router.patch('/:id/qi-tag', authenticateToken, requireIncidentManager, tagIncidentWithQi);

export default router;
