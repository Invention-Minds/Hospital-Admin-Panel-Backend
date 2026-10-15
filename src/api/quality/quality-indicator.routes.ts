import express from 'express';
import {
  listIndicators, getIndicator, getIndicatorStats,
  captureRecord, updateIndicator, catalogueSummary,
  triggerAutoSource, autoSourceInfo, triggerDataQualitySweep,
} from './quality-indicator.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

// Reads: Quality viewers; writes: Quality team (see _shared/quality-roles.ts).
router.get('/stats', authenticateToken, requireQualityViewer, getIndicatorStats);
router.get('/_catalogue', authenticateToken, requireQualityViewer, catalogueSummary);
router.get('/auto-source/info', authenticateToken, requireQualityViewer, autoSourceInfo);
router.get('/', authenticateToken, requireQualityViewer, listIndicators);
router.get('/:qiCode', authenticateToken, requireQualityViewer, getIndicator);

router.post('/:qiCode/records', authenticateToken, requireQualityTeam, captureRecord);
router.put('/:qiCode', authenticateToken, requireQualityTeam, updateIndicator);

// Phase 2 — manual trigger for the auto-source cron (backfill / ad-hoc runs).
router.post('/auto-source', authenticateToken, requireQualityTeam, triggerAutoSource);

// Phase 4 — manual trigger for the missing-record data-quality sweep.
router.post('/data-quality-sweep', authenticateToken, requireQualityTeam, triggerDataQualitySweep);

export default router;
