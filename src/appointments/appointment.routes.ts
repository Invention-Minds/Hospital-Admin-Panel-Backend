import { Router } from 'express';
import { createAppointment, getAppointments, updateAppointment, deleteAppointment } from './appointment.controller';

const router = Router();

router.post('/', createAppointment);
router.get('/', getAppointments);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);

export default router;
