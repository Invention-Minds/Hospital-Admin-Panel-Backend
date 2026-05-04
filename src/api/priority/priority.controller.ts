import { Request, Response } from 'express';
import { notifyPriorityUpdate } from '../appointments/appointment.controller';

/**
 * Patient Priority — In-memory + SSE
 *
 * Stores nurse-flagged patient priorities (Critical / Emergency / Staff /
 * Senior / Disabled) without touching the appointments table. Doctors
 * receive real-time updates via the existing SSE channel
 * (/api/appointments/updates) under event name `priorityUpdate`.
 *
 * Lifecycle:
 *   • Set    via POST /api/priority           (nurse — vitals popup)
 *   • Read   via GET  /api/priority/today     (doctor on page load)
 *   • Clear  via PATCH /api/priority/:id/clear (doctor on Start Consult)
 *   • Auto-cleared at midnight                (cron — see clearAllPriorities)
 *   • Lost on server restart                  (acceptable: same-day data only)
 */

export type PriorityLevel =
  | 'normal' | 'critical' | 'emergency' | 'staff' | 'vip' | 'senior' | 'disabled';

interface PriorityRecord {
  priority: PriorityLevel;
  reason?: string;
  setBy?: string;
  setAt: string;
}

const VALID_PRIORITIES: PriorityLevel[] = [
  'normal', 'critical', 'emergency', 'staff', 'vip', 'senior', 'disabled'
];

// Key: appointmentId | Value: priority record
const priorityMap: Map<number, PriorityRecord> = new Map();

/**
 * POST /api/priority
 * Body: { appointmentId, priority, reason?, setBy? }
 */
export const setPriority = (req: Request, res: Response): void => {
  const { appointmentId, priority, reason, setBy } = req.body || {};

  if (!appointmentId || !priority) {
    res.status(400).json({ error: 'appointmentId and priority are required' });
    return;
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
    return;
  }

  const id = Number(appointmentId);
  const setAt = new Date().toISOString();

  if (priority === 'normal') {
    priorityMap.delete(id);
  } else {
    priorityMap.set(id, { priority, reason, setBy, setAt });
  }

  // Broadcast to all SSE clients (doctors' screens)
  notifyPriorityUpdate({ appointmentId: id, priority, reason, setBy, setAt });

  res.json({ success: true, appointmentId: id, priority, setAt });
};

/**
 * GET /api/priority/today
 * Returns all currently-flagged priority appointments
 */
export const getTodayPriorities = (req: Request, res: Response): void => {
  const data = Array.from(priorityMap.entries()).map(([appointmentId, p]) => ({
    appointmentId,
    ...p
  }));
  res.json({ data });
};

/**
 * PATCH /api/priority/:id/clear
 * Called by doctor when consultation starts — removes priority + broadcasts
 */
export const clearPriority = (req: Request, res: Response): void => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: 'Invalid appointment id' });
    return;
  }

  priorityMap.delete(id);
  notifyPriorityUpdate({ appointmentId: id, priority: 'normal' });

  res.json({ success: true, appointmentId: id });
};

/**
 * Used by midnight cron to wipe stale priorities at end of day
 */
export const clearAllPriorities = (): void => {
  const count = priorityMap.size;
  priorityMap.clear();
  console.log(`[priority] Cleared ${count} priority entries (daily reset)`);
};
