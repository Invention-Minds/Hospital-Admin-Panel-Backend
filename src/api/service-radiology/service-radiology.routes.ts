import { Router } from 'express';
import {
  createService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
  updateServiceStatus,
  getPackages,
  lockService,
  unlockService,

  updateServiceMessage,
  getAvailableSlots,
  createNewService,
  getAppointmentByServiceId,
  getDetailsByPRN,
} from './service-radiology.controller';
// import {scheduleServiceCompletion} from './services.schedular';
import { authenticateToken } from './../../middleware/middleware';

const router = Router();

// Define routes for Service management

// CRUD routes
router.post('/', createService); // Create a new service
router.get('/', getServices);  
router.get('/packages', getPackages)
router.get('/available-slots', getAvailableSlots);
router.post('/new',createNewService);
router.get('/appts-by-serviceId', getAppointmentByServiceId);// Fetch all services
router.post('/get-details-by-prn', getDetailsByPRN)
router.get('/:id', getServiceById);                 // Fetch a specific service by ID
router.put('/:id', authenticateToken, updateServiceStatus); // Update a service by ID
router.delete('/:id', authenticateToken, deleteService); // Delete a service by ID
router.put('/:id/update', authenticateToken, updateService);
router.put('/:id/update-message', authenticateToken, updateServiceMessage);
router.put('/:id/lock', lockService);
router.put('/:id/unlock', unlockService);

export default router;
