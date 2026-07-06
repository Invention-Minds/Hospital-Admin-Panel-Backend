import express from 'express';
import {
  createCallbackRequest,
  getAllCallbackRequests,
  addCallbackNote,
  markCallbackHandled,
  cancelCallbackRequest
} from './callback.controller'
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

/**
 * PUBLIC (Website) — patient callback request form, no auth by design.
 */
router.post('/', createCallbackRequest);

/**
 * ADMIN — staff view/handle callback requests. JWT required.
 */
router.get('/', authenticateToken, getAllCallbackRequests);
router.patch('/:id/note', authenticateToken, addCallbackNote);
router.patch('/:id/handle', authenticateToken, markCallbackHandled);
router.patch('/:id/cancel', authenticateToken, cancelCallbackRequest);

export default router;
