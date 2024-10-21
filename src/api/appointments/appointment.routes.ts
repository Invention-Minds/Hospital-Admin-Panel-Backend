import { Router } from 'express';
import {
    createAppointment, getAppointments, updateAppointment, deleteAppointment, getTotalAppointments,
    getPendingAppointments, getAppointmentsByUser, getDoctorReport, lockAppointment, unlockAppointment, scheduleCompletion
} from './appointment.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.post('/', createAppointment);
router.get('/', authenticateToken, getAppointments);
router.put('/:id', authenticateToken, updateAppointment);
router.delete('/:id', authenticateToken, deleteAppointment);
router.get('/total', authenticateToken, getTotalAppointments);
router.get('/pending', authenticateToken, getPendingAppointments);
router.get('/by-user', authenticateToken, getAppointmentsByUser);
// router.get('/by-role',authenticateToken,);
router.get('/by-doctor', authenticateToken, getDoctorReport);
// router.put('/lock/:id', lockAppointment);
// router.put('/unlock/:id', unlockAppointment);
// Route to lock an appointment
router.put('/:id/lock', authenticateToken, lockAppointment);

// Route to unlock an appointment
router.put('/:id/unlock', authenticateToken, unlockAppointment);
router.put('/:id/schedule-completion', scheduleCompletion);


export default router;
