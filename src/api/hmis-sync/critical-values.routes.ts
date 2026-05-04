import express, { Request, Response } from 'express';
import {
  subscribeToCriticalValues,
  getActiveUsers,
  broadcastCriticalValueAlert,
  getAlertBuffer,
  getAlertAcknowledgments,
  acknowledgeAlertById,
} from './critical-value-sse';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

/**
 * SSE Stream for critical value alerts
 */
router.get('/stream', (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'anonymous';
  console.log(`📡 New SSE connection from user: ${userId}`);
  subscribeToCriticalValues(userId, res);
});

/**
 * Active SSE users
 */
router.get('/active-users', (_req: Request, res: Response) => {
  const activeUsers = getActiveUsers();
  res.status(200).json({
    message: 'Active users subscribed to critical value stream',
    count: activeUsers.length,
    users: activeUsers,
  });
});

/**
 * Manual broadcast of critical value (for testing).
 * Sprint 4b.2 — now requires JWT. Previously unauthenticated; anyone could
 * fire fake critical-value alerts. No identity stamped on the alert itself
 * (the broadcast is in-memory + SSE only), but the endpoint is now gated.
 */
router.post('/broadcast', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { prn, testName, result, criticalLevel, type, referenceRange, unit, reportUrl } = req.body;

    if (!prn || !testName || !result || !criticalLevel || !type) {
      res.status(400).json({
        message: 'Missing required fields: prn, testName, result, criticalLevel, type',
      });
      return;
    }

    const alert = {
      id: `manual-${Date.now()}`,
      timestamp: new Date(),
      prn,
      testName,
      result,
      criticalLevel,
      type,
      referenceRange,
      unit,
      reportUrl,
    };

    await broadcastCriticalValueAlert(alert);

    res.status(200).json({
      message: 'Critical value alert broadcast successfully',
      data: alert,
    });
  } catch (error) {
    console.error('Error broadcasting critical value:', error);
    res.status(500).json({
      message: 'Error broadcasting critical value',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get all critical alerts (history) — supports ?fromDate=&toDate=&limit=&prn=
 */
router.get('/alerts', (req: Request, res: Response) => {
  const { fromDate, toDate, limit, prn } = req.query;
  let alerts = getAlertBuffer();
  const ack = getAlertAcknowledgments();

  if (prn) alerts = alerts.filter((a) => a.prn === prn);

  if (fromDate && toDate) {
    const start = new Date(fromDate as string).getTime();
    const end = new Date(toDate as string).getTime();
    alerts = alerts.filter((a) => {
      const t = new Date(a.timestamp).getTime();
      return t >= start && t <= end;
    });
  }

  // Augment with acknowledgment info
  const enriched = alerts.map((a) => ({
    ...a,
    acknowledged: ack.has(a.id),
    acknowledgment: ack.get(a.id),
  }));

  const sliced = limit ? enriched.slice(-parseInt(limit as string)) : enriched;
  res.status(200).json({ message: 'Alerts retrieved', data: sliced });
});

/**
 * Get alerts for a specific patient
 */
router.get('/alerts/:prn', (req: Request, res: Response) => {
  const { prn } = req.params;
  const alerts = getAlertBuffer().filter((a) => a.prn === prn);
  const ack = getAlertAcknowledgments();
  const enriched = alerts.map((a) => ({
    ...a,
    acknowledged: ack.has(a.id),
    acknowledgment: ack.get(a.id),
  }));
  res.status(200).json({ message: 'Patient alerts retrieved', data: enriched });
});

/**
 * Acknowledge a critical alert — NABH MRD.1 server-derived identity
 * (Sprint 4a Phase 1d). Any `acknowledgedBy` value in the request body
 * is IGNORED; attribution comes from the JWT via `authenticateToken`.
 * This closes the impersonation loophole where a client could self-
 * attribute to arbitrary usernames.
 */
router.post(
  '/alerts/:alertId/acknowledge',
  authenticateToken,
  (req: Request, res: Response) => {
    const { alertId } = req.params;
    const acknowledgedBy = req.user?.username;
    if (!acknowledgedBy) {
      // authenticateToken guarantees req.user; defensive check for NABH audit.
      res.status(401).json({ error: 'Authentication required for acknowledgment' });
      return;
    }

    const ok = acknowledgeAlertById(alertId, acknowledgedBy);
    if (!ok) {
      res.status(404).json({ message: 'Alert not found in buffer' });
      return;
    }

    res.status(200).json({
      message: 'Alert acknowledged',
      data: { alertId, acknowledgedBy, acknowledgedAt: new Date() },
    });
  }
);

/**
 * Critical value statistics
 */
router.get('/stats', (req: Request, res: Response) => {
  const { fromDate, toDate } = req.query;
  let alerts = getAlertBuffer();
  const ack = getAlertAcknowledgments();

  if (fromDate && toDate) {
    const start = new Date(fromDate as string).getTime();
    const end = new Date(toDate as string).getTime();
    alerts = alerts.filter((a) => {
      const t = new Date(a.timestamp).getTime();
      return t >= start && t <= end;
    });
  }

  const total = alerts.length;
  const critical = alerts.filter((a) => a.criticalLevel === 'critical').length;
  const high = alerts.filter((a) => a.criticalLevel === 'high').length;
  const low = alerts.filter((a) => a.criticalLevel === 'low').length;
  const lab = alerts.filter((a) => a.type === 'lab').length;
  const radiology = alerts.filter((a) => a.type === 'radiology').length;
  const vitals = alerts.filter((a) => a.type === 'vitals').length;
  const acknowledged = alerts.filter((a) => ack.has(a.id)).length;

  res.status(200).json({
    message: 'Critical value statistics',
    data: {
      total,
      byLevel: { critical, high, low },
      byType: { lab, radiology, vitals },
      acknowledged,
      pending: total - acknowledged,
    },
  });
});

/**
 * Get pending (unacknowledged) critical values
 */
router.get('/pending', (_req: Request, res: Response) => {
  const alerts = getAlertBuffer();
  const ack = getAlertAcknowledgments();
  const pending = alerts.filter((a) => !ack.has(a.id));
  res.status(200).json({ message: 'Pending critical values', data: pending });
});

export default router;
