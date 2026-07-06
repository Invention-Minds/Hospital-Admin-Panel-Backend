import { Router } from 'express';
import { createSurgeon, getSurgeons, updateSurgeon } from './surgeon.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.get('/', getSurgeons);
router.post('/', authenticateToken, createSurgeon);
router.put('/:id', authenticateToken, updateSurgeon);

export default router;
