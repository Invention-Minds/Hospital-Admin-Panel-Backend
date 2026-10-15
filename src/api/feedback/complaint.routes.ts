import express from 'express';
import {
  createComplaint, listComplaints, getComplaint, updateComplaintStatus, complaintStats,
  triggerSlaSweep, bulkUpdateStatus,
} from './complaint.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireComplaintHandler } from '../_shared/quality-roles';

const router = express.Router();

// Reads + raise: any authenticated staff — the controller scopes reads via
// complaintReadScope. Status / assign / bulk / sweep: complaint handlers only.
router.get('/stats', authenticateToken, complaintStats);
router.get('/', authenticateToken, listComplaints);
// Phase 6a — manual SLA breach sweep (ad-hoc / after policy change).
router.post('/sla-sweep', authenticateToken, requireComplaintHandler, triggerSlaSweep);
// Phase 6h — bulk status change from the grievance inbox.
router.put('/bulk-status', authenticateToken, requireComplaintHandler, bulkUpdateStatus);
router.post('/', authenticateToken, createComplaint);
router.get('/:id', authenticateToken, getComplaint);
router.put('/:id/status', authenticateToken, requireComplaintHandler, updateComplaintStatus);

export default router;
