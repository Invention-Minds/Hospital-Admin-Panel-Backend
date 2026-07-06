import express from 'express';
import {
  createComplaint, listComplaints, getComplaint, updateComplaintStatus, complaintStats,
  triggerSlaSweep, bulkUpdateStatus,
} from './complaint.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

router.get('/stats', authenticateToken, complaintStats);
router.get('/', authenticateToken, listComplaints);
router.get('/:id', authenticateToken, getComplaint);
router.post('/', authenticateToken, createComplaint);
router.put('/:id/status', authenticateToken, updateComplaintStatus);
// Phase 6a — manual SLA breach sweep (ad-hoc / after policy change).
router.post('/sla-sweep', authenticateToken, triggerSlaSweep);
// Phase 6h — bulk status change from the grievance inbox.
router.put('/bulk-status', authenticateToken, bulkUpdateStatus);

export default router;
