import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { MODULE_LABELS, labelForModule } from './module-labels';

/**
 * Module Utilization analytics — who is (and isn't) using each module.
 *
 * Data source: AppAuditLog (written by src/service/app-audit.ts from every
 * controller). A user "used" a module in the window when at least one audit
 * row exists with their actorId for that module.
 *
 * DENOMINATOR NOTE: the eligible population for every module is "all active
 * users" (User.isActive = true). Per-module access rules live only in the
 * frontend sidebar *ngIf logic (sidebar.component.html) — there is no
 * server-side module↔role entitlement table to derive a tighter denominator
 * from, so a user who can't even see a module counts as "not using" it.
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function startOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface UserLite {
  id: number;
  name: string;
  role: string;
}

/**
 * GET /api/module-usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Defaults to the last 30 days (inclusive). For each module seen in the
 * audit log during the window, returns active/inactive user splits with
 * names, plus adoption percentage against all active users.
 */
export const getModuleUsageSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const toParam = typeof req.query.to === 'string' ? req.query.to : '';
    const fromParam = typeof req.query.from === 'string' ? req.query.from : '';

    if ((toParam && !YMD_RE.test(toParam)) || (fromParam && !YMD_RE.test(fromParam))) {
      res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
      return;
    }

    const to = toParam || ymd(new Date());
    let from = fromParam;
    if (!from) {
      const d = startOfDay(to);
      d.setDate(d.getDate() - 29); // 30-day window inclusive of `to`
      from = ymd(d);
    }

    const rangeStart = startOfDay(from);
    const rangeEnd = endOfDay(to);
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      res.status(400).json({ error: '`from` must not be after `to`' });
      return;
    }

    // One row per (module, actor) pair active in the window. actorId is
    // nullable (system/cron rows use auditLogSystem with actorId: null) —
    // exclude those, they aren't a person using the app.
    const [pairs, eligibleUsers] = await Promise.all([
      prisma.appAuditLog.groupBy({
        by: ['module', 'actorId'],
        where: {
          createdAt: { gte: rangeStart, lte: rangeEnd },
          actorId: { not: null },
        },
      }),
      // Denominator: ALL active users (see note at top of file).
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, username: true, fullName: true, role: true, subAdminType: true },
        orderBy: { username: 'asc' },
      }),
    ]);

    const eligible: UserLite[] = eligibleUsers.map((u) => ({
      id: u.id,
      name: u.fullName || u.username,
      role: u.subAdminType ? `${u.role} (${u.subAdminType})` : u.role,
    }));
    const eligibleById = new Map<number, UserLite>(eligible.map((u) => [u.id, u]));

    // module → set of distinct actorIds seen in the window.
    const actorsByModule = new Map<string, Set<number>>();
    for (const row of pairs) {
      if (row.actorId == null) continue;
      let set = actorsByModule.get(row.module);
      if (!set) {
        set = new Set<number>();
        actorsByModule.set(row.module, set);
      }
      set.add(row.actorId);
    }

    // Report every known module, not just the ones with audit rows in the
    // window — modules nobody used at all must still show up at 0%.
    const moduleKeys = new Set<string>([...Object.keys(MODULE_LABELS), ...actorsByModule.keys()]);

    const modules = [...moduleKeys]
      .map((key) => {
        const actorIds = actorsByModule.get(key) ?? new Set<number>();
        const activeUsers: UserLite[] = [];
        for (const id of actorIds) {
          const u = eligibleById.get(id);
          // Actors who are no longer active users (deactivated/deleted) are
          // not in the eligible set; keep counts consistent by skipping them.
          if (u) activeUsers.push(u);
        }
        activeUsers.sort((a, b) => a.name.localeCompare(b.name));
        const activeIds = new Set(activeUsers.map((u) => u.id));
        const inactiveUsers = eligible.filter((u) => !activeIds.has(u.id));

        const eligibleCount = eligible.length;
        const activeCount = activeUsers.length;
        return {
          key,
          label: labelForModule(key),
          eligibleCount,
          activeCount,
          inactiveCount: eligibleCount - activeCount,
          adoptionPct: eligibleCount > 0 ? Math.round((activeCount / eligibleCount) * 1000) / 10 : 0,
          activeUsers,
          inactiveUsers,
        };
      })
      .sort((a, b) => b.activeCount - a.activeCount || a.label.localeCompare(b.label));

    res.status(200).json({
      from,
      to,
      totalEligible: eligible.length,
      modules,
    });
  } catch (error) {
    console.error('[module-usage] summary failed:', error);
    res.status(500).json({ error: 'Failed to compute module usage summary' });
  }
};
