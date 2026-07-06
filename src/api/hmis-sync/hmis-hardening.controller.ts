import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

/**
 * Phase 9 — HMIS sync hardening controller.
 *
 * Operator-facing endpoints for the dead-letter queue + conflict ledger.
 * The cron-based mover lives in `hmis-dead-letter-mover.ts`; this controller
 * is just the read/resolve surface for the dashboard.
 *
 * Field names mirror the schema columns 1:1 (`originalAuditLogId`, `errorDetail`,
 * `localValue`, `hmisValue`, `resolvedBy`, etc.).
 */

// ─── Dead-letter queue ───────────────────────────────────────────────

/** GET /api/hmis-sync/dead-letter?status=&module= */
export const listDeadLetters = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string | undefined) ?? 'QUARANTINED';
    const module = req.query.module as string | undefined;
    const rows = await prisma.hmisDeadLetter.findMany({
      where: {
        ...(status !== 'ALL' && { status }),
        ...(module && { module }),
      },
      orderBy: [{ movedAt: 'desc' }],
      take: 200,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[hmis-hardening] listDeadLetters failed:', error);
    res.status(500).json({ error: 'Failed to list dead-letter rows' });
  }
};

/** GET /api/hmis-sync/dead-letter/:id */
export const getDeadLetter = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.hmisDeadLetter.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Dead-letter row not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[hmis-hardening] getDeadLetter failed:', error);
    res.status(500).json({ error: 'Failed to fetch dead-letter row' });
  }
};

/**
 * POST /api/hmis-sync/dead-letter/:id/resolve
 * Body: { resolution: string, outcome: 'RESOLVED' | 'IGNORED' | 'REPLAYED' }
 *
 * RESOLVED — operator manually fixed the issue in HMIS.
 * IGNORED  — won't-fix; record the reason.
 * REPLAYED — flips the original audit log back to status='pending' and
 *            decrements retryCount so the next cron run picks it up again.
 */
export const resolveDeadLetter = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { resolution, outcome } = req.body as {
      resolution: string;
      outcome: 'RESOLVED' | 'IGNORED' | 'REPLAYED';
    };
    if (!resolution || resolution.trim().length < 5) {
      res.status(400).json({ error: 'resolution (min 5 chars) is required' });
      return;
    }
    if (!['RESOLVED', 'IGNORED', 'REPLAYED'].includes(outcome)) {
      res.status(400).json({ error: 'outcome must be RESOLVED | IGNORED | REPLAYED' });
      return;
    }

    const row = await prisma.hmisDeadLetter.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Dead-letter row not found' });
      return;
    }
    if (row.status !== 'QUARANTINED') {
      res.status(409).json({ error: `Dead-letter row already at status=${row.status}` });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.hmisDeadLetter.update({
        where: { id },
        data: {
          status: outcome,
          resolution: resolution.trim(),
          resolvedAt: new Date(),
          resolvedBy: req.user?.username ?? null,
          resolvedById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
      });

      // For REPLAYED — push the original audit log back to pending so the
      // retry processor picks it up. Reset quarantinedAt and bump retryCount
      // back down to (3 - 1) = 2 so it gets one more attempt.
      if (outcome === 'REPLAYED') {
        await tx.hmisAuditLog.update({
          where: { id: row.originalAuditLogId },
          data: {
            status: 'pending',
            retryCount: Math.max(0, row.retryCount - 1),
            quarantinedAt: null,
          },
        });
      }

      return updated;
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[hmis-hardening] resolveDeadLetter failed:', error);
    res.status(500).json({ error: 'Failed to resolve dead-letter row' });
  }
};

/**
 * POST /api/hmis-sync/dead-letter/run-mover
 * Manually invoke the dead-letter mover (also runs on cron). Returns the
 * count of rows quarantined this pass.
 */
export const runDeadLetterMover = async (_req: Request, res: Response): Promise<void> => {
  try {
    const count = await moveExhaustedFailuresToDeadLetter();
    res.status(200).json({ ok: true, moved: count });
  } catch (error) {
    console.error('[hmis-hardening] runDeadLetterMover failed:', error);
    res.status(500).json({ error: 'Failed to run dead-letter mover' });
  }
};

/**
 * Mover logic — exported so the cron registrar can reuse it without going
 * through HTTP. Picks audit-log rows where status='failed' and retryCount>=3
 * and not already quarantined, copies them into HmisDeadLetter, and stamps
 * the audit log as status='dead' with quarantinedAt=now.
 */
export const MAX_RETRIES_BEFORE_DEAD = 3;

