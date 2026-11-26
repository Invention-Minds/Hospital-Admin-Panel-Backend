import { Router } from 'express';
import {
    getExtraSlots,
    getExtraSlotsByDoctor,
    addOrUpdateExtraSlot,
    removeExtraSlot,
} from './extraslots.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import { EXTRA_SLOT_EDITORS } from './extra-slot-editors';

const router = Router();

// Before / After (extend OPD hours): admin, super_admin and EXTRA_SLOT_EDITORS.
const canExtendSlots = requireRole({ roles: ['admin'], employeeIds: EXTRA_SLOT_EDITORS });

router.get('/', authenticateToken, getExtraSlots); // Get all extra slots
router.get('/:doctorId/:date', authenticateToken, getExtraSlotsByDoctor); // Get extra slots by doctor & date
router.post('/add', authenticateToken, canExtendSlots, addOrUpdateExtraSlot); // Add or update extra slots (Before / After)
router.post('/remove', authenticateToken, removeExtraSlot); // Remove extra slots

export default router;
