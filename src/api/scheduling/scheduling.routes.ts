import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

import {
  listShifts,
  upsertShift,
  listAssignments,
  upsertAssignment,
  deleteAssignment,
  acknowledgeAssignment,
  myPendingAck,
  kioskList,
  whoWasOnDuty,
  listStaff,
} from './scheduling.controller';

const router = express.Router();

// Shift master — list is open to any authenticated user (UI dropdowns).
// Writes are gated by requireClinicalActor for audit-actor capture.
router.get('/shifts', authenticateToken, listShifts);
router.post('/shifts', authenticateToken, requireClinicalActor, upsertShift);
router.put('/shifts/:id', authenticateToken, requireClinicalActor, upsertShift);

// Roster — read open to any authenticated user; writes restricted.
router.get('/assignments', authenticateToken, listAssignments);
router.post('/assignments', authenticateToken, requireClinicalActor, upsertAssignment);
router.put('/assignments/:id', authenticateToken, requireClinicalActor, upsertAssignment);
router.delete('/assignments/:id', authenticateToken, requireClinicalActor, deleteAssignment);

// Acknowledgement — must be authenticated (identity check is in the
// controller; a staff member can only ack their own assignment).
router.post('/assignments/:id/acknowledge', authenticateToken, acknowledgeAssignment);

// Driver endpoints for the UI.
router.get('/my-pending-ack', authenticateToken, myPendingAck);
router.get('/kiosk', authenticateToken, kioskList);
router.get('/who-was-on-duty', authenticateToken, whoWasOnDuty);
router.get('/staff', authenticateToken, listStaff);

export default router;
