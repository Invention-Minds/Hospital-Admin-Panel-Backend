import express from 'express';
import {
  createCallbackRequest,
  getAllCallbackRequests,
  addCallbackNote,
  markCallbackHandled,
  cancelCallbackRequest
} from './callback.controller'

const router = express.Router();

/**
 * PUBLIC (Website)
 */
router.post('/', createCallbackRequest);

/**
 * ADMIN
 */
router.get('/', getAllCallbackRequests);
router.patch('/:id/note', addCallbackNote);
router.patch('/:id/handle', markCallbackHandled);
router.patch('/:id/cancel', cancelCallbackRequest);

export default router;