export async function moveExhaustedFailuresToDeadLetter(): Promise<number> {
  const candidates = await prisma.hmisAuditLog.findMany({
    where: {
      status: 'failed',
      retryCount: { gte: MAX_RETRIES_BEFORE_DEAD },
      quarantinedAt: null,
    },
    take: 500,
  });

  if (candidates.length === 0) return 0;

  let moved = 0;
  for (const row of candidates) {
    try {
      // Skip if a dead-letter row already points at this audit log id.
      const exists = await prisma.hmisDeadLetter.findUnique({
        where: { originalAuditLogId: row.id },
      });
      if (exists) continue;

      await prisma.$transaction([
        prisma.hmisDeadLetter.create({
          data: {
            originalAuditLogId: row.id,
            module: row.module,
            action: row.action,
            direction: row.direction,
            payload: row.payload,
            errorDetail: row.response ?? '',
            retryCount: row.retryCount,
            status: 'QUARANTINED',
          },
        }),
        prisma.hmisAuditLog.update({
          where: { id: row.id },
          data: { status: 'dead', quarantinedAt: new Date() },
        }),
      ]);
      moved += 1;
    } catch (err) {
      console.error('[hmis-hardening] mover failed for audit id', row.id, err);
    }
  }
  return moved;
}

// ─── Conflict ledger ─────────────────────────────────────────────────

/** GET /api/hmis-sync/conflicts?status=&module= */
export const listConflicts = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string | undefined) ?? 'OPEN';
    const module = req.query.module as string | undefined;
    const rows = await prisma.hmisConflict.findMany({
      where: {
        ...(status !== 'ALL' && { status }),
        ...(module && { module }),
      },
      orderBy: [{ detectedAt: 'desc' }],
      take: 200,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[hmis-hardening] listConflicts failed:', error);
    res.status(500).json({ error: 'Failed to list conflicts' });
  }
};

/** GET /api/hmis-sync/conflicts/:id */
export const getConflict = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.hmisConflict.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Conflict not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[hmis-hardening] getConflict failed:', error);
    res.status(500).json({ error: 'Failed to fetch conflict' });
  }
};

/** POST /api/hmis-sync/conflicts — used by the audit pipeline when divergence is detected. */
export const createConflict = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      module,
      entityType,
      entityId,
      fieldName,
      localValue,
      hmisValue,
      triggerAuditLogId,
    } = req.body as {
      module: string;
      entityType: string;
      entityId: string;
      fieldName: string;
      localValue?: string;
      hmisValue?: string;
      triggerAuditLogId?: number;
    };
    if (!module || !entityType || !entityId || !fieldName) {
      res.status(400).json({
        error: 'module, entityType, entityId, fieldName are all required',
      });
      return;
    }

    const created = await prisma.hmisConflict.create({
      data: {
        module,
        entityType,
        entityId,
        fieldName,
        localValue: localValue ?? null,
        hmisValue: hmisValue ?? null,
        triggerAuditLogId: triggerAuditLogId ?? null,
        status: 'OPEN',
      },
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[hmis-hardening] createConflict failed:', error);
    res.status(500).json({ error: 'Failed to create conflict' });
  }
};

/**
 * POST /api/hmis-sync/conflicts/:id/resolve
 * Body: { outcome: 'RESOLVED_LOCAL' | 'RESOLVED_HMIS' | 'IGNORED', resolution: string }
 */
export const resolveConflict = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { outcome, resolution } = req.body as {
      outcome: 'RESOLVED_LOCAL' | 'RESOLVED_HMIS' | 'IGNORED';
      resolution: string;
    };
    if (!['RESOLVED_LOCAL', 'RESOLVED_HMIS', 'IGNORED'].includes(outcome)) {
      res.status(400).json({ error: 'outcome must be RESOLVED_LOCAL | RESOLVED_HMIS | IGNORED' });
      return;
    }
    if (!resolution || resolution.trim().length < 5) {
      res.status(400).json({ error: 'resolution (min 5 chars) is required' });
      return;
    }

    const row = await prisma.hmisConflict.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Conflict not found' });
      return;
    }
    if (row.status !== 'OPEN') {
      res.status(409).json({ error: `Conflict already at status=${row.status}` });
      return;
    }

    const updated = await prisma.hmisConflict.update({
      where: { id },
      data: {
        status: outcome,
        resolution: resolution.trim(),
        resolvedAt: new Date(),
        resolvedBy: req.user?.username ?? null,
        resolvedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[hmis-hardening] resolveConflict failed:', error);
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
};
