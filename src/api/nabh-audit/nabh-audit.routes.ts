import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  requestExport,
  listExports,
  getExport,
  getComplianceReport,
} from './nabh-audit.controller';

const router = express.Router();

// Compliance scorecard — primary auditor surface. Read-only.
router.get('/compliance-report', authenticateToken, getComplianceReport);

// Raw evidence dump — kept as drill-down / archival.
router.get('/exports', authenticateToken, listExports);
router.get('/exports/:id', authenticateToken, getExport);
router.post('/export', authenticateToken, requireClinicalActor, requestExport);

export default router;
