import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

/**
 * The signed-in user's alerts for the mobile app (GET /api/account/alerts).
 *
 * Unlike the web bell's /api/appointments/notifications (which takes the user
 * id from the query string), this reads only the caller's own alerts:
 *   • personal   — Notification.userId = me (assigned to you, escalations…)
 *   • job-title  — targetRole = my subAdminType (e.g. 'Dietician'), and the
 *                  diet night alerts sent to 'doctor' for doctors.
 * Broad broadcasts to whole roles ('admin', 'sub_admin', …) are left out —
 * they are mostly repeated desk escalations and would bury the useful ones.
 *
 * Personal alerts carry read state on the server. Job-title alerts are one row
 * shared by everyone with that title, so the app tracks "seen" on the phone.
 */

const WINDOW_DAYS = 30;
const DIET_TYPES = ['diet_new_admission', 'diet_census', 'diet_change', 'diet_night_ack'];

export type AlertRow = {
  id: number;
  type: string;
  title: string;
  message: string;
  createdAt: Date;
  critical: boolean;
  /** true = shared by a job title (read state lives on the phone). */
  shared: boolean;
  read: boolean;
  /** "Incident:<uuid>", "Complaint:<uuid>", "IpdAdmission:<id>", "Dietetics", "WhatsappQuery"… */
  entityType: string | null;
  entityId: number | null;
};

async function caller(req: Request) {
  const id = req.user?.id;
  if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) return null;
  return prisma.user.findUnique({ where: { id }, select: { id: true, role: true, subAdminType: true } });
}

export const listMyAlerts = async (req: Request, res: Response): Promise<void> => {
  try {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'Authentication required' }); return; }
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();

    const shared: Array<Record<string, unknown>> = [];
    if (me.subAdminType?.trim()) shared.push({ userId: null, targetRole: me.subAdminType.trim() });
    if (me.role === 'doctor') shared.push({ userId: null, targetRole: 'doctor', type: { in: DIET_TYPES } });

    const rows = await prisma.notification.findMany({
      where: {
        createdAt: { gte: since },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ userId: me.id }, ...shared] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, type: true, title: true, message: true, createdAt: true, isCritical: true, status: true, userId: true, entityType: true, entityId: true },
    });

    const data: AlertRow[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      createdAt: r.createdAt,
      critical: r.isCritical,
      shared: r.userId == null,
      read: r.userId == null ? false : r.status !== 'unread',
      entityType: r.entityType,
      entityId: r.entityId && r.entityId > 0 ? r.entityId : null,
    }));
    res.status(200).json({ data, unread: data.filter((a) => !a.shared && !a.read).length });
  } catch (error) {
    console.error('[account] listMyAlerts failed:', error);
    res.status(500).json({ error: 'Failed to load your alerts' });
  }
};

/** POST /api/account/alerts/read { ids?: number[] } — mark my personal alerts read (all when ids is omitted). */
export const markMyAlertsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'Authentication required' }); return; }
    const raw = (req.body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(raw.ids) ? raw.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : null;
    // userId = me in the where clause: shared (job-title) rows and other people's alerts are never touched.
    const r = await prisma.notification.updateMany({
      where: { userId: me.id, status: 'unread', ...(ids ? { id: { in: ids } } : {}) },
      data: { status: 'read', viewedAt: new Date() },
    });
    res.status(200).json({ updated: r.count });
  } catch (error) {
    console.error('[account] markMyAlertsRead failed:', error);
    res.status(500).json({ error: 'Failed to update your alerts' });
  }
};
