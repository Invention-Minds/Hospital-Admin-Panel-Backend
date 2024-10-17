import { Router } from 'express';

import { createDoctor, getDoctors, getDoctorById, updateDoctor, deleteDoctor, getDoctorAvailability, getBookedSlots, addBookedSlot, addUnavailableDates, getUnavailableDates, getAvailableDoctors, getAvailableDoctorsCount } from './doctor.controller';

const router = Router();


// Define routes for doctors
router.post('/', createDoctor);  // Changed from '/doctors' to '/'
router.get('/', getDoctors);      // Changed from '/doctors' to '/'
router.get('/availability', getDoctorAvailability);
router.get('/booked-slots', getBookedSlots);
router.post('/booked-slots', addBookedSlot);
router.post('/unavailable-dates', addUnavailableDates); // New endpoint for adding unavailable dates
router.get('/unavailable-dates', getUnavailableDates); // New endpoint for getting unavailable dates
router.get('/:id', async (req, res) => {
  await getDoctorById(req, res);  // Awaiting to ensure proper response flow
});
router.put('/:id', updateDoctor);
router.delete('/:id', deleteDoctor);
router.get('/available', getAvailableDoctors);
router.get('/available/count', getAvailableDoctorsCount);





export default router;

