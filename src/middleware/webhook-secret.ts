import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Shared-secret guard for inbound webhooks (e.g. HMIS posting lab results,
 * payment confirmations, discharges). JWT is the wrong tool here — the caller
 * is an external system, not a logged-in user.
 *
 * The caller must send `X-Webhook-Secret: <secret>` matching the configured
 * env value. Comparison is constant-time.
 *
 * Backward-compatible by design: if the env secret is NOT set, requests are
 * allowed but a loud warning is logged on first use. This avoids silently
 * breaking a live integration the moment this ships — but you MUST set the
 * secret (on both this server and the HMIS side) to actually close the hole.
 */

const timingSafeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

export const verifyWebhookSecret = (envVar: string) => {
  let warned = false;
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = process.env[envVar];
    if (!expected) {
      if (!warned) {
        console.warn(
          `[webhook-secret] ${envVar} is not set — inbound webhooks are UNAUTHENTICATED. ` +
            `Set ${envVar} here and on the caller to enforce it.`
        );
        warned = true;
      }
      next();
      return;
    }
    const provided = req.headers['x-webhook-secret'];
    if (typeof provided === 'string' && timingSafeEqual(provided, expected)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid or missing webhook secret' });
  };
};
