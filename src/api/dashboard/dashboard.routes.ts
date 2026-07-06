import { Router } from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { getDoctorDashboardSummary } from './dashboard.controller';
import { getManagementSummary } from './management.controller';
import { getFrontDeskSummary } from './frontdesk.controller';
import { getNurseSummary } from './nurse.controller';
import { getNursingSuperintendentSummary } from './nursing-super.controller';

const router = Router();

router.get('/doctor/summary', authenticateToken, getDoctorDashboardSummary);
router.get('/management/summary', authenticateToken, getManagementSummary);
router.get('/frontdesk/summary', authenticateToken, getFrontDeskSummary);
router.get('/nurse/summary', authenticateToken, getNurseSummary);
router.get('/nursing-superintendent/summary', authenticateToken, getNursingSuperintendentSummary);

export default router;
