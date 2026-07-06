import express from 'express';
import {
  getCodes, activateCode, listActivations, resolveActivation, getSuggestions, markAttended,
} from './emergency-codes.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

// Phase 9.20 — Hospital emergency codes.
router.get('/', authenticateToken, getCodes);                       // fixed code registry
router.get('/suggestions', authenticateToken, getSuggestions);      // auto-suggest Blue/Yellow
router.get('/activations', authenticateToken, listActivations);     // active (or ?all=true)
router.post('/activate', authenticateToken, activateCode);
router.post('/activations/:id/attend', authenticateToken, markAttended);
router.post('/activations/:id/resolve', authenticateToken, resolveActivation);

export default router;
