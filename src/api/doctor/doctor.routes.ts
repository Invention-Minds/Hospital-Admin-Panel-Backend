import { Router } from 'express';

import { createDoctor, getDoctors, getDoctorById, updateDoctor, deleteDoctor, getDoctorAvailability, getBookedSlots, addBookedSlot, addUnavailableDates, getUnavailableDates, getAvailableDoctors, getAvailableDoctorsCount, getUnavailableSlots, markDatesAsAvailable,addUnavailableSlots, cancelBookedSlot, getUnavailableSlotsByDate, updateBookedSlot , getFutureBookedSlots, addExtraSlot, getExtraSlots, getFutureBookedSlotsBoth, getDoctorDetails, getDoctorByUserId, updateRoomNo, addUnavailableDatesBulk, getBulkFutureBookedSlots, getAllDoctorWithDepartment, getFourDoctors} from './doctor.controller';
import {authenticateToken} from './../../middleware/middleware'
import { get } from 'http';
const router = Router();



// Define routes for doctors
router.post('/',authenticateToken, createDoctor);  // Changed from '/doctors' to '/'
router.get('/', getDoctors);      // Changed from '/doctors' to '/'
router.get('/top-doctors', getFourDoctors);
router.get('/get-doctor-details',authenticateToken,getDoctorDetails)
router.get('/availability',getDoctorAvailability);
router.get('/booked-slots',getBookedSlots);
router.post('/booked-slots',authenticateToken, addBookedSlot);
router.post('/cancel-booked-slot', authenticateToken, cancelBookedSlot);
router.post('/unavailable-dates',authenticateToken, addUnavailableDates); // New endpoint for adding unavailable dates
router.post('/add-unavailable-dates', addUnavailableDatesBulk);
router.get('/unavailable-dates', getUnavailableDates); // New endpoint for getting unavailable dates
router.get('/:id/unavailableSlots', getUnavailableSlots);
router.get('/unavailableSlotsbyDate/:docId/:date', getUnavailableSlotsByDate);
router.get('/docbydept', getAllDoctorWithDepartment)
router.post('/mark-complete', updateBookedSlot),
router.get('/futureBookedSlots', getFutureBookedSlotsBoth);
router.get('/futureslotsForSlotDuration',getFutureBookedSlots);
router.post('/bulk-future-slots', getBulkFutureBookedSlots);

router.get('/get-doctor-by-userId/:userId', authenticateToken, getDoctorByUserId)

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
router.post('/add-extra-slots',authenticateToken, addExtraSlot);
router.get('/:id/extraslots', getExtraSlots);
router.put('/:doctorId/room', updateRoomNo);







export default router;

