import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam } from '../_shared/quality-roles';
import {
  listUnits, createUnit, updateUnit, setUnitMappings, importSpecialties, mappingSources,
  getEscalationMatrix, setEscalationLadder, triggerEscalationSweep,
} from './quality-units.controller';
import {
  listComplaintCategories, listComplaintSlaRules, createComplaintSlaRule, updateComplaintSlaRule,
  deleteComplaintSlaRule, testComplaintSla,
} from './complaint-sla.controller';

// Mounted at /api/quality/units. Unit list + complaint types: any signed-in
// user (pickers on the incident / complaint forms). Everything else: Quality team.
const router = express.Router();

router.get('/', authenticateToken, listUnits);
router.get('/complaint-categories', authenticateToken, listComplaintCategories);
router.get('/sources', authenticateToken, requireQualityTeam, mappingSources);
router.post('/', authenticateToken, requireQualityTeam, createUnit);
router.post('/import-specialties', authenticateToken, requireQualityTeam, importSpecialties);
router.get('/escalation-matrix', authenticateToken, requireQualityTeam, getEscalationMatrix);
router.put('/escalation-matrix/:module/:severity', authenticateToken, requireQualityTeam, setEscalationLadder);
router.post('/escalation-sweep', authenticateToken, requireQualityTeam, triggerEscalationSweep);
router.get('/complaint-sla', authenticateToken, requireQualityTeam, listComplaintSlaRules);
router.get('/complaint-sla/test', authenticateToken, requireQualityTeam, testComplaintSla);
router.post('/complaint-sla', authenticateToken, requireQualityTeam, createComplaintSlaRule);
router.put('/complaint-sla/:ruleId', authenticateToken, requireQualityTeam, updateComplaintSlaRule);
router.delete('/complaint-sla/:ruleId', authenticateToken, requireQualityTeam, deleteComplaintSlaRule);
router.put('/:id', authenticateToken, requireQualityTeam, updateUnit);
router.put('/:id/mappings', authenticateToken, requireQualityTeam, setUnitMappings);

export default router;
