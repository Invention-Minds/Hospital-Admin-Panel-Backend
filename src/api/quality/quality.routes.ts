import express from 'express';
import { safety, clinical, timeliness, experience, otEfficiency, nabhScorecard } from './quality.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityViewer, requireQualityTeam } from '../_shared/quality-roles';
import { qualityToday } from './quality-today.controller';
import { qualityClusters, qualityTrends, qualityUnitsHeatmap } from './quality-insights.controller';

const router = express.Router();

// Quality Manager "Today" page — overnight brief, deadline radar, accountability.
router.get('/today', authenticateToken, requireQualityTeam, qualityToday);
// Insights: unit heat-map + 12-month trends (viewers), pattern alerts (Quality Manager).
router.get('/units-heatmap', authenticateToken, requireQualityViewer, qualityUnitsHeatmap);
router.get('/trends', authenticateToken, requireQualityViewer, qualityTrends);
router.get('/clusters', authenticateToken, requireQualityTeam, qualityClusters);

// All endpoints are read-only; Quality viewers (see _shared/quality-roles.ts).
router.get('/safety', authenticateToken, requireQualityViewer, safety);
router.get('/clinical', authenticateToken, requireQualityViewer, clinical);
router.get('/timeliness', authenticateToken, requireQualityViewer, timeliness);
router.get('/experience', authenticateToken, requireQualityViewer, experience);
router.get('/ot', authenticateToken, requireQualityViewer, otEfficiency);
router.get('/nabh-scorecard', authenticateToken, requireQualityViewer, nabhScorecard);

export default router;
