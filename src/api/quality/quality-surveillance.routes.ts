import express from 'express';
import {
  createSurveillance, listSurveillance, deleteSurveillance,
  upsertDeviceDay, listDeviceDays, deleteDeviceDay,
  createSterilizationCycle, listSterilizationCycles, deleteSterilizationCycle,
} from './quality-surveillance.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireInfectionControl, requireInfectionControlViewer } from '../_shared/quality-roles';

// Phase 9.26 / Phase 5b — three sibling sub-routers mounted in index.ts
// at distinct paths. Single file because each surface is small.
// Writes: Quality team + Infection Control Nurse; reads also Quality viewers
// (see _shared/quality-roles.ts).
const guard = [authenticateToken, requireInfectionControl];
const view = [authenticateToken, requireInfectionControlViewer];

export const surveillanceEventsRouter = express.Router();
surveillanceEventsRouter.get('/', ...view, listSurveillance);
surveillanceEventsRouter.post('/', ...guard, createSurveillance);
surveillanceEventsRouter.delete('/:id', ...guard, deleteSurveillance);

export const deviceDaysRouter = express.Router();
deviceDaysRouter.get('/', ...view, listDeviceDays);
deviceDaysRouter.post('/', ...guard, upsertDeviceDay);
deviceDaysRouter.delete('/:id', ...guard, deleteDeviceDay);

export const sterilizationCyclesRouter = express.Router();
sterilizationCyclesRouter.get('/', ...view, listSterilizationCycles);
sterilizationCyclesRouter.post('/', ...guard, createSterilizationCycle);
sterilizationCyclesRouter.delete('/:id', ...guard, deleteSterilizationCycle);
