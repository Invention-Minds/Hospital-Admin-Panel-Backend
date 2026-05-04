import { Response } from 'express';
import prisma from '../../service/prisma-client';

/**
 * Server-Sent Events (SSE) Service for Critical Value Alerts
 * Maintains persistent connections to client dashboards and pushes critical lab values in real-time
 *
 * Usage:
 * 1. Client connects: GET /api/critical-values/stream
 * 2. Server maintains connection, sends SSE updates
 * 3. When critical value received: push to all connected clients
 * 4. Client displays alert notification
 */

// Map to store active SSE connections
// Key: userId (doctor/nurse), Value: Response object
const activeConnections = new Map<string, Response[]>();

// Map to store critical value alerts for late subscribers
const criticalValueBuffer: CriticalValueAlert[] = [];
const MAX_BUFFER_SIZE = 500; // Keep last 500 alerts (larger for history lookup)

// Track acknowledgments: alertId → { acknowledgedBy, acknowledgedAt }
const alertAcknowledgments = new Map<string, { acknowledgedBy: string; acknowledgedAt: Date }>();

/**
 * Access functions for alert state — used by HTTP endpoints
 */
export const getAlertBuffer = (): CriticalValueAlert[] => [...criticalValueBuffer];

export const getAlertAcknowledgments = () => alertAcknowledgments;

export const acknowledgeAlertById = (
  alertId: string,
  acknowledgedBy: string
): boolean => {
  const exists = criticalValueBuffer.some((a) => a.id === alertId);
  if (!exists) return false;
  alertAcknowledgments.set(alertId, {
    acknowledgedBy,
    acknowledgedAt: new Date(),
  });
  return true;
};

export interface CriticalValueAlert {
  id: string;
  timestamp: Date;
  prn: string;
  patientName?: string;
  testName: string;
  result: string;
  referenceRange?: string;
  unit?: string;
  criticalLevel: 'critical' | 'high' | 'low';
  type: 'lab' | 'radiology' | 'vitals';
  reportUrl?: string;
  department?: string;
}

/**
 * Subscribe to critical value alerts via SSE
 * Client should use EventSource API:
 * const eventSource = new EventSource('/api/critical-values/stream?userId=123');
 * eventSource.addEventListener('critical-value', (event) => {
 *   const alert = JSON.parse(event.data);
 *   // Display alert in dashboard
 * });
 */
export const subscribeToCriticalValues = (
  userId: string,
  res: Response
): void => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to critical value stream' })}\n\n`);

  // Add to active connections
  if (!activeConnections.has(userId)) {
    activeConnections.set(userId, []);
  }
  activeConnections.get(userId)!.push(res);

  console.log(`✅ User ${userId} connected to critical value stream. Active connections: ${getTotalConnections()}`);

  // Send recent critical values (catch-up)
  const recentAlerts = criticalValueBuffer.slice(-10);
  recentAlerts.forEach((alert) => {
    res.write(`event: critical-value\ndata: ${JSON.stringify(alert)}\n\n`);
  });

  // Handle client disconnect
  res.on('close', () => {
    const connections = activeConnections.get(userId);
    if (connections) {
      const index = connections.indexOf(res);
      if (index > -1) {
        connections.splice(index, 1);
      }
      if (connections.length === 0) {
        activeConnections.delete(userId);
      }
    }
    console.log(`❌ User ${userId} disconnected. Active connections: ${getTotalConnections()}`);
    res.end();
  });

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`:\n\n`); // Keep-alive comment
    } catch (error) {
      clearInterval(heartbeat);
    }
  }, 30000);
};

/**
 * Broadcast critical value alert to all connected clients
 * Called when critical lab result is received
 */
export const broadcastCriticalValueAlert = async (
  alert: CriticalValueAlert
): Promise<void> => {
  try {
    // Add to buffer
    criticalValueBuffer.push(alert);
    if (criticalValueBuffer.length > MAX_BUFFER_SIZE) {
      criticalValueBuffer.shift();
    }

    // Broadcast to all connected clients
    let sentCount = 0;
    for (const [userId, connections] of activeConnections.entries()) {
      for (const res of connections) {
        try {
          res.write(`event: critical-value\ndata: ${JSON.stringify(alert)}\n\n`);
          sentCount++;
        } catch (error) {
          console.error(`Error sending to user ${userId}:`, error);
          // Connection likely closed, will be cleaned up on next heartbeat
        }
      }
    }

    console.log(`📢 Critical value alert broadcast to ${sentCount} clients: ${alert.testName} (${alert.prn})`);

    // Store alert in database for audit trail
    await storeCriticalValueAlertLog({
      prn: alert.prn,
      testName: alert.testName,
      result: alert.result,
      referenceRange: alert.referenceRange,
      criticalLevel: alert.criticalLevel,
      type: alert.type,
      clientsNotified: sentCount,
    });
  } catch (error) {
    console.error('Error broadcasting critical value alert:', error);
  }
};

