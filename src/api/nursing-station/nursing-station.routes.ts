import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import { NURSING_SUPERINTENDENT } from '../_shared/nursing-roles';
import {
  listStations,
  listMyStations,
  getStation,
  createStation,
  updateStation,
  deleteStation,
  setStationWards,
  assignNurses,
  unassignNurse,
} from './nursing-station.controller';

const router = express.Router();

// Write/management routes are owned by the Nursing Superintendent (super_admin
// passes by default in requireRole). Reads are open to any authenticated user
// so other screens (roster, dashboards) can show station context.
const manage = requireRole({ subAdminTypes: [NURSING_SUPERINTENDENT] });

router.get('/', authenticateToken, listStations);
router.get('/mine', authenticateToken, listMyStations);
router.get('/:id', authenticateToken, getStation);

router.post('/', authenticateToken, manage, createStation);
router.patch('/:id', authenticateToken, manage, updateStation);
router.delete('/:id', authenticateToken, manage, deleteStation);
router.put('/:id/wards', authenticateToken, manage, setStationWards);

router.post('/:id/nurses', authenticateToken, manage, assignNurses);
router.delete('/:id/nurses/:userId', authenticateToken, manage, unassignNurse);

export default router;
