import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../service/prisma-client';
import { securityConfig } from '../config/security-logging';
import { classifyThreat, bufferThreat, recordProbe } from '../service/security-alert';
import { blockIp, isWhitelisted } from './global-rate-limit';

/**
 * Security request logging middleware.
 *
 * Two pieces, both mounted app-wide BEFORE the route table and BEFORE the
 * existing auth guards (middleware.ts):
 *
 *   softAuth        decodes the JWT IF present, never rejects. Lets the logger
 *                   know authenticated-vs-anonymous on every route without
 *                   changing any existing guard behaviour.
 *   securityLogger  on response finish, records the request to a daily-rotated
 *                   JSONL file AND the DB, and queues an alert if it looks
 *                   suspicious. Fire-and-forget — never blocks or breaks a
 *                   request.
 *
 * Disabled entirely (no-op) when SECURITY_LOGGING_ENABLED is false.
 */

// Ensure the log directory exists once at load time.
const logDirAbs = path.isAbsolute(securityConfig.logDir)
  ? securityConfig.logDir
  : path.join(process.cwd(), securityConfig.logDir);

if (securityConfig.enabled) {
  try {
    fs.mkdirSync(logDirAbs, { recursive: true });
  } catch (err) {
    console.error('[security-logger] could not create log dir:', err);
  }
}

const extractIp = (req: Request): string | null => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
};

const dailyLogFile = (now: Date): string => {
  const ymd = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return path.join(logDirAbs, `access-${ymd}.jsonl`);
};

/**
 * Soft auth: decode the bearer token if present, attach req.user, never reject.
 * Mirrors the verify call in middleware.ts (HS256 + JWT_SECRET) but swallows
 * all errors — the real guards still run downstream and enforce access.
 */
export const softAuth = (req: Request, _res: Response, next: NextFunction): void => {
  if (!securityConfig.enabled || req.user) {
    next();
    return;
  }
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    next();
    return;
  }
  jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }, (err, decoded) => {
    if (!err && decoded && typeof decoded === 'object') {
      const d = decoded as { id?: number; username?: string };
      if (typeof d.id === 'number' && typeof d.username === 'string') {
        req.user = { id: d.id, username: d.username };
      }
    }
    next(); // never reject
  });
};

/** Fire-and-forget persistence: file append + DB insert. Never throws upward. */
const persist = (record: {
  ts: Date;
  method: string;
  path: string;
  statusCode: number;
  responseMs: number;
  ip: string | null;
  userAgent: string | null;
  userId: number | null;
  anonymous: boolean;
  suspicious: boolean;
  rules: string[];
}): void => {
  // 1) Daily-rotated JSONL file.
  const line =
    JSON.stringify({
      ts: record.ts.toISOString(),
      method: record.method,
      path: record.path,
      status: record.statusCode,
      responseMs: record.responseMs,
      ip: record.ip,
      userAgent: record.userAgent,
      userId: record.userId,
      anonymous: record.anonymous,
      suspicious: record.suspicious,
      rules: record.rules,
    }) + '\n';
  fs.appendFile(dailyLogFile(record.ts), line, (err) => {
    if (err) console.error('[security-logger] file append failed:', err.message);
  });

  // 2) DB row. Skip non-suspicious rows when logAllToDb is off.
  if (!securityConfig.logAllToDb && !record.suspicious) return;
  prisma.securityRequestLog
    .create({
      data: {
        method: record.method,
        path: record.path,
        statusCode: record.statusCode,
        responseMs: record.responseMs,
        ip: record.ip,
        userAgent: record.userAgent,
        userId: record.userId,
        anonymous: record.anonymous,
        suspicious: record.suspicious,
        threatRules: record.rules.length > 0 ? JSON.stringify(record.rules) : null,
      },
    })
    .catch((err) =>
      console.error('[security-logger] DB insert failed:', err instanceof Error ? err.message : err)
    );
};

export const securityLogger = (req: Request, res: Response, next: NextFunction): void => {
  if (!securityConfig.enabled) {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    try {
      const now = Date.now();
      const ts = new Date(now);
      const reqPath = (req.originalUrl || req.url).split('?')[0];
      const ip = extractIp(req);
      const anonymous = typeof req.user?.id !== 'number';

      const { rules } = classifyThreat(
        { method: req.method, path: reqPath, statusCode: res.statusCode, anonymous, ip },
        now
      );
      const suspicious = rules.length > 0;

      // Auto-block IPs that repeatedly probe for non-API files/paths. The global
      // rate limiter only trips at 600 req/min, so a low-and-slow scanner is
      // otherwise never blocked — just alerted forever. Reuses the same
      // SecurityIpBlock table, so a super_admin can unblock via /api/security/blocks.
      if (
        securityConfig.probeBlockEnabled &&
        rules.includes('file_probe') &&
        ip &&
        !isWhitelisted(ip)
      ) {
        const probeCount = recordProbe(ip, now);
        if (probeCount >= securityConfig.probeBlockThreshold) {
          void blockIp(
            ip,
            `probe flood: ${probeCount} file-probe requests / ${securityConfig.probeBlockWindowMin}min`,
            securityConfig.probeBlockDurationMin,
            probeCount
          );
        }
      }

      persist({
        ts,
        method: req.method,
        path: reqPath,
        statusCode: res.statusCode,
        responseMs: now - start,
        ip,
        userAgent: req.headers['user-agent']?.toString() ?? null,
        userId: anonymous ? null : (req.user!.id as number),
        anonymous,
        suspicious,
        rules,
      });

      if (suspicious) {
        bufferThreat({ method: req.method, path: reqPath, statusCode: res.statusCode, anonymous, ip }, rules);
      }
    } catch (err) {
      // Logging must never break a request — even the finish handler.
      console.error('[security-logger] finish handler error:', err);
    }
  });

  next();
};
