import { Router } from 'express';
import { createAppointment, getAppointments, updateAppointment, deleteAppointment,  getTotalAppointments,
    getPendingAppointments,getAppointmentsByUser } from './appointment.controller';
    import { authenticateToken } from '../middleware';

const router = Router();

router.post('/', createAppointment);
router.get('/', getAppointments);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);
router.get('/total', getTotalAppointments);
router.get('/pending', getPendingAppointments);
router.get('/by-user',getAppointmentsByUser);
// router.get('/by-role',authenticateToken,);

export default router;
