import express from 'express';
import {
  createSurveillance, listSurveillance, deleteSurveillance,
  upsertDeviceDay, listDeviceDays, deleteDeviceDay,
  createSterilizationCycle, listSterilizationCycles, deleteSterilizationCycle,
} from './quality-surveillance.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

// Phase 9.26 / Phase 5b — three sibling sub-routers mounted in index.ts
// at distinct paths. Single file because each surface is small.

export const surveillanceEventsRouter = express.Router();
surveillanceEventsRouter.get('/', authenticateToken, listSurveillance);
surveillanceEventsRouter.post('/', authenticateToken, requireClinicalActor, createSurveillance);
surveillanceEventsRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteSurveillance);

export const deviceDaysRouter = express.Router();
deviceDaysRouter.get('/', authenticateToken, listDeviceDays);
deviceDaysRouter.post('/', authenticateToken, requireClinicalActor, upsertDeviceDay);
deviceDaysRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteDeviceDay);

export const sterilizationCyclesRouter = express.Router();
sterilizationCyclesRouter.get('/', authenticateToken, listSterilizationCycles);
sterilizationCyclesRouter.post('/', authenticateToken, requireClinicalActor, createSterilizationCycle);
sterilizationCyclesRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteSterilizationCycle);
