import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import type { Prisma } from '@prisma/client';
import prisma from '../../service/prisma-client';

// User-activity log (eFeedor gap #8) — super_admin only (HR-sensitive).
// Read-only views over data that is already recorded:
//   AppAuditLog  — every audited action, incl. auth LOGIN / LOGIN_FAILED
//   DownloadLog  — every file download (OTP-gated)
//   User.loggedInDate/Time — last login before LOGIN rows existed
//
//   GET /api/activity-log/users     per-user summary for a date window
//   GET /api/activity-log           timeline (filters: user, module, action, dates)
//   GET /api/activity-log/facets    modules / actions seen recently (filter lists)

const TZ = 'Asia/Kolkata';
const PAGE_MAX = 200;

function windowOf(req: Request, res: Response): { from: Date; to: Date } | null {
  const q = req.query as Record<string, string | undefined>;
  const day = (v: string | undefined, end: boolean) => {
    if (!v) return undefined;
    const m = moment.tz(v, 'YYYY-MM-DD', true, TZ);
    return m.isValid() ? (end ? m.endOf('day') : m.startOf('day')).toDate() : null;
  };
  const to = day(q.to, true);
  const from = day(q.from, false);
  if (to === null || from === null) { res.status(400).json({ message: 'from / to must be YYYY-MM-DD' }); return null; }
  const toD = to ?? moment.tz(TZ).endOf('day').toDate();
  const fromD = from ?? moment.tz(toD, TZ).subtract(29, 'days').startOf('day').toDate();
  if (fromD > toD) { res.status(400).json({ message: 'from must be on or before to' }); return null; }
  return { from: fromD, to: toD };
}

/** Legacy last-login stamp (IST date + time strings) → Date, or null. */
function legacyLogin(date: string | null, time: string | null): Date | null {
  if (!date) return null;
  const m = moment.tz(`${date} ${time ?? '00:00:00'}`, 'YYYY-MM-DD HH:mm:ss', TZ);
  return m.isValid() ? m.toDate() : null;
}

export const activityUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const w = windowOf(req, res);
    if (!w) return;
    const range = { gte: w.from, lte: w.to };
    const [users, actions, logins, lastLogin, downloads] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, username: true, fullName: true, employeeId: true, role: true, adminType: true, subAdminType: true, isActive: true, loggedInDate: true, loggedInTime: true },
        orderBy: { username: 'asc' },
        take: 5000,
      }),
      prisma.appAuditLog.groupBy({
        by: ['actorId'], where: { actorId: { not: null }, createdAt: range, NOT: { module: 'auth' } },
        _count: { _all: true }, _max: { createdAt: true },
      }),
      prisma.appAuditLog.groupBy({
        by: ['actorId'], where: { actorId: { not: null }, createdAt: range, module: 'auth', action: 'LOGIN' },
        _count: { _all: true },
      }),
      prisma.appAuditLog.groupBy({
        by: ['actorId'], where: { actorId: { not: null }, module: 'auth', action: 'LOGIN' }, _max: { createdAt: true },
      }),
      prisma.downloadLog.groupBy({ by: ['userId'], where: { createdAt: range }, _count: { _all: true } }),
    ]);
    const act = new Map(actions.map((a) => [a.actorId as number, a]));
    const lg = new Map(logins.map((a) => [a.actorId as number, a._count._all]));
    const last = new Map(lastLogin.map((a) => [a.actorId as number, a._max.createdAt]));
    const dl = new Map(downloads.map((d) => [d.userId, d._count._all]));
    const failed = await prisma.appAuditLog.count({ where: { module: 'auth', action: 'LOGIN_FAILED', createdAt: range } });
    const rows = users.map((u) => {
      const a = act.get(u.id);
      return {
        id: u.id, username: u.username, name: u.fullName || u.username, employeeId: u.employeeId,
        role: u.role, title: u.adminType || u.subAdminType || null, isActive: u.isActive,
        lastLoginAt: last.get(u.id) ?? legacyLogin(u.loggedInDate, u.loggedInTime),
        logins: lg.get(u.id) ?? 0,
        actions: a?._count._all ?? 0,
        lastActionAt: a?._max.createdAt ?? null,
        downloads: dl.get(u.id) ?? 0,
      };
    });
    res.json({ window: w, failedLogins: failed, data: rows });
  } catch (error) {
    console.error('[activity-log] users failed:', error);
    res.status(500).json({ message: 'Failed to load user activity' });
  }
};

export const activityTimeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const w = windowOf(req, res);
    if (!w) return;
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(PAGE_MAX, Math.max(10, Number(q.pageSize) || 50));
    const userId = q.userId && /^\d+$/.test(q.userId) ? Number(q.userId) : undefined;
    const where: Prisma.AppAuditLogWhereInput = {
      createdAt: { gte: w.from, lte: w.to },
      ...(userId !== undefined && { actorId: userId }),
      ...(q.module && { module: q.module }),
      ...(q.action && { action: q.action }),
    };
    const [rows, total, downloads] = await Promise.all([
      prisma.appAuditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, createdAt: true, module: true, action: true, entityType: true, entityId: true, notes: true, payload: true, actorId: true, actorName: true, actorRole: true, ipAddress: true, userAgent: true },
      }),
      prisma.appAuditLog.count({ where }),
      userId !== undefined && page === 1
        ? prisma.downloadLog.findMany({
            where: { userId, createdAt: { gte: w.from, lte: w.to } }, orderBy: { createdAt: 'desc' }, take: 100,
            select: { id: true, createdAt: true, label: true, page: true, reason: true, ip: true, downloadRef: true },
          })
        : Promise.resolve([]),
    ]);
    res.json({
      window: w, page, pageSize, total,
      data: rows.map((r) => ({ ...r, payload: r.payload ? r.payload.slice(0, 600) : null, userAgent: r.userAgent ? r.userAgent.slice(0, 160) : null })),
      downloads,
    });
  } catch (error) {
    console.error('[activity-log] timeline failed:', error);
    res.status(500).json({ message: 'Failed to load the activity log' });
  }
};

export const activityFacets = async (_req: Request, res: Response): Promise<void> => {
  try {
    const since = new Date(Date.now() - 180 * 86_400_000);
    const rows = await prisma.appAuditLog.groupBy({ by: ['module', 'action'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const modules = [...new Set(rows.map((r) => r.module))].sort();
    const actions = [...new Set(rows.map((r) => r.action))].sort();
    res.json({ modules, actions });
  } catch (error) {
    console.error('[activity-log] facets failed:', error);
    res.status(500).json({ message: 'Failed to load filters' });
  }
};
