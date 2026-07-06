import { Router } from 'express';
import {
    getExtraSlots,
    getExtraSlotsByDoctor,
    addOrUpdateExtraSlot,
    removeExtraSlot,
} from './extraslots.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.get('/', authenticateToken, getExtraSlots); // Get all extra slots
router.get('/:doctorId/:date', authenticateToken, getExtraSlotsByDoctor); // Get extra slots by doctor & date
router.post('/add', authenticateToken, addOrUpdateExtraSlot); // Add or update extra slots
router.post('/remove', authenticateToken, removeExtraSlot); // Remove extra slots

export default router;
