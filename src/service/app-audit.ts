import type { Request } from 'express';
import prisma from './prisma-client';

/**
 * Phase 0 — Generic in-app audit helper (NABH IMS.5, PSQ.7).
 *
 * Distinct from `createHmisAuditLog` (api/hmis-sync/hmis-audit.ts) which
 * captures HMIS push/pull traffic only. This helper records WHO did WHAT
 * inside Docminds for any clinically- or financially-relevant event.
 *
 * Usage from a controller:
 *
 *   await auditLog(req, {
 *     module: 'consent',
 *     action: 'SIGN',
 *     entityType: 'ConsentSignature',
 *     entityId: signed.id,
 *     payload: { formId: body.formId, contextId: body.contextId },
 *     notes: 'Attender signed admission consent',
 *   });
 *
 * Failure to write the audit row never throws — we never want a logging
 * failure to block a clinical action. Errors are logged to the console
 * for ops to pick up.
 */

export type AppAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'SIGN'
  | 'OVERRIDE'
  | 'EXPORT'
  | 'VIEW';

export interface AppAuditLogInput {
  module: string;
  action: AppAuditAction | string;
  entityType?: string;
  entityId?: string | number | null;
  payload?: Record<string, unknown> | null;
  notes?: string;
}

/**
 * Write one audit row. Reads actor info from the authenticated request.
 *
 * Always returns. On error, logs to console; never re-throws.
 */
export const auditLog = async (
  req: Request | null,
  data: AppAuditLogInput
): Promise<void> => {
  try {
    await prisma.appAuditLog.create({
      data: {
        module: data.module,
        action: data.action,
        entityType: data.entityType ?? null,
        entityId: data.entityId != null ? String(data.entityId) : null,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        notes: data.notes ?? null,
        actorId: typeof req?.user?.id === 'number' ? req.user.id : null,
        actorName: req?.user?.username ?? null,
        // The JWT only carries id + username (see global.d.ts). Role is
        // joinable from User.id at query time, so we don't snapshot it here.
        actorRole: null,
        ipAddress: extractIp(req),
        userAgent: req?.headers?.['user-agent']?.toString() ?? null,
      },
    });
  } catch (error) {
    console.error('[app-audit] failed to persist audit row:', {
      module: data.module,
      action: data.action,
      entityId: data.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Convenience helper for system-driven actions (cron jobs, webhooks)
 * where there's no `req` carrying user identity.
 */
export const auditLogSystem = async (
  data: AppAuditLogInput & { source?: string }
): Promise<void> => {
  try {
    await prisma.appAuditLog.create({
      data: {
        module: data.module,
        action: data.action,
        entityType: data.entityType ?? null,
        entityId: data.entityId != null ? String(data.entityId) : null,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        notes: data.notes ?? null,
        actorId: null,
        actorName: data.source ?? 'system',
        actorRole: 'system',
        ipAddress: null,
        userAgent: null,
      },
    });
  } catch (error) {
    console.error('[app-audit] system audit row failed:', {
      module: data.module,
      action: data.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const extractIp = (req: Request | null): string | null => {
  if (!req) return null;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
};
