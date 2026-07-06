import express from 'express';
import {
  createDrug, listDrugs, updateDrug, deleteDrug,
  createStockEvent, listStockEvents, deleteStockEvent,
} from './quality-pharmacy.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

// Phase 9.26 / Phase 5g — two sibling sub-routers mounted in index.ts.

export const criticalDrugsRouter = express.Router();
criticalDrugsRouter.get('/', authenticateToken, listDrugs);
criticalDrugsRouter.post('/', authenticateToken, requireClinicalActor, createDrug);
criticalDrugsRouter.put('/:id', authenticateToken, requireClinicalActor, updateDrug);
criticalDrugsRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteDrug);

export const stockEventsRouter = express.Router();
stockEventsRouter.get('/', authenticateToken, listStockEvents);
stockEventsRouter.post('/', authenticateToken, requireClinicalActor, createStockEvent);
stockEventsRouter.delete('/:id', authenticateToken, requireClinicalActor, deleteStockEvent);
