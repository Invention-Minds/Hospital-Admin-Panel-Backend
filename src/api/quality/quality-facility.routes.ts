import express from 'express';
import {
  createEquipment, listEquipment, updateEquipment, deleteEquipment,
  createEquipmentEvent, listEquipmentEvents, deleteEquipmentEvent,
  createUtilityFailure, listUtilityFailures, deleteUtilityFailure,
  createAmbulanceCall, listAmbulanceCalls, deleteAmbulanceCall,
  createMaintenanceComplaint, listMaintenanceComplaints, updateMaintenanceStatus, deleteMaintenanceComplaint,
} from './quality-facility.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

// Phase 9.26 / Phase 5f — five sibling sub-routers mounted in index.ts.

export const equipmentRouter = express.Router();
equipmentRouter.get('/', authenticateToken, listEquipment);
equipmentRouter.post('/', authenticateToken, requireClinicalActor, createEquipment);
equipmentRouter.put('/:id', authenticateToken, requireClinicalActor, updateEquipment);
equipmentRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteEquipment);

export const equipmentEventsRouter = express.Router();
equipmentEventsRouter.get('/', authenticateToken, listEquipmentEvents);
equipmentEventsRouter.post('/', authenticateToken, requireClinicalActor, createEquipmentEvent);
equipmentEventsRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteEquipmentEvent);

export const utilityFailuresRouter = express.Router();
utilityFailuresRouter.get('/', authenticateToken, listUtilityFailures);
utilityFailuresRouter.post('/', authenticateToken, requireClinicalActor, createUtilityFailure);
utilityFailuresRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteUtilityFailure);

export const ambulanceCallsRouter = express.Router();
ambulanceCallsRouter.get('/', authenticateToken, listAmbulanceCalls);
ambulanceCallsRouter.post('/', authenticateToken, requireClinicalActor, createAmbulanceCall);
ambulanceCallsRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteAmbulanceCall);

export const maintenanceComplaintsRouter = express.Router();
maintenanceComplaintsRouter.get('/', authenticateToken, listMaintenanceComplaints);
maintenanceComplaintsRouter.post('/', authenticateToken, requireClinicalActor, createMaintenanceComplaint);
maintenanceComplaintsRouter.put('/:id/status', authenticateToken, requireClinicalActor, updateMaintenanceStatus);
maintenanceComplaintsRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteMaintenanceComplaint);
