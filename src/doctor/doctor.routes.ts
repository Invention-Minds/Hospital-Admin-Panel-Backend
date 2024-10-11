import express from 'express';
import { createDoctor, getDoctors, getDoctorById, updateDoctor, deleteDoctor, getDoctorAvailability,getBookedSlots,addBookedSlot } from './doctor.controller';

const router = express.Router();

// Define routes for doctors
router.post('/', createDoctor);  // Changed from '/doctors' to '/'
router.get('/', getDoctors);      // Changed from '/doctors' to '/'
router.get('/availability', getDoctorAvailability);
router.get('/booked-slots', getBookedSlots);
router.post('/booked-slots', addBookedSlot);
router.get('/:id', async (req, res) => {
    await getDoctorById(req, res);  // Awaiting to ensure proper response flow
  });
router.put('/:id', updateDoctor);
router.delete('/:id', deleteDoctor);



export default router;
