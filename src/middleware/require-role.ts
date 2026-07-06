import type { Request, Response, NextFunction } from 'express';
import prisma from '../service/prisma-client';

/**
 * Phase NS-2 — role/subAdminType authorization guard.
 *
 * The JWT only carries `{ id, username }` (see middleware.ts), so role checks
 * MUST hit the DB — we never trust a role claim from the client. This mirrors
 * the inline `actorIsSuperAdmin` pattern already used in scheduling.controller,
 * generalised into reusable route middleware.
 *
 * Apply AFTER `authenticateToken`:
 *   router.post('/x', authenticateToken, requireRole({ subAdminTypes: ['Nursing Superintendent'] }), handler)
 *
 * super_admin is allowed by default (set allowSuperAdmin:false to lock them out).
 */

export interface RequireRoleOptions {
  /** UserRole values that pass (e.g. 'doctor', 'admin'). */
  roles?: string[];
  /** User.subAdminType values that pass (e.g. 'Nursing Superintendent'). */
  subAdminTypes?: string[];
  /** super_admin always passes unless explicitly disabled. Default true. */
  allowSuperAdmin?: boolean;
}

export const requireRole = (opts: RequireRoleOptions) => {
  const allowSuperAdmin = opts.allowSuperAdmin !== false;
  const roles = opts.roles ?? [];
  const subAdminTypes = opts.subAdminTypes ?? [];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, subAdminType: true },
    });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const passes =
      (allowSuperAdmin && user.role === 'super_admin') ||
      roles.includes(user.role) ||
      (!!user.subAdminType && subAdminTypes.includes(user.subAdminType));

    if (!passes) {
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
};
