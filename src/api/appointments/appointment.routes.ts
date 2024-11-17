import { Router } from 'express';
import {
    createAppointment, getAppointments, updateAppointment, deleteAppointment, getTotalAppointments,
    getPendingAppointments, getAppointmentsByUser, getDoctorReport, lockAppointment, unlockAppointment, scheduleCompletion,registerForUpdates,checkInAppointment,
    getAppointmentsBySlot
} from './appointment.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();
router.get('/updates', registerForUpdates);
router.post('/', createAppointment);
router.get('/', authenticateToken, getAppointments);
router.put('/:id', authenticateToken, updateAppointment);
router.delete('/:id', authenticateToken, deleteAppointment);
router.get('/total', authenticateToken, getTotalAppointments);
router.get('/pending', authenticateToken, getPendingAppointments);
router.get('/by-user', authenticateToken, getAppointmentsByUser);
// router.get('/by-role',authenticateToken,);
router.get('/by-doctor', authenticateToken, getDoctorReport);
router.get('/slotsbyappointments',authenticateToken,getAppointmentsBySlot)
// router.put('/lock/:id', lockAppointment);
// router.put('/unlock/:id', unlockAppointment);
// Route to lock an appointment
router.put('/:id/lock', authenticateToken, lockAppointment);

// Route to unlock an appointment
router.put('/:id/unlock', authenticateToken, unlockAppointment);
router.put('/:id/schedule-completion', scheduleCompletion);
router.put('/:id/checkin', authenticateToken, checkInAppointment);



export default router;
