import type { Request, Response, NextFunction } from 'express';
import * as dotenv from 'dotenv';
import prisma from '../service/prisma-client';

dotenv.config();

/**
 * Global per-IP rate limiter with persistent, super-admin-manageable blocks.
 *
 * - Counts every /api request per IP in a fixed window. Exceeding the max
 *   writes a SecurityIpBlock row and starts returning 429 for that IP.
 * - Active blocks are cached in memory (refreshed from DB every 30s, and
 *   immediately on block/unblock in this process) so the hot path is a Map
 *   lookup, not a DB query.
 * - A super_admin unblocks via the /api/security/blocks API (see
 *   api/security/security.controller). Blocks can also auto-expire (expiresAt).
 * - Whitelisted IPs (env + loopback) are never counted or blocked, so admins
 *   can't lock themselves out.
 *
 * Per-process state; for multi-instance the DB is the source of truth and each
 * instance converges within the 30s refresh.
 */

const parseBool = (v: string | undefined, d: boolean): boolean =>
  v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v.trim());
const parseIntEnv = (v: string | undefined, d: number): number => {
  const n = Number.parseInt((v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const config = {
  enabled: parseBool(process.env.GLOBAL_RATE_LIMIT_ENABLED, true),
  max: parseIntEnv(process.env.GLOBAL_RATE_LIMIT_MAX, 600),
  windowMs: parseIntEnv(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS, 60_000),
  blockMin: parseIntEnv(process.env.GLOBAL_RATE_BLOCK_MIN, 15),
  whitelist: (process.env.RATE_LIMIT_WHITELIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// Loopback is always allowed.
export const isWhitelisted = (ip: string): boolean =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || config.whitelist.includes(ip);

const clientIp = (req: Request): string => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

// --- request counters --------------------------------------------------------
interface Counter { count: number; resetAt: number; }
const counters = new Map<string, Counter>();

// --- active-block cache: ip -> expiresAt epoch ms (null = permanent) ---------
const blockedCache = new Map<string, number | null>();

const isBlockedNow = (ip: string, now: number): boolean => {
  if (!blockedCache.has(ip)) return false;
  const exp = blockedCache.get(ip)!;
  if (exp !== null && now >= exp) {
    // Expired — drop from cache and mark inactive in DB (best effort).
    blockedCache.delete(ip);
    prisma.securityIpBlock
      .updateMany({ where: { ip, active: true }, data: { active: false } })
      .catch(() => {});
    return false;
  }
  return true;
};

/** Load active, non-expired blocks from DB into the cache. */
export const loadActiveBlocks = async (): Promise<void> => {
  try {
    const now = new Date();
    const rows = await prisma.securityIpBlock.findMany({
      where: { active: true },
      select: { ip: true, expiresAt: true },
    });
    blockedCache.clear();
    for (const r of rows) {
      if (r.expiresAt && r.expiresAt <= now) continue; // expired
      blockedCache.set(r.ip, r.expiresAt ? r.expiresAt.getTime() : null);
    }
  } catch (err) {
    console.error('[global-rate-limit] failed to load blocks:', err instanceof Error ? err.message : err);
  }
};

/** Block an IP (auto from limiter, or manually by admin). */
export const blockIp = async (
  ip: string,
  reason: string,
  minutes: number | null = config.blockMin,
  hitCount = 0
): Promise<void> => {
  const expiresAt = minutes && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  blockedCache.set(ip, expiresAt ? expiresAt.getTime() : null);
  try {
    await prisma.securityIpBlock.upsert({
      where: { ip },
      create: { ip, reason, hitCount, active: true, expiresAt },
      update: { reason, hitCount, active: true, blockedAt: new Date(), expiresAt, unblockedBy: null, unblockedAt: null },
    });
  } catch (err) {
    console.error('[global-rate-limit] failed to persist block:', err instanceof Error ? err.message : err);
  }
};

/** Unblock an IP (super_admin). Clears the cache + the request counter. */
export const unblockIp = async (ip: string, byUsername: string | null): Promise<boolean> => {
  blockedCache.delete(ip);
  counters.delete(ip);
  try {
    const res = await prisma.securityIpBlock.updateMany({
      where: { ip, active: true },
      data: { active: false, unblockedBy: byUsername, unblockedAt: new Date() },
    });
    return res.count > 0;
  } catch (err) {
    console.error('[global-rate-limit] failed to unblock:', err instanceof Error ? err.message : err);
    return false;
  }
};

/** Initialize the cache + periodic refresh. Call once at startup. */
export const initGlobalRateLimit = async (): Promise<void> => {
  if (!config.enabled) {
    console.log('[global-rate-limit] disabled (GLOBAL_RATE_LIMIT_ENABLED=false)');
    return;
  }
  await loadActiveBlocks();
  const t = setInterval(loadActiveBlocks, 30_000);
  if (typeof t.unref === 'function') t.unref();
  console.log(`[global-rate-limit] active: ${config.max} req / ${config.windowMs}ms per IP, block ${config.blockMin}min`);
};

export const globalRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  if (!config.enabled) return next();

  const ip = clientIp(req);
  if (isWhitelisted(ip)) return next();

  const now = Date.now();

  // Already blocked?
  if (isBlockedNow(ip, now)) {
    res.setHeader('Retry-After', '900');
    res.status(429).json({ error: 'Your IP is temporarily blocked due to excessive requests. Contact an administrator.' });
    return;
  }

  // Count this request in the current window.
  const c = counters.get(ip);
  if (!c || now >= c.resetAt) {
    counters.set(ip, { count: 1, resetAt: now + config.windowMs });
    return next();
  }
  c.count += 1;
  if (c.count > config.max) {
    // Trip the block (fire-and-forget persist; cache updated synchronously).
    void blockIp(ip, `rate limit: ${c.count} req / ${config.windowMs}ms`, config.blockMin, c.count);
    counters.delete(ip);
    res.setHeader('Retry-After', String(config.blockMin * 60));
    res.status(429).json({ error: 'Rate limit exceeded. Your IP has been temporarily blocked.' });
    return;
  }
  next();
};

// Periodic sweep of stale counters.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, c] of counters) if (now >= c.resetAt) counters.delete(ip);
}, config.windowMs);
if (typeof sweep.unref === 'function') sweep.unref();
