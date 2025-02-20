import { Router } from 'express';
import {
    createAppointment, getAppointments, updateAppointment, deleteAppointment, getTotalAppointments,
    getPendingAppointments, getAppointmentsByUser, getDoctorReport, lockAppointment, unlockAppointment, scheduleCompletion,registerForUpdates,checkInAppointment,
    getAppointmentsBySlot,
    getAllNotifications,
    deleteNotification,
    updateExtraWaitingTime,
    bulkUpdateAppointments,
    bulkUpdateAccepted,
    bulkUpdateCancel,
    getAppointmentByServiceId,
    createNewAppointment
} from './appointment.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();
router.get('/updates', registerForUpdates);
router.post('/', createAppointment);
router.post('/new', createNewAppointment);
router.put('/bulk-updates-accept', bulkUpdateAccepted);
router.get('/', authenticateToken, getAppointments);
router.put('/bulk-cancel', authenticateToken, bulkUpdateCancel)
router.put('/bulk-update', bulkUpdateAppointments);
router.put('/:id', authenticateToken, updateAppointment);
router.delete('/:id', authenticateToken, deleteAppointment);
router.get('/total', authenticateToken, getTotalAppointments);
router.get('/pending', authenticateToken, getPendingAppointments);
router.get('/by-user', authenticateToken, getAppointmentsByUser);
// router.get('/by-role',authenticateToken,);
router.get('/by-doctor', getDoctorReport);
router.get('/slotsbyappointments',authenticateToken,getAppointmentsBySlot)
router.get('/appts-by-serviceId', getAppointmentByServiceId)
// router.put('/lock/:id', lockAppointment);
// router.put('/unlock/:id', unlockAppointment);
// Route to lock an appointment
router.put('/:id/lock', authenticateToken, lockAppointment);

// Route to unlock an appointment
router.put('/:id/unlock', authenticateToken, unlockAppointment);
router.put('/:id/schedule-completion', scheduleCompletion);
router.put('/:id/checkin', authenticateToken, checkInAppointment);
router.put('/:id/waitingTime', updateExtraWaitingTime);
router.get('/notifications', getAllNotifications);
router.delete('/notifications/:id', deleteNotification);



export default router;
