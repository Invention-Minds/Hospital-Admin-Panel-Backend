import { Router } from 'express';
import {
  listRecipients,
  getPhones,
  listGroups,
  createRecipient,
  updateRecipient,
  deleteRecipient,
} from './notification-recipient.controller';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';

const router = Router();

// Read: any authenticated user (frontend needs the numbers to send to).
router.get('/', authenticateToken, listRecipients);
router.get('/groups', authenticateToken, listGroups);
router.get('/phones/:group', authenticateToken, getPhones);

// Write: admin only (super_admin auto-allowed by requireRole).
const adminOnly = requireRole({ roles: ['admin', 'sub_admin'] });
router.post('/', authenticateToken, adminOnly, createRecipient);
router.patch('/:id', authenticateToken, adminOnly, updateRecipient);
router.delete('/:id', authenticateToken, adminOnly, deleteRecipient);

export default router;