/**
 * Send alert to specific user (doctor/nurse)
 */
export const sendAlertToUser = (userId: string, alert: CriticalValueAlert): boolean => {
  const connections = activeConnections.get(userId);
  if (!connections || connections.length === 0) {
    console.warn(`No active connections for user ${userId}`);
    return false;
  }

  let sentCount = 0;
  for (const res of connections) {
    try {
      res.write(`event: critical-value\ndata: ${JSON.stringify(alert)}\n\n`);
      sentCount++;
    } catch (error) {
      console.error(`Error sending to user ${userId}:`, error);
    }
  }

  return sentCount > 0;
};

/**
 * Store critical value alert in database for audit trail
 */
async function storeCriticalValueAlertLog(logData: {
  prn: string;
  testName: string;
  result: string;
  referenceRange?: string;
  criticalLevel: string;
  type: string;
  clientsNotified: number;
}): Promise<void> {
  try {
    // TODO: Create CriticalValueAlertLog model in Prisma schema
    // For now, log to audit trail
    console.log('📋 Critical value alert logged:', logData);
  } catch (error) {
    console.error('Error logging critical value alert:', error);
  }
}

/**
 * Create a critical value alert from investigation result.
 *
 * Accepts a shape compatible with a Prisma InvestigationResult row
 * (nullable `result`, `unit`, `referenceRange`, `reportUrl`; optional DB `id`).
 * When `id` is present we use it to build a stable alert id so duplicate
 * polling passes don't create duplicate alerts downstream.
 */
export const createAlertFromInvestigationResult = async (
  result: {
    id?: number;
    orderId: number;
    prn: string;
    testName: string;
    result: string | null;
    unit?: string | null;
    referenceRange?: string | null;
    criticalFlag: boolean;
    reportUrl?: string | null;
    department?: string | null;
  }
): Promise<void> => {
  if (!result.criticalFlag) {
    return; // Not critical
  }

  try {
    // Get patient details
    const patient = await prisma.patientDetails.findFirst({
      where: { prn: parseInt(result.prn) || 0 },
    });

    const resultText = result.result ?? '';
    const referenceRange = result.referenceRange ?? undefined;

    // Determine critical level based on result and reference range
    const criticalLevel = determineCriticalLevel(
      result.testName,
      resultText,
      referenceRange
    );

    const alertType: 'lab' | 'radiology' =
      result.department === 'radiology' ? 'radiology' : 'lab';

    const alert: CriticalValueAlert = {
      id:
        result.id != null
          ? `alert-result-${result.id}`
          : `alert-${result.orderId}-${Date.now()}`,
      timestamp: new Date(),
      prn: result.prn,
      patientName: patient?.name,
      testName: result.testName,
      result: resultText,
      referenceRange,
      unit: result.unit ?? undefined,
      criticalLevel,
      type: alertType,
      reportUrl: result.reportUrl ?? undefined,
    };

    // Broadcast to all connected clients
    await broadcastCriticalValueAlert(alert);

    // TODO: Send SMS/Email notification to on-call doctor
    // TODO: Create notification entry in Docminds notification system
  } catch (error) {
    console.error('Error creating alert from investigation result:', error);
  }
};

/**
 * Determine critical level based on test name and result
 * This is simplified; in production, use reference ranges from HMIS/lab
 */
function determineCriticalLevel(
  testName: string,
  result: string,
  referenceRange?: string
): 'critical' | 'high' | 'low' {
  const resultValue = parseFloat(result);

  // Examples (would be expanded with full lab reference ranges)
  if (testName.toLowerCase().includes('glucose')) {
    if (resultValue > 400 || resultValue < 40) return 'critical';
    if (resultValue > 300 || resultValue < 70) return 'high';
  }

  if (testName.toLowerCase().includes('potassium')) {
    if (resultValue > 6.5 || resultValue < 2.5) return 'critical';
  }

  if (testName.toLowerCase().includes('hemoglobin')) {
    if (resultValue < 6 || resultValue > 20) return 'critical';
    if (resultValue < 8 || resultValue > 18) return 'high';
  }

  return 'high'; // Default to high if marked critical but no specific rule
}

/**
 * Get total active connections
 */
function getTotalConnections(): number {
  let total = 0;
  for (const connections of activeConnections.values()) {
    total += connections.length;
  }
  return total;
}

/**
 * Get active users
 */
export const getActiveUsers = (): string[] => {
  return Array.from(activeConnections.keys());
};

/**
 * Disconnect all clients (for graceful shutdown)
 */
export const closeAllConnections = (): void => {
  for (const [userId, connections] of activeConnections.entries()) {
    for (const res of connections) {
      try {
        res.end();
      } catch (error) {
        console.error(`Error closing connection for ${userId}:`, error);
      }
    }
  }
  activeConnections.clear();
  console.log('✅ All SSE connections closed');
};
