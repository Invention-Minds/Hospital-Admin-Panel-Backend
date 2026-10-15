import express from 'express';
import { safety, clinical, timeliness, experience, otEfficiency, nabhScorecard } from './quality.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityViewer } from '../_shared/quality-roles';

const router = express.Router();

// All endpoints are read-only; Quality viewers (see _shared/quality-roles.ts).
router.get('/safety', authenticateToken, requireQualityViewer, safety);
router.get('/clinical', authenticateToken, requireQualityViewer, clinical);
router.get('/timeliness', authenticateToken, requireQualityViewer, timeliness);
router.get('/experience', authenticateToken, requireQualityViewer, experience);
router.get('/ot', authenticateToken, requireQualityViewer, otEfficiency);
router.get('/nabh-scorecard', authenticateToken, requireQualityViewer, nabhScorecard);

export default router;
