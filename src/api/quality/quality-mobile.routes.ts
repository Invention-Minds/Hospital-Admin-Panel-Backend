import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import { requireFeedbackViewer } from '../_shared/quality-roles';
import { getAssignees, getIncidentTimeline, getQualityOverview, raiseFeedbackAsComplaint, uploadAuditPhoto, getUnitQrCodes } from './quality-mobile.controller';

// Photos stay in memory only long enough to push to GCS (same as incident evidence).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Management mobile app — Quality additions. Mounted at /api/quality/mobile,
// before the generic /api/quality router.
const router = Router();

router.get('/overview', authenticateToken, getQualityOverview);
router.get('/incidents/:id/timeline', authenticateToken, getIncidentTimeline);
router.get('/assignees', authenticateToken, getAssignees);
router.get('/units/qr', authenticateToken, getUnitQrCodes);
router.post('/feedback/:surveyId/raise', authenticateToken, requireClinicalActor, requireFeedbackViewer, raiseFeedbackAsComplaint);

router.post('/audit-runs/:id/photo', authenticateToken, requireClinicalActor, upload.single('file'), uploadAuditPhoto);

export default router;
