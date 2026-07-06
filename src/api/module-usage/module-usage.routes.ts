import { Router } from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import { getModuleUsageSummary } from './module-usage.controller';

const router = Router();

// Management-facing analytics: admins only (super_admin always passes
// requireRole by default). Mirrors the adminOnly gate in login.routes.ts.
const adminOnly = requireRole({ roles: ['admin'] });

router.get('/summary', authenticateToken, adminOnly, getModuleUsageSummary);

export default router;
