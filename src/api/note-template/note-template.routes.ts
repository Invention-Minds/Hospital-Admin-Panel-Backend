import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  listTemplates,
  getActiveForDepartment,
  getForDoctor,
  listMine,
  getTemplate,
  createTemplate,
  updateTemplate,
  setDefault,
  cloneTemplate,
  deleteTemplate,
} from './note-template.controller';

const router = express.Router();

// Reads — any authenticated user (doctors load active templates for their forms).
router.get('/active', authenticateToken, getActiveForDepartment);
// Phase 9.21 — doctor's own templates + department fallback.
router.get('/for-doctor', authenticateToken, getForDoctor);
// Phase 9.21 — doctor self-service manager: the doctor's own templates only.
router.get('/mine', authenticateToken, requireClinicalActor, listMine);
router.get('/', authenticateToken, listTemplates);
router.get('/:id', authenticateToken, getTemplate);

// Writes — super_admin/admin manage department-level templates; doctors manage
// only their own personal (doctorId-scoped) templates. requireClinicalActor
// stamps the audit trail; ownership enforcement (a doctor can't touch templates
// they don't own) lives in the controller via assertCanWrite().
router.post('/', authenticateToken, requireClinicalActor, createTemplate);
router.put('/:id', authenticateToken, requireClinicalActor, updateTemplate);
router.post('/:id/set-default', authenticateToken, requireClinicalActor, setDefault);
router.post('/:id/clone', authenticateToken, requireClinicalActor, cloneTemplate);
router.delete('/:id', authenticateToken, requireClinicalActor, deleteTemplate);

export default router;
