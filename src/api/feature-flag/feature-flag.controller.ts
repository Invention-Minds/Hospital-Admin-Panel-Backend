import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 0 — Feature-flag controller.
 *
 * Each phase ships behind a flag so the hospital can enable rollout per-ward
 * / per-role. Frontend reads all flags on app boot and caches them.
 *
 * Roles:
 *   • Anyone authenticated may READ the flag table (frontend needs this on boot).
 *   • Only super_admin / sub_admin may WRITE flags.
 *
 * Role lookup is via the User table (the JWT only carries id + username — see
 * global.d.ts) so each write incurs one extra select. Cheap; flag writes are
 * very low volume.
 */

interface FlagBody {
  flagKey: string;
  description?: string;
  enabled?: boolean;
  rolloutScope?: string;
}

async function isAdmin(actorId: number | undefined): Promise<boolean> {
  if (typeof actorId !== 'number') return false;
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  return user?.role === 'super_admin' || user?.role === 'sub_admin';
}

/**
 * GET /api/feature-flag — list all flags (frontend caches this).
 */
export const listFlags = async (_req: Request, res: Response): Promise<void> => {
  try {
    const flags = await prisma.featureFlag.findMany({ orderBy: { flagKey: 'asc' } });
    res.status(200).json(flags);
  } catch (error) {
    console.error('[feature-flag] list failed:', error);
    res.status(500).json({ error: 'Failed to list feature flags' });
  }
};

/**
 * GET /api/feature-flag/:flagKey — single-flag read.
 */
export const getFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const flag = await prisma.featureFlag.findUnique({ where: { flagKey: req.params.flagKey } });
    if (!flag) {
      // Not found = treat as disabled. Don't 404 — frontend would log noise.
      res.status(200).json({ flagKey: req.params.flagKey, enabled: false, rolloutScope: 'global' });
      return;
    }
    res.status(200).json(flag);
  } catch (error) {
    console.error('[feature-flag] get failed:', error);
    res.status(500).json({ error: 'Failed to fetch feature flag' });
  }
};

/**
 * POST /api/feature-flag — create a new flag (admin only).
 */
export const createFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await isAdmin(req.user?.id))) {
      res.status(403).json({ error: 'Only admins may create feature flags' });
      return;
    }
    const body = req.body as FlagBody;
    if (!body.flagKey || body.flagKey.trim().length === 0) {
      res.status(400).json({ error: 'flagKey is required' });
      return;
    }

    const flag = await prisma.featureFlag.create({
      data: {
        flagKey: body.flagKey.trim(),
        description: body.description?.trim() ?? '',
        enabled: body.enabled ?? false,
        rolloutScope: body.rolloutScope?.trim() ?? 'global',
        updatedById: req.user?.id ?? null,
        updatedBy: req.user?.username ?? null,
      },
    });

    await auditLog(req, {
      module: 'feature-flag',
      action: 'CREATE',
      entityType: 'FeatureFlag',
      entityId: flag.id,
      payload: { flagKey: flag.flagKey, enabled: flag.enabled, rolloutScope: flag.rolloutScope },
    });

    res.status(201).json(flag);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(409).json({ error: 'flagKey already exists' });
      return;
    }
    console.error('[feature-flag] create failed:', error);
    res.status(500).json({ error: 'Failed to create feature flag' });
  }
};

/**
 * PATCH /api/feature-flag/:flagKey — toggle / update (admin only).
 */
export const updateFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await isAdmin(req.user?.id))) {
      res.status(403).json({ error: 'Only admins may update feature flags' });
      return;
    }
    const body = req.body as Partial<FlagBody>;
    const flagKey = req.params.flagKey;

    const before = await prisma.featureFlag.findUnique({ where: { flagKey } });
    if (!before) {
      res.status(404).json({ error: 'Feature flag not found' });
      return;
    }

    const updated = await prisma.featureFlag.update({
      where: { flagKey },
      data: {
        description: body.description?.trim() ?? before.description,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : before.enabled,
        rolloutScope: body.rolloutScope?.trim() ?? before.rolloutScope,
        updatedById: req.user?.id ?? null,
        updatedBy: req.user?.username ?? null,
      },
    });

    await auditLog(req, {
      module: 'feature-flag',
      action: 'UPDATE',
      entityType: 'FeatureFlag',
      entityId: updated.id,
      payload: {
        flagKey,
        before: { enabled: before.enabled, rolloutScope: before.rolloutScope },
        after: { enabled: updated.enabled, rolloutScope: updated.rolloutScope },
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('[feature-flag] update failed:', error);
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
};
