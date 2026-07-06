import { Router } from 'express';
import { listBlocks, unblock, createBlock } from './security.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';

const router = Router();

// All routes: super_admin only.
const superAdmin = requireRole({ roles: [] }); // allowSuperAdmin defaults true; roles empty = super_admin only

router.get('/blocks', authenticateToken, superAdmin, listBlocks);
router.post('/blocks', authenticateToken, superAdmin, createBlock);
router.post('/blocks/:ip/unblock', authenticateToken, superAdmin, unblock);

export default router;
