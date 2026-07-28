import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import { securityConfig } from '../config/security-logging';

dotenv.config();

/**
 * Threat classification + in-memory alert buffering for security logging.
 *
 * The middleware (middleware/security-logger.ts) calls `classifyThreat` on
 * every finished request and, when rules match, `bufferThreat` to queue an
 * alert. A cron (service/security-alert.cron.ts) calls `flushAlerts` every
 * few minutes to send ONE aggregated email via the existing SMTP setup —
 * never one email per request.
 *
 * Brute-force detection keeps a per-IP sliding window of failed-auth (401/403)
 * timestamps in memory. This is per-process and resets on restart — matches
 * the other in-memory cron state in this codebase; not shared across instances.
 */

// Reuse the existing mailer config (same transport + SMTP_USER/SMTP_PASS as
// email.controller.ts). No new SMTP setup or credentials.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface ThreatInput {
  method: string;
  path: string; // query string already stripped
  statusCode: number;
  anonymous: boolean;
  ip: string | null;
}

export interface ThreatResult {
  /** Stable rule keys that matched, e.g. ['failed_auth', 'brute_force']. */
  rules: string[];
}

// --- File-probe detection ----------------------------------------------------
// Requests for backend files / scanner paths that live OUTSIDE the API. The
// server already 404s these; we log + alert so we KNOW we're being scanned.
const PROBE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$|\/)/i, // .env, .env.local, ...
  /(^|\/)\.git(\/|$)/i, // .git, .git/config
  /(^|\/)\.ssh(\/|$)/i, // .ssh keys
  /(^|\/)\.aws(\/|$)/i, // .aws credentials
  /\.(sql|bak|dump|zip|tar\.gz|tgz|rar|7z)(\?|$)/i, // db dumps / archives
  /\.(pem|key|pfx|p12|crt|cer|keystore)(\?|$)/i, // keys / certs
  /(^|\/)(config|secrets?|credentials?|id_rsa)(\.|\/|$)/i, // config/secret files
  /\.(php|asp|aspx|jsp|cgi)(\?|$)/i, // server-side script probes
  /(^|\/)(wp-admin|wp-login|wp-content|xmlrpc\.php|phpmyadmin|pma|adminer|\.well-known\/.*\.php)(\/|$|\.)/i,
];

const isFileProbe = (path: string): boolean =>
  PROBE_PATTERNS.some((re) => re.test(path));

// --- Brute-force sliding window ----------------------------------------------
// ip -> array of failed-auth epoch-ms timestamps within the window.
const failedAuthByIp = new Map<string, number[]>();

/**
 * Record a failed-auth hit for an IP and report whether it has crossed the
 * brute-force threshold inside the configured window. `now` is injected so
 * callers can pass a single timestamp per request.
 */
const recordFailedAuth = (ip: string, now: number): boolean => {
  const windowMs = securityConfig.bruteForceWindowMin * 60 * 1000;
  const cutoff = now - windowMs;
  const hits = (failedAuthByIp.get(ip) ?? []).filter((t) => t >= cutoff);
  hits.push(now);
  failedAuthByIp.set(ip, hits);
  return hits.length >= securityConfig.bruteForceThreshold;
};

// --- File-probe sliding window (auto-block repeat scanners) ------------------
// ip -> array of file-probe epoch-ms timestamps within the window. Feeds the
// auto-block decision in middleware/security-logger.ts.
const probeByIp = new Map<string, number[]>();

/**
 * Record a file-probe hit for an IP and return how many it has made inside the
 * configured probe window. Caller compares against probeBlockThreshold.
 */
export const recordProbe = (ip: string, now: number): number => {
  const windowMs = securityConfig.probeBlockWindowMin * 60 * 1000;
  const cutoff = now - windowMs;
  const hits = (probeByIp.get(ip) ?? []).filter((t) => t >= cutoff);
  hits.push(now);
  probeByIp.set(ip, hits);
  return hits.length;
};

