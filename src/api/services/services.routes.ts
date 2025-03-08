import { Router } from 'express';
import {
  createService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
  addRepeatedDates,
  getRepeatedDatesByServiceId,
  processRepeatedAppointments,
  stopRepeat,
  getAvailableSlots,
  updateServiceStatus,
  getPackages,
  lockService,
  unlockService,
  callRepeatedAppointments,
  updateServiceMessage,
} from './services.controller';
import {scheduleServiceCompletion} from './services.schedular';
import { authenticateToken } from './../../middleware/middleware';

const router = Router();

// Define routes for Service management

// CRUD routes
router.post('/', createService); // Create a new service
router.get('/', getServices);  
router.get('/packages', getPackages)
router.get('/available-slots', getAvailableSlots)                     // Fetch all services
router.get('/:id', getServiceById);                 // Fetch a specific service by ID
router.put('/:id', authenticateToken, updateServiceStatus); // Update a service by ID
router.delete('/:id', authenticateToken, deleteService); // Delete a service by ID
router.post('/call-repeat',callRepeatedAppointments)
// Repeated Dates Management
router.post('/:id/repeated-dates', authenticateToken, addRepeatedDates); // Add repeated dates for a service
router.get('/:id/repeated-dates', getRepeatedDatesByServiceId);         // Get repeated dates for a specific service

// Example: Mark services as complete or unavailable if needed (custom actions)
router.put('/:id/update', authenticateToken, updateService);
router.put('/:id/update-message', authenticateToken, updateServiceMessage);
router.post('/process-repeated-appointments', processRepeatedAppointments);
router.post('/stop-repeat', stopRepeat);
router.post('/schedule-completion', scheduleServiceCompletion);


router.put('/:id/lock', lockService);


// Route to unlock a service
router.put('/:id/unlock', unlockService);



// Additional endpoints
// router.get('/:id/details', authenticateToken, getServiceById); // Custom detailed route if needed

export default router;
