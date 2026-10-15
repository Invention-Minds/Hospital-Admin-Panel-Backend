import express from 'express';
import {
  createDrug, listDrugs, updateDrug, deleteDrug,
  createStockEvent, listStockEvents, deleteStockEvent,
} from './quality-pharmacy.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireQualityTeam, requireQualityViewer } from '../_shared/quality-roles';

// Phase 9.26 / Phase 5g — two sibling sub-routers mounted in index.ts.
// Reads: Quality viewers; writes: Quality team (see _shared/quality-roles.ts).
const guard = [authenticateToken, requireQualityTeam];
const view = [authenticateToken, requireQualityViewer];

export const criticalDrugsRouter = express.Router();
criticalDrugsRouter.get('/', ...view, listDrugs);
criticalDrugsRouter.post('/', ...guard, createDrug);
criticalDrugsRouter.put('/:id', ...guard, updateDrug);
criticalDrugsRouter.delete('/:id', ...guard, deleteDrug);

export const stockEventsRouter = express.Router();
stockEventsRouter.get('/', ...view, listStockEvents);
stockEventsRouter.post('/', ...guard, createStockEvent);
stockEventsRouter.delete('/:id', ...guard, deleteStockEvent);
