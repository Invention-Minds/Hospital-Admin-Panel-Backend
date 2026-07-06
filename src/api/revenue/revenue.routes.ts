import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import {
  paymentWebhook,
  markPaid,
  getRevenueReport,
  recomputeRollup,
} from './revenue.controller';

const router = express.Router();

// Reports — any authenticated user with management visibility (refine with role gate later).
router.get('/', authenticateToken, getRevenueReport);

// Manual cash-counter mark-paid.
router.post('/payment/mark-paid', authenticateToken, markPaid);

// HMIS payment webhook. NOTE: in production this should authenticate using
// a shared secret / IP allowlist rather than the user JWT. Auth strategy
// for HMIS webhooks is a separate piece of work — for now keep it open and
// flag in the audit log as source='hmis-webhook'.
router.post('/payment/webhook', paymentWebhook);

// Manual recompute (also called by the nightly cron — see revenue.cron.ts).
router.post('/recompute', authenticateToken, recomputeRollup);

export default router;
