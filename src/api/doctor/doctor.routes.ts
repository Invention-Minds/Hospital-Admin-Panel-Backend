import { Router } from 'express';

import { createDoctor, getDoctors, getDoctorById, updateDoctor, deleteDoctor, getDoctorAvailability, getBookedSlots, addBookedSlot, addUnavailableDates, getUnavailableDates, getAvailableDoctors, getAvailableDoctorsCount, getUnavailableSlots, markDatesAsAvailable,addUnavailableSlots, cancelBookedSlot } from './doctor.controller';
import {authenticateToken} from './../../middleware/middleware'
const router = Router();



// Define routes for doctors
router.post('/',authenticateToken, createDoctor);  // Changed from '/doctors' to '/'
router.get('/', getDoctors);      // Changed from '/doctors' to '/'
router.get('/availability',getDoctorAvailability);
router.get('/booked-slots',getBookedSlots);
router.post('/booked-slots',authenticateToken, addBookedSlot);
router.post('/cancel-booked-slot', authenticateToken, cancelBookedSlot);
router.post('/unavailable-dates',authenticateToken, addUnavailableDates); // New endpoint for adding unavailable dates
router.get('/unavailable-dates', getUnavailableDates); // New endpoint for getting unavailable dates
router.get('/:id/unavailableSlots', getUnavailableSlots);

// POST: Add unavailable slots for a specific doctor
router.post('/unavailableSlots', authenticateToken, addUnavailableSlots);// New endpoint for getting unavailable slots
router.patch('/:doctorId/mark-available', markDatesAsAvailable);
router.get('/:id', async (req, res) => {
  await getDoctorById(req, res);  // Awaiting to ensure proper response flow
});
router.put('/:id',authenticateToken, updateDoctor);
router.delete('/:id', authenticateToken,deleteDoctor);
router.get('/available',authenticateToken, getAvailableDoctors);
router.get('/available/count',authenticateToken, getAvailableDoctorsCount);





export default router;

