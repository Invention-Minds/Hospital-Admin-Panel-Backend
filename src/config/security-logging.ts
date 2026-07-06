import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Central config for security request logging + threat alerting.
 *
 * All values are read from env (see .env.example). Everything has a safe
 * default so the feature degrades to "off / console-only" rather than
 * breaking when env is incomplete.
 */

const parseBool = (val: string | undefined, fallback: boolean): boolean => {
  if (val === undefined || val === '') return fallback;
  return /^(1|true|yes|on)$/i.test(val.trim());
};

const parseInt10 = (val: string | undefined, fallback: number): number => {
  const n = Number.parseInt((val ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseList = (val: string | undefined, fallback: string[]): string[] => {
  if (val === undefined || val.trim() === '') return fallback;
  return val
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

export const securityConfig = {
  /** Master enable/disable switch. When false, the middleware is a no-op. */
  enabled: parseBool(process.env.SECURITY_LOGGING_ENABLED, false),

  /** Comma-separated alert recipients. Empty → log to console, don't email. */
  alertEmails: parseList(process.env.SECURITY_ALERT_EMAILS, []),

  /**
   * Path prefixes that are sensitive when hit anonymously. Matched against
   * the (query-stripped) request path with startsWith.
   *
   * Curated from this app's actual route table (src/index.ts). Crown jewels =
   * patient/clinical PHI, money, HR, admin/RBAC, files, HMIS integration, and
   * medico-legal/audit. Deliberately EXCLUDED because they are legitimately
   * anonymous (would otherwise be noise): /api/login (login/register/refresh),
   * /api/callback + /api/whatsapp* + /api/sms (provider webhooks),
   * /api/queue + /api/voice-opd (kiosk check-in), and low-value operational
   * routes (/api/ads, /api/channel, /api/extraslot-count, /api/priority,
   * /api/capture-screenshoot).
   */
  sensitivePrefixes: parseList(process.env.SECURITY_SENSITIVE_PREFIXES, [
    // Patient & clinical PHI
    '/api/patients',
    '/api/ipd', // also covers /api/ipd-pharmacy (startsWith)
    '/api/ward',
    '/api/opd',
    '/api/er',
    '/api/icu-transfer',
    '/api/treatment-dashboard',
    '/api/prescription',
    '/api/doctor-notes',
    '/api/history-notes',
    '/api/investigation', // also covers /api/investigation-results (startsWith)
    '/api/critical-values',
    '/api/mlc',
    '/api/lama-dama',
    '/api/consent',
    '/api/signature',
    '/api/ot',
    // Financial
    '/api/revenue',
    '/api/estimation',
    '/api/daily-closure',
    // HR / staff
    '/api/staff',
    '/api/attendance',
    // Admin / RBAC / config / integration
    '/api/dashboard',
    '/api/feature-flag',
    '/api/role-aliases',
    '/api/masters',
    '/api/nursing-stations',
    '/api/hmis-sync',
    // Files / exports
    '/api/storage',
    // Medico-legal / audit
    '/api/incidents',
    '/api/nabh-audit',
  ]),

  /** N failed-auth (401/403) responses from one IP within the window → brute force. */
  bruteForceThreshold: parseInt10(process.env.SECURITY_BRUTEFORCE_THRESHOLD, 10),
  bruteForceWindowMin: parseInt10(process.env.SECURITY_BRUTEFORCE_WINDOW_MIN, 5),

  /**
   * When true, EVERY request is persisted to the DB table. When false, only
   * suspicious requests are persisted (the file log still gets everything).
   */
  logAllToDb: parseBool(process.env.SECURITY_LOG_ALL_TO_DB, true),

  /** Delete DB rows older than this many days (daily prune cron). */
  retentionDays: parseInt10(process.env.SECURITY_LOG_RETENTION_DAYS, 90),

  /** Minutes between aggregated alert-email flushes. */
  alertIntervalMin: parseInt10(process.env.SECURITY_ALERT_INTERVAL_MIN, 5),

  /** Directory for the daily-rotated JSONL access logs. */
  logDir: process.env.SECURITY_LOG_DIR?.trim() || 'logs',
};

export type SecurityConfig = typeof securityConfig;
