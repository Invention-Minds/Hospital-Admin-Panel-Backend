import express from 'express';
import {
  getAllWards,
  getWardDetails,
  createWard,
  updateWard,
  getAllBeds,
  getBedById,
  getAvailableBeds,
  updateBedStatus,
  createBedsForWard,
  getBedCensus,
  getBedCensusReport,
  getBedCensusSnapshot,
  getOccupancyTrends,
  reserveBed,
  cancelBedReservation,
  markBedMaintenance,
  completeBedMaintenance,
  getWardStats,
  downloadBedCensusReport,
} from './ward-management.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

// Ward routes
router.get('/wards', getAllWards);
router.get('/ward/:wardId', getWardDetails);
router.post('/wards', createWard);
router.post('/ward', createWard); // Legacy alias
router.put('/ward/:wardId', updateWard);

// Bed routes
router.get('/beds', getAllBeds);
router.get('/beds/available', getAvailableBeds);
router.get('/bed/:bedId', getBedById);
router.put('/bed/:bedId/status', updateBedStatus);
router.post('/ward/:wardId/beds', createBedsForWard);

// Bed reservation & maintenance
router.post('/bed/:bedId/reserve', reserveBed);
router.post('/bed/:bedId/cancel-reserve', cancelBedReservation);
router.post('/bed/:bedId/maintenance', markBedMaintenance);
router.post('/bed/:bedId/maintenance-complete', completeBedMaintenance);

// Census & reports
router.get('/bed-census', getBedCensus);
router.get('/bed-census/snapshot', authenticateToken, getBedCensusSnapshot); // Sprint 4a Phase 1e — historical daily snapshot
router.get('/census-report', getBedCensusReport); // Legacy alias
router.get('/bed-census-report', getBedCensusReport);
router.get('/bed-census-report/download', downloadBedCensusReport);
router.get('/occupancy-trends', getOccupancyTrends);
router.get('/stats', getWardStats);

export default router;
