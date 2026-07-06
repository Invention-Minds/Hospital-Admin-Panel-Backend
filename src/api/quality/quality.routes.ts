import express from 'express';
import { safety, clinical, timeliness, experience, otEfficiency, nabhScorecard } from './quality.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

// All endpoints are read-only and authenticated.
router.get('/safety', authenticateToken, safety);
router.get('/clinical', authenticateToken, clinical);
router.get('/timeliness', authenticateToken, timeliness);
router.get('/experience', authenticateToken, experience);
router.get('/ot', authenticateToken, otEfficiency);
router.get('/nabh-scorecard', authenticateToken, nabhScorecard);

export default router;
