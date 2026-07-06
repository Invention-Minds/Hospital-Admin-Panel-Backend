import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  openClosure,
  listClosures,
  getClosure,
  submitClosure,
} from './daily-closure.controller';

const router = express.Router();

router.get('/', authenticateToken, listClosures);
router.get('/:id', authenticateToken, getClosure);
router.post('/', authenticateToken, requireClinicalActor, openClosure);
router.post('/:id/submit', authenticateToken, requireClinicalActor, submitClosure);

export default router;