/** Drop stale IP windows so the maps don't grow unbounded. */
const pruneWindows = (now: number): void => {
  const authCutoff = now - securityConfig.bruteForceWindowMin * 60 * 1000;
  for (const [ip, hits] of failedAuthByIp) {
    const kept = hits.filter((t) => t >= authCutoff);
    if (kept.length === 0) failedAuthByIp.delete(ip);
    else failedAuthByIp.set(ip, kept);
  }
  const probeCutoff = now - securityConfig.probeBlockWindowMin * 60 * 1000;
  for (const [ip, hits] of probeByIp) {
    const kept = hits.filter((t) => t >= probeCutoff);
    if (kept.length === 0) probeByIp.delete(ip);
    else probeByIp.set(ip, kept);
  }
};

/**
 * Classify a finished request. Pure except for the brute-force window, which
 * it updates as a side effect when a failed-auth response is seen.
 */
export const classifyThreat = (input: ThreatInput, now: number): ThreatResult => {
  const rules: string[] = [];

  // 429 = our own rate-limit / IP-block response. The IP is already handled;
  // don't re-classify or re-alert on it (otherwise a blocked prober keeps
  // generating alerts on every throttled hit).
  if (input.statusCode === 429) return { rules };

  // Anonymous hit on a sensitive route.
  if (
    input.anonymous &&
    securityConfig.sensitivePrefixes.some((p) => input.path.startsWith(p))
  ) {
    rules.push('anon_sensitive');
  }

  // Failed auth (covers failed logins, token tampering, forbidden access).
  const failedAuth = input.statusCode === 401 || input.statusCode === 403;
  if (failedAuth) {
    rules.push('failed_auth');
    if (input.ip && recordFailedAuth(input.ip, now)) {
      rules.push('brute_force');
    }
  }

  // Probe for files outside the API.
  if (isFileProbe(input.path)) {
    rules.push('file_probe');
  }

  return { rules };
};

// --- Alert buffer ------------------------------------------------------------
interface BufferedThreat {
  ip: string;
  rule: string;
  method: string;
  path: string;
  statusCode: number;
}

let buffer: BufferedThreat[] = [];

const RULE_LABELS: Record<string, string> = {
  anon_sensitive: 'anonymous hit on sensitive route',
  failed_auth: 'failed auth (401/403)',
  brute_force: 'repeated failed auth (brute force)',
  file_probe: 'probe for non-API file/path',
};

/** Queue one matched threat for the next aggregated alert email. */
export const bufferThreat = (input: ThreatInput, rules: string[]): void => {
  for (const rule of rules) {
    buffer.push({
      ip: input.ip ?? 'unknown',
      rule,
      method: input.method,
      path: input.path,
      statusCode: input.statusCode,
    });
  }
};

/**
 * Aggregate and send the buffered threats as a single email. Called by cron.
 * Empty recipients → log to console, don't send. Never throws.
 */
export const flushAlerts = async (now: number): Promise<void> => {
  pruneWindows(now);

  if (buffer.length === 0) return;

  // Snapshot + reset so new events accumulate for the next window.
  const events = buffer;
  buffer = [];

  // Group by ip + rule + path.
  const groups = new Map<
    string,
    { ip: string; rule: string; method: string; path: string; statusCode: number; count: number }
  >();
  for (const e of events) {
    const key = `${e.ip}|${e.rule}|${e.method}|${e.path}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { ...e, count: 1 });
  }

  const lines = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      (g) =>
        `  ${g.count}× [${RULE_LABELS[g.rule] ?? g.rule}] ${g.method} ${g.path} ` +
        `(status ${g.statusCode}) from ${g.ip}`
    );

  const distinctIps = new Set(events.map((e) => e.ip)).size;
  const subject =
    `[DocMinds Security] ${events.length} suspicious events from ${distinctIps} IP(s) ` +
    `(last ${securityConfig.alertIntervalMin} min)`;
  const body = `${subject}\n\n${lines.join('\n')}\n`;

  if (securityConfig.alertEmails.length === 0) {
    console.warn(`[security-alert] ${subject} (no recipients configured)\n${body}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: securityConfig.alertEmails.join(','),
      subject,
      text: body,
    });
    console.log(
      `[security-alert] sent alert: ${events.length} events, ${groups.size} groups, ${distinctIps} IPs`
    );
  } catch (err) {
    // Don't lose the events silently — surface to console for ops.
    console.error('[security-alert] failed to send alert email:', err);
    console.warn(`[security-alert] undelivered alert:\n${body}`);
  }
};
