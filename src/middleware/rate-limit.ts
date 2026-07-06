import type { Request, Response, NextFunction } from 'express';

/**
 * Lightweight in-memory rate limiter (no external dependency).
 *
 * Two modes:
 *   - mode: 'failures' (default) — only counts FAILED responses (401/403).
 *     A successful response clears the counter. Use for login: blocks brute
 *     force / credential stuffing without penalising legitimate users.
 *   - mode: 'all' — counts every request. Use for abuse-prone endpoints like
 *     OTP/SMS send to stop flooding.
 *
 * State is per-process (resets on restart, not shared across instances) —
 * consistent with the other in-memory state in this codebase. For multi-
 * instance deployments move this to Redis.
 */

interface Entry {
  count: number;
  resetAt: number; // epoch ms
}

export interface RateLimitOptions {
  windowMs: number;
  /** Max allowed (failures, or total requests in 'all' mode) within the window. */
  max: number;
  mode?: 'failures' | 'all';
  /** Custom key. Defaults to client IP + (body.username | body.phone). */
  keyGenerator?: (req: Request) => string;
  /** Message returned on 429. */
  message?: string;
}

const clientIp = (req: Request): string => {
  // req.ip is reliable once `trust proxy` is set (see index.ts).
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const defaultKey = (req: Request): string => {
  const subject =
    (req.body && (req.body.username || req.body.phone || req.body.mobile)) || '';
  return `${clientIp(req)}|${subject}`;
};

export const rateLimit = (opts: RateLimitOptions) => {
  const mode = opts.mode ?? 'failures';
  const keyOf = opts.keyGenerator ?? defaultKey;
  const message = opts.message ?? 'Too many attempts. Please try again later.';
  const store = new Map<string, Entry>();

  // Periodic sweep so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of store) if (now >= e.resetAt) store.delete(k);
  }, opts.windowMs);
  // Don't keep the event loop alive solely for the sweep.
  if (typeof sweep.unref === 'function') sweep.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = keyOf(req);
    const entry = store.get(key);
    const active = entry && now < entry.resetAt;

    if (active && entry!.count >= opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry!.resetAt - now) / 1000)));
      res.status(429).json({ error: message });
      return;
    }

    if (mode === 'all') {
      if (active) entry!.count += 1;
      else store.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    // 'failures' mode — decide after the response is known.
    res.on('finish', () => {
      const failed = res.statusCode === 401 || res.statusCode === 403;
      if (!failed) {
        store.delete(key); // success (or non-auth error) clears the counter
        return;
      }
      const e = store.get(key);
      if (!e || Date.now() >= e.resetAt) store.set(key, { count: 1, resetAt: Date.now() + opts.windowMs });
      else e.count += 1;
    });
    next();
  };
};
