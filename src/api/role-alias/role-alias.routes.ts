import express from 'express';
import { listAliases, createAlias, updateAlias, deleteAlias } from './role-alias.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

router.get('/', authenticateToken, listAliases);
router.post('/', authenticateToken, createAlias);
router.put('/:id', authenticateToken, updateAlias);
router.delete('/:id', authenticateToken, deleteAlias);

export default router;
