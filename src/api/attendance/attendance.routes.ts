import { Router } from 'express';
import {
  getTodayAttendance,
  markDoctorArrived,
  unmarkDoctorArrived,
} from './attendance.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.get('/today', authenticateToken, getTodayAttendance);
router.post('/mark', authenticateToken, markDoctorArrived);
router.post('/unmark', authenticateToken, unmarkDoctorArrived);

export default router;
