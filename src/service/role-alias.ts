import prisma from './prisma-client';

// Phase 6 / Batch A — Notification target-role resolution.
//
// Resolves a spec string ("Quality Manager", "grievance_officer", etc.) to
// the concrete role the notification dispatcher should target. Looks up the
// RoleAlias table; falls back to the literal alias when no row exists, so
// every existing call site keeps working even before the seed is run.

// In-memory cache to avoid hitting the DB on every notification fire. TTL
// keeps stale data out of the system for at most CACHE_TTL_MS. Notifications
// are fire-and-forget so a slightly stale role mapping is acceptable.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry { value: string; expiresAt: number }
const cache = new Map<string, CacheEntry>();

/**
 * Resolve an alias to the targetRole string that should land on
 * Notification.targetRole. Falls back to the literal alias if no active
 * RoleAlias row matches — preserves legacy behaviour.
 */
export async function resolveTargetRole(alias: string | null | undefined): Promise<string | null> {
  if (!alias) return null;

  const cached = cache.get(alias);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const row = await prisma.roleAlias.findUnique({
      where: { alias },
      select: { targetRole: true, isActive: true },
    });
    const resolved = row && row.isActive ? row.targetRole : alias;
    cache.set(alias, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  } catch (err) {
    console.warn('[role-alias:resolve] DB lookup failed, falling back to literal:', (err as Error).message);
    return alias;
  }
}

/** Clear the cache (called from the admin UI after an edit). */
export function invalidateRoleAliasCache(): void {
  cache.clear();
}
