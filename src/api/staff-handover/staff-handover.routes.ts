import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  createHandover,
  acknowledgeHandover,
  declineHandover,
  supervisorSign,
  closeHandover,
  listHandovers,
  getHandover,
} from './staff-handover.controller';

const router = express.Router();

// Reads
router.get('/', authenticateToken, listHandovers);
router.get('/:id', authenticateToken, getHandover);

// Writes — three-/four-signature chain (depending on eventType).
router.post('/', authenticateToken, requireClinicalActor, createHandover);
router.post('/:id/acknowledge', authenticateToken, requireClinicalActor, acknowledgeHandover);
router.post('/:id/decline', authenticateToken, requireClinicalActor, declineHandover);
router.post('/:id/supervisor-sign', authenticateToken, requireClinicalActor, supervisorSign);
router.post('/:id/close', authenticateToken, requireClinicalActor, closeHandover);

export default router;
