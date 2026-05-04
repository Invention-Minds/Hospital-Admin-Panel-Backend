import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { listFlags, getFlag, createFlag, updateFlag } from './feature-flag.controller';

const router = express.Router();

router.get('/', authenticateToken, listFlags);
router.get('/:flagKey', authenticateToken, getFlag);
router.post('/', authenticateToken, createFlag);
router.patch('/:flagKey', authenticateToken, updateFlag);

export default router;
