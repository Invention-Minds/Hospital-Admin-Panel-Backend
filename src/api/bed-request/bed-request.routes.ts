import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  createBedRequest,
  acceptBedRequest,
  holdBedRequest,
  rejectBedRequest,
  attenderAccept,
  listBedRequests,
  getBedRequest,
} from './bed-request.controller';

const router = express.Router();

// Reads — any authenticated user with NS / PRE access.
router.get('/', authenticateToken, listBedRequests);
router.get('/:id', authenticateToken, getBedRequest);

// Writes — require a clinical actor (so audit trail captures NS / PRE staff id).
router.post('/', authenticateToken, requireClinicalActor, createBedRequest);
router.post('/:id/accept', authenticateToken, requireClinicalActor, acceptBedRequest);
router.post('/:id/hold', authenticateToken, requireClinicalActor, holdBedRequest);
router.post('/:id/reject', authenticateToken, requireClinicalActor, rejectBedRequest);
router.post('/:id/attender-accept', authenticateToken, requireClinicalActor, attenderAccept);

export default router;
