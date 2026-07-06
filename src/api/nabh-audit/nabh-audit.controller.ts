import type { Request, Response } from 'express';
import path from 'path';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import {
  buildAuditPack,
  type AuditPackScope,
} from '../../service/nabh-audit-pack';
import { runComplianceReport } from '../../service/nabh-compliance';

/**
 * Phase 10 — NABH audit pack export controller.
 *
 * Builds bundle synchronously (returns 200 once `READY`). For very large
 * exports a queued/async variant could be added — current scope assumes a
 * <10MB bundle that completes in seconds.
 *
 * Field names mirror the NabhAuditExport schema columns 1:1
 * (`scope`, `fromDate`, `toDate`, `filePath`, `downloadUrl`, `rowCount`,
 * `bundleBytes`, `errorDetail`).
 */

const VALID_SCOPES: AuditPackScope[] = [
  'full', 'wf-1', 'wf-2', 'wf-3', 'wf-4', 'wf-5', 'incident', 'hmis', 'ot', 'dietetics',
];

interface RequestExportBody {
  scope: AuditPackScope;
  fromDate: string; // ISO date
  toDate: string;
}

/** POST /api/nabh-audit/export */
export const requestExport = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as RequestExportBody;
    if (!VALID_SCOPES.includes(body.scope)) {
      res.status(400).json({ error: `scope must be one of: ${VALID_SCOPES.join(', ')}` });
      return;
    }
    const fromDate = new Date(body.fromDate);
    const toDate = new Date(body.toDate);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      res.status(400).json({ error: 'fromDate / toDate must be valid ISO dates' });
      return;
    }
    if (fromDate > toDate) {
      res.status(400).json({ error: 'fromDate must be on or before toDate' });
      return;
    }
    // Force end-of-day on toDate so the range is inclusive of the whole day.
    toDate.setHours(23, 59, 59, 999);

    // Create the row in QUEUED state, immediately flip to PROCESSING, then
    // run the build. On exception we stamp FAILED with errorDetail.
    const row = await prisma.nabhAuditExport.create({
      data: {
        scope: body.scope,
        fromDate,
        toDate,
        status: 'QUEUED',
        requestedBy: req.user?.username ?? null,
        requestedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await prisma.nabhAuditExport.update({
      where: { id: row.id },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    try {
      const result = await buildAuditPack({ scope: body.scope, fromDate, toDate });
      const fileName = path.basename(result.filePath);
      // Public URL via the existing /files static handler in index.ts.
      const downloadUrl = `/files/${fileName}`;
      const final = await prisma.nabhAuditExport.update({
        where: { id: row.id },
        data: {
          status: 'READY',
          filePath: result.filePath,
          downloadUrl,
          rowCount: result.rowCount,
          bundleBytes: result.bundleBytes,
          completedAt: new Date(),
        },
      });

      await auditLog(req, {
        module: 'nabh-audit',
        action: 'CREATE',
        entityType: 'NabhAuditExport',
        entityId: final.id,
        payload: {
          scope: body.scope,
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
          rowCount: result.rowCount,
          bundleBytes: result.bundleBytes,
        },
      });

      res.status(200).json(final);
    } catch (err) {
      const errorDetail = err instanceof Error ? err.message : String(err);
      await prisma.nabhAuditExport.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          errorDetail,
          completedAt: new Date(),
        },
      });
      res.status(500).json({ error: 'Audit pack build failed', detail: errorDetail });
    }
  } catch (error) {
    console.error('[nabh-audit] requestExport failed:', error);
    res.status(500).json({ error: 'Failed to start audit export' });
  }
};

/** GET /api/nabh-audit/exports */
export const listExports = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.nabhAuditExport.findMany({
      orderBy: [{ requestedAt: 'desc' }],
      take: 100,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[nabh-audit] listExports failed:', error);
    res.status(500).json({ error: 'Failed to list exports' });
  }
};

/**
 * GET /api/nabh-audit/compliance-report?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
 *
 * Runs every NABH check against live data and returns a structured pass/warn/fail
 * scorecard grouped by chapter (AAC, PRE, MOM, COP, HRM, PSQ, IMS).
 * Replaces the "raw data dump" view as the primary auditor surface — exports
 * stay available for evidence drill-down.
 */
export const getComplianceReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const fromQ = req.query.fromDate as string | undefined;
    const toQ = req.query.toDate as string | undefined;

    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - 30);

    const fromDate = fromQ ? new Date(fromQ) : start;
    const toDate = toQ ? new Date(toQ) : today;
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      res.status(400).json({ error: 'fromDate / toDate must be valid ISO dates' });
      return;
    }
    if (fromDate > toDate) {
      res.status(400).json({ error: 'fromDate must be on or before toDate' });
      return;
    }
    toDate.setHours(23, 59, 59, 999);

    const report = await runComplianceReport(fromDate, toDate);
    res.status(200).json(report);
  } catch (error) {
    console.error('[nabh-audit] getComplianceReport failed:', error);
    res.status(500).json({
      error: 'Failed to generate compliance report',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

/** GET /api/nabh-audit/exports/:id */
export const getExport = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.nabhAuditExport.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    console.error('[nabh-audit] getExport failed:', error);
    res.status(500).json({ error: 'Failed to fetch export' });
  }
};
