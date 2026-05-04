import type { Request, Response, NextFunction } from 'express';

/**
 * Sprint 4a Phase 1b — Clinical-write actor guard (NABH MRD.1).
 *
 * Every clinical-write handler (IPD progress notes, discharge summaries,
 * prescriptions, MAR logs, MLC cases, LAMA/DAMA records) must record a
 * known creator id. Without it, NABH audits cannot answer "who wrote this".
 *
 * This guard is applied AFTER `authenticateToken` and confirms the JWT
 * payload carried a positive integer `id`. On failure it returns 401 with
 * the contract-specified body; on success it leaves `req.user.id` intact
 * so callers can stamp `createdById` / `updatedById` directly.
 *
 * The separation from `authenticateToken` is intentional:
 *   - `authenticateToken` answers "is the token valid?" (401 if missing,
 *     403 if invalid) and is the right guard for read endpoints too.
 *   - `requireClinicalActor` answers "does the authenticated actor have
 *     an attributable id we can write into the audit trail?" — strictly
 *     about the NABH.MRD.1 write-path requirement.
 *
 * Apply either via route middleware chain:
 *   router.post('/…', authenticateToken, requireClinicalActor, handler);
 * or inline inside a handler via `getClinicalActor(req, res)` which
 * returns the id or sends the 401 and returns null.
 */

const UNAUTH_BODY = { error: 'Authentication required for clinical writes' } as const;

/**
 * Express middleware — rejects with 401 when no valid actor id is attached.
 * Intended for POST/PUT routes on clinical-write tables.
 */
export const requireClinicalActor = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const actorId = req.user?.id;
  if (typeof actorId !== 'number' || !Number.isFinite(actorId) || actorId <= 0) {
    res.status(401).json(UNAUTH_BODY);
    return;
  }
  next();
};

/**
 * Inline-handler variant — read the actor id at the top of a handler that
 * may have been reached without the middleware chain having run the guard
 * (e.g., shared-helper handlers reached from multiple routes, or when the
 * controller wants to compose the guard's response).
 *
 * Returns the numeric actor id on success, or `null` after sending the
 * 401 response (caller short-circuits with `if (!actorId) return;`).
 */
export const getClinicalActor = (
  req: Request,
  res: Response
): number | null => {
  const actorId = req.user?.id;
  if (typeof actorId !== 'number' || !Number.isFinite(actorId) || actorId <= 0) {
    res.status(401).json(UNAUTH_BODY);
    return null;
  }
  return actorId;
};

/**
 * Sprint 4b Phase 4b.1 — Strip audit-attribution fields from a request body.
 *
 * Use on any update handler that spreads `req.body` into `prisma.xxx.update({ data })`.
 * Clients can POST `createdBy`/`createdById`/`createdAt`/`updatedBy`/`updatedById`
 * in the body; persisting those verbatim would be a server-identity-impersonation
 * loophole (same risk class as the 4a Phase 1d critical-values-ack bug).
 *
 * Usage:
 *   const updated = await prisma.mlcCase.update({
 *     where: { id },
 *     data: {
 *       ...stripAuditFields(body),
 *       updatedBy: req.user!.username,
 *       updatedById: actorId,
 *     },
 *   });
 *
 * 4b.2 (API-wide server-identity audit) will extend this helper's usage across
 * the remaining body-spread write endpoints; this is the single source of truth
 * for "fields that must never come from the client".
 */
export const stripAuditFields = <T extends Record<string, unknown>>(body: T): T => {
  if (body == null || typeof body !== 'object') return body;
  const clean = { ...body };
  delete (clean as Record<string, unknown>).createdBy;
  delete (clean as Record<string, unknown>).createdById;
  delete (clean as Record<string, unknown>).createdAt;
  delete (clean as Record<string, unknown>).updatedBy;
  delete (clean as Record<string, unknown>).updatedById;
  return clean;
};
