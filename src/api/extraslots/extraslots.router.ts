import { Router } from 'express';
import {
    getExtraSlots,
    getExtraSlotsByDoctor,
    addOrUpdateExtraSlot,
    removeExtraSlot,
} from './extraslots.controller';

const router = Router();

router.get('/', getExtraSlots); // Get all extra slots
router.get('/:doctorId/:date', getExtraSlotsByDoctor); // Get extra slots by doctor & date
router.post('/add', addOrUpdateExtraSlot); // Add or update extra slots
router.post('/remove', removeExtraSlot); // Remove extra slots

export default router;
