import { Router } from 'express';
import {
    createAppointment, getAppointments, updateAppointment, deleteAppointment, getTotalAppointments,
    getPendingAppointments, getAppointmentsByUser, getDoctorReport, lockAppointment, unlockAppointment
} from './appointment.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.post('/', authenticateToken, createAppointment);
router.get('/', getAppointments);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);
router.get('/total', getTotalAppointments);
router.get('/pending', getPendingAppointments);
router.get('/by-user', getAppointmentsByUser);
// router.get('/by-role',authenticateToken,);
router.get('/by-doctor', getDoctorReport);
router.put('/lock/:id', lockAppointment);
router.put('/unlock/:id', unlockAppointment);

export default router;
