import { Router } from 'express';
import { createAppointment, getAppointments, updateAppointment, deleteAppointment,  getTotalAppointments,
    getPendingAppointments, } from './appointment.controller';

const router = Router();

router.post('/', createAppointment);
router.get('/', getAppointments);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);
router.get('/total', getTotalAppointments);
router.get('/pending', getPendingAppointments);

export default router;
