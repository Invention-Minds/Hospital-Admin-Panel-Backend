import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  proposeTransfer,
  acknowledgeTransfer,
  acceptTransfer,
  markInTransit,
  completeTransfer,
  listTransfers,
  getTransfer,
} from './icu-transfer.controller';

const router = express.Router();

// Reads
router.get('/', authenticateToken, listTransfers);
router.get('/:id', authenticateToken, getTransfer);

// Writes — three-signature chain (NABH COP.5).
router.post('/', authenticateToken, requireClinicalActor, proposeTransfer);
router.post('/:id/acknowledge', authenticateToken, requireClinicalActor, acknowledgeTransfer);
router.post('/:id/accept', authenticateToken, requireClinicalActor, acceptTransfer);
router.post('/:id/in-transit', authenticateToken, requireClinicalActor, markInTransit);
router.post('/:id/complete', authenticateToken, requireClinicalActor, completeTransfer);

export default router;
