import express from 'express';
import {
  listIndicators, getIndicator, getIndicatorStats,
  captureRecord, updateIndicator, catalogueSummary,
  triggerAutoSource, autoSourceInfo, triggerDataQualitySweep,
} from './quality-indicator.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

const router = express.Router();

// Read endpoints — all authenticated.
router.get('/stats', authenticateToken, getIndicatorStats);
router.get('/_catalogue', authenticateToken, catalogueSummary);
router.get('/auto-source/info', authenticateToken, autoSourceInfo);
router.get('/', authenticateToken, listIndicators);
router.get('/:qiCode', authenticateToken, getIndicator);

// Write endpoints — clinical actor (matches incident/complaint pattern).
router.post('/:qiCode/records', authenticateToken, requireClinicalActor, captureRecord);
router.put('/:qiCode', authenticateToken, requireClinicalActor, updateIndicator);

// Phase 2 — manual trigger for the auto-source cron (backfill / ad-hoc runs).
router.post('/auto-source', authenticateToken, requireClinicalActor, triggerAutoSource);

// Phase 4 — manual trigger for the missing-record data-quality sweep.
router.post('/data-quality-sweep', authenticateToken, requireClinicalActor, triggerDataQualitySweep);

export default router;
