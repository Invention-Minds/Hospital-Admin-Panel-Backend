import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  listNurses,
  createNurse,
  updateNurse,
  deactivateNurse,
  resetNursePassword,
  syncToOtStaff,
} from './nurse-staff.controller';

const router = express.Router();

// Phase 9.10 — Nurse / clinical-staff admin.
router.get('/nurses', authenticateToken, listNurses);
router.post('/nurses', authenticateToken, requireClinicalActor, createNurse);
router.patch('/nurses/:id', authenticateToken, requireClinicalActor, updateNurse);
router.patch('/nurses/:id/deactivate', authenticateToken, requireClinicalActor, deactivateNurse);
router.post('/nurses/:id/reset-password', authenticateToken, requireClinicalActor, resetNursePassword);
router.post('/nurses/:id/sync-ot', authenticateToken, requireClinicalActor, syncToOtStaff);

export default router;
