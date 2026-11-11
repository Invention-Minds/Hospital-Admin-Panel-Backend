import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import { activityUsers, activityTimeline, activityFacets } from './activity-log.controller';

// User-activity log — super_admin only (requireRole with no roles = super_admin).
const router = express.Router();
const superAdminOnly = requireRole({});

router.get('/users', authenticateToken, superAdminOnly, activityUsers);
router.get('/facets', authenticateToken, superAdminOnly, activityFacets);
router.get('/', authenticateToken, superAdminOnly, activityTimeline);

export default router;
