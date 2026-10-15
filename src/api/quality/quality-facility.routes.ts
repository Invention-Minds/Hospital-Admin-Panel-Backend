import express from 'express';
import {
  createEquipment, listEquipment, updateEquipment, deleteEquipment,
  createEquipmentEvent, listEquipmentEvents, resolveEquipmentEvent, deleteEquipmentEvent,
  createUtilityFailure, listUtilityFailures, deleteUtilityFailure,
  createAmbulanceCall, listAmbulanceCalls, deleteAmbulanceCall,
  createMaintenanceComplaint, listMaintenanceComplaints, updateMaintenanceStatus, deleteMaintenanceComplaint,
} from './quality-facility.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

// Phase 9.26 / Phase 5f — five sibling sub-routers mounted in index.ts.
// Reads: Quality viewers; writes: Quality team (see _shared/quality-roles.ts).
const guard = [authenticateToken, requireQualityTeam];
const view = [authenticateToken, requireQualityViewer];

export const equipmentRouter = express.Router();
equipmentRouter.get('/', ...view, listEquipment);
equipmentRouter.post('/', ...guard, createEquipment);
equipmentRouter.put('/:id', ...guard, updateEquipment);
equipmentRouter.delete('/:id', ...guard, deleteEquipment);

export const equipmentEventsRouter = express.Router();
equipmentEventsRouter.get('/', ...view, listEquipmentEvents);
equipmentEventsRouter.post('/', ...guard, createEquipmentEvent);
equipmentEventsRouter.put('/:id/resolve', ...guard, resolveEquipmentEvent);
equipmentEventsRouter.delete('/:id', ...guard, deleteEquipmentEvent);

export const utilityFailuresRouter = express.Router();
utilityFailuresRouter.get('/', ...view, listUtilityFailures);
utilityFailuresRouter.post('/', ...guard, createUtilityFailure);
utilityFailuresRouter.delete('/:id', ...guard, deleteUtilityFailure);

export const ambulanceCallsRouter = express.Router();
ambulanceCallsRouter.get('/', ...view, listAmbulanceCalls);
ambulanceCallsRouter.post('/', ...guard, createAmbulanceCall);
ambulanceCallsRouter.delete('/:id', ...guard, deleteAmbulanceCall);

export const maintenanceComplaintsRouter = express.Router();
maintenanceComplaintsRouter.get('/', ...view, listMaintenanceComplaints);
maintenanceComplaintsRouter.post('/', ...guard, createMaintenanceComplaint);
maintenanceComplaintsRouter.put('/:id/status', ...guard, updateMaintenanceStatus);
maintenanceComplaintsRouter.delete('/:id', ...guard, deleteMaintenanceComplaint);
