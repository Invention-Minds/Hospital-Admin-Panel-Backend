import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam } from '../_shared/quality-roles';
import {
  listChecklists, getChecklist, createChecklist, updateChecklist, importStarterChecklists,
  listRuns, createRun, updateRun, getRun, saveResponses, submitRun,
  createFindingAction, updateFindingAction, auditSummary,
} from './quality-audits.controller';

// Mounted at /api/quality/audits (before /api/quality). Per-audit permissions
// (auditor / unit HOD / Quality Manager / action owner) are checked in the
// controller; the checklist builder is Quality Manager only.
const router = express.Router();

router.get('/summary', authenticateToken, auditSummary);

router.get('/checklists', authenticateToken, listChecklists);
router.post('/checklists/import-starter', authenticateToken, requireQualityTeam, importStarterChecklists);
router.post('/checklists', authenticateToken, requireQualityTeam, createChecklist);
router.get('/checklists/:id', authenticateToken, getChecklist);
router.put('/checklists/:id', authenticateToken, requireQualityTeam, updateChecklist);

router.get('/runs', authenticateToken, listRuns);
router.post('/runs', authenticateToken, createRun);
router.get('/runs/:id', authenticateToken, getRun);
router.put('/runs/:id', authenticateToken, updateRun);
router.put('/runs/:id/responses', authenticateToken, saveResponses);
router.post('/runs/:id/submit', authenticateToken, submitRun);
router.post('/runs/:id/actions', authenticateToken, createFindingAction);
router.put('/runs/:id/actions/:actionId', authenticateToken, updateFindingAction);

export default router;
