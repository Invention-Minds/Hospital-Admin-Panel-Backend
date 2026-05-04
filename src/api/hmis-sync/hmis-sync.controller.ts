import { Request, Response } from "express";
import prisma from "../../service/prisma-client";
import { createHmisAuditLog } from "./hmis-audit";
import { createAlertFromInvestigationResult } from "./critical-value-sse";

/**
 * Payment confirmed webhook from HMIS
 * Auto-checks in the patient to OPD
 */
export const paymentConfirmedWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { uhid, appointmentRef, receiptNo, amountPaid, timestamp } = req.body;

    if (!appointmentRef) {
      res.status(400).json({ message: "Missing appointmentRef" });
      return;
    }

    // Update appointment status to checked-in
    const appointment = await prisma.appointment.update({
      where: { id: parseInt(appointmentRef) },
      data: {
        checkedIn: true,
        checkedInTime: new Date(timestamp || Date.now()),
      },
    });

    // Log webhook receipt
    await createHmisAuditLog({
      direction: "pull",
      module: "appointment",
      action: "payment_confirmed",
      payload: JSON.stringify({ uhid, appointmentRef, receiptNo, amountPaid }),
      status: "success",
    });

    res.status(200).json({
      message: "Payment confirmed and patient checked in",
      data: appointment,
    });
  } catch (error) {
    console.error("Error processing payment confirmation webhook:", error);

    await createHmisAuditLog({
      direction: "pull",
      module: "appointment",
      action: "payment_confirmed",
      payload: JSON.stringify(req.body),
      status: "failed",
    });

    res.status(500).json({ message: "Error processing webhook", error });
  }
};

/**
 * Lab result ready webhook from HMIS
 */
export const labResultReadyWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      prn,
      orderId,
      testName,
      result,
      unit,
      referenceRange,
      criticalFlag,
      reportUrl,
    } = req.body;

    if (!prn || !orderId || !testName) {
      res
        .status(400)
        .json({
          message: "Missing required fields: prn, orderId, testName",
        });
      return;
    }

    // Create or update investigation result. Note: the current semantic is upsert-by-id
    // which only matches when HMIS's orderId happens to equal our InvestigationResult.id.
    // Acceptable for Sprint 2c cast cleanup; the semantic fix lives in a later sprint.
    const oid = Number(orderId);
    const investigationResult = await prisma.investigationResult.upsert({
      where: { id: oid },
      update: {
        result,
        unit,
        referenceRange,
        criticalFlag,
        reportUrl,
        reportedAt: new Date(),
        status: "final",
      },
      create: {
        orderId: oid,
        prn: prn.toString(),
        testName,
        department: "lab",
        result,
        unit,
        referenceRange,
        criticalFlag,
        reportUrl,
        reportedAt: new Date(),
        status: "final",
      },
    });

    // Log webhook receipt
    await createHmisAuditLog({
      direction: "pull",
      module: "investigation",
      action: "lab_result",
      payload: JSON.stringify({
        prn,
        orderId,
        testName,
        result,
      }),
      status: "success",
    });

    // Broadcast SSE alert only when the lab explicitly marked the result critical.
    // Non-critical results flow to the investigation-results view instead.
    if (investigationResult.criticalFlag === true) {
      await createAlertFromInvestigationResult(investigationResult);
    }

    res.status(200).json({
      message: "Lab result received and processed",
      data: investigationResult,
    });
  } catch (error) {
    console.error("Error processing lab result webhook:", error);

    await createHmisAuditLog({
      direction: "pull",
      module: "investigation",
      action: "lab_result",
      payload: JSON.stringify(req.body),
      status: "failed",
    });

    res.status(500).json({ message: "Error processing webhook", error });
  }
};

/**
 * Radiology result ready webhook from HMIS
 */
export const radiologyResultReadyWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { prn, orderId, testName, result, reportUrl, modality } = req.body;

    if (!prn || !orderId || !testName) {
      res
        .status(400)
        .json({
          message: "Missing required fields: prn, orderId, testName",
        });
      return;
    }

    // See note on lab-result-ready about the upsert-by-id semantic.
    const oid = Number(orderId);
    const investigationResult = await prisma.investigationResult.upsert({
      where: { id: oid },
      update: {
        result,
        reportUrl,
        reportedAt: new Date(),
        status: "final",
      },
      create: {
        orderId: oid,
        prn: prn.toString(),
        testName,
        department: "radiology",
        result,
        reportUrl,
        reportedAt: new Date(),
        status: "final",
      },
    });

    // Log webhook receipt
    await createHmisAuditLog({
      direction: "pull",
      module: "investigation",
      action: "radiology_result",
      payload: JSON.stringify({
        prn,
        orderId,
        testName,
        modality,
      }),
      status: "success",
    });

    res.status(200).json({
      message: "Radiology result received and processed",
      data: investigationResult,
    });
  } catch (error) {
    console.error("Error processing radiology result webhook:", error);

    await createHmisAuditLog({
      direction: "pull",
      module: "investigation",
      action: "radiology_result",
      payload: JSON.stringify(req.body),
      status: "failed",
    });

    res.status(500).json({ message: "Error processing webhook", error });
  }
};

/**
 * Pharmacy dispensed webhook from HMIS
 */
export const pharmacyDispensedWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { prescriptionId, dispensedItems, pharmacistName, timestamp } =
      req.body;

    if (!prescriptionId) {
      res.status(400).json({ message: "Missing prescriptionId" });
      return;
    }

    // The Prescription model has no `dispensed` / `updatedBy` columns, so there is no
    // row mutation to perform — we just fetch and echo it back. (The prior code tried to
    // set `updatedBy` via a `(prisma as any)` cast which silently no-op'd at runtime.
    // A proper `dispensed` column + schema migration is tracked for a later sprint.)
    const prescription = await prisma.prescription.findUnique({
      where: { prescriptionId },
    });

    // Log webhook receipt
    await createHmisAuditLog({
      direction: "pull",
      module: "pharmacy",
      action: "prescription_dispensed",
      payload: JSON.stringify({ prescriptionId, dispensedItems }),
      status: "success",
    });

    res.status(200).json({
      message: "Pharmacy dispensing confirmed",
      data: prescription,
    });
  } catch (error) {
    console.error("Error processing pharmacy dispensed webhook:", error);

    await createHmisAuditLog({
      direction: "pull",
      module: "pharmacy",
      action: "prescription_dispensed",
      payload: JSON.stringify(req.body),
      status: "failed",
    });

    res.status(500).json({ message: "Error processing webhook", error });
  }
};

/**
 * Bed status update webhook from HMIS
 */
export const bedStatusUpdateWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId, status, wardId } = req.body;

    if (!bedId || !status) {
      res
        .status(400)
        .json({ message: "Missing required fields: bedId, status" });
      return;
    }

    // Update bed status. IpdBed.id is a String UUID — do NOT parseInt it (prior code did,
    // which silently produced NaN and broke the webhook).
    const bed = await prisma.ipdBed.update({
      where: { id: String(bedId) },
      data: { status },
    });

    // Log webhook receipt
    await createHmisAuditLog({
      direction: "pull",
      module: "ipd",
      action: "bed_status_update",
      payload: JSON.stringify({ bedId, status, wardId }),
      status: "success",
    });

    res.status(200).json({
      message: "Bed status updated",
      data: bed,
    });
  } catch (error) {
    console.error("Error processing bed status webhook:", error);

    await createHmisAuditLog({
      direction: "pull",
      module: "ipd",
      action: "bed_status_update",
      payload: JSON.stringify(req.body),
      status: "failed",
    });

    res.status(500).json({ message: "Error processing webhook", error });
  }
};

/**
 * Discharge confirmed webhook from HMIS
 */
export const dischargeConfirmedWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { admissionId, dischargeDate, finalBill } = req.body;

    if (!admissionId) {
      res.status(400).json({ message: "Missing admissionId" });
      return;
    }

    // Update admission status to discharged. IpdAdmission.id is a String UUID — do NOT
    // parseInt it (prior code did, which silently produced NaN and broke the webhook).
    const admission = await prisma.ipdAdmission.update({
      where: { id: String(admissionId) },
      data: {
        status: "discharged",
      },
    });

    // Log webhook receipt
    await createHmisAuditLog({
      direction: "pull",
      module: "ipd",
      action: "discharge_confirmed",
      payload: JSON.stringify({ admissionId, dischargeDate, finalBill }),
      status: "success",
    });

    res.status(200).json({
      message: "Discharge confirmed",
      data: admission,
    });
  } catch (error) {
    console.error("Error processing discharge webhook:", error);

    await createHmisAuditLog({
      direction: "pull",
      module: "ipd",
      action: "discharge_confirmed",
      payload: JSON.stringify(req.body),
      status: "failed",
    });

    res.status(500).json({ message: "Error processing webhook", error });
  }
};

// ============================================================================
// HMIS Audit Log & Sync Management Endpoints
// ============================================================================

/**
 * Get audit logs — supports ?limit=&offset=&module=&status=&direction=&fromDate=&toDate=
 */
export const getAuditLogs = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      limit = 50,
      offset = 0,
      module,
      status,
      direction,
      fromDate,
      toDate,
    } = req.query;

    const where: any = {};
    if (module) where.module = module;
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [logs, total] = await Promise.all([
      prisma.hmisAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: parseInt(offset as string),
        take: parseInt(limit as string),
      }),
      prisma.hmisAuditLog.count({ where }),
    ]);

    res.status(200).json({
      message: "Audit logs retrieved",
      data: logs,
      pagination: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({
      message: "Error fetching audit logs",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Get sync status per module — derived from audit log
 */
export const getSyncStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { module } = req.query;

    const modules = module
      ? [module as string]
      : ["patient", "appointment", "opd", "ipd", "investigation", "pharmacy", "emergency", "mlc", "lama", "dama"];

    const statuses = await Promise.all(
      modules.map(async (m) => {
        const latest = await prisma.hmisAuditLog.findFirst({
          where: { module: m },
          orderBy: { createdAt: "desc" },
        });
        const failedCount = await prisma.hmisAuditLog.count({
          where: { module: m, status: "failed" },
        });
        return {
          module: m,
          lastSyncTime: latest?.createdAt,
          status: latest?.status || "unknown",
          action: latest?.action,
          failedCount,
          message: latest?.response
            ? typeof latest.response === "string"
              ? latest.response.slice(0, 200)
              : JSON.stringify(latest.response).slice(0, 200)
            : undefined,
        };
      })
    );

    res.status(200).json({ message: "Sync status retrieved", data: module ? statuses[0] : statuses });
  } catch (error) {
    console.error("Error fetching sync status:", error);
    res.status(500).json({
      message: "Error fetching sync status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Generic manual sync trigger — logs intent
 */
const createManualSyncHandler = (module: string, action: string, idField: string) => {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.body[idField];
      if (!id) {
        res.status(400).json({ message: `${idField} required in body` });
        return;
      }

      const log = await prisma.hmisAuditLog.create({
        data: {
          direction: "push",
          module,
          action: `manual_${action}`,
          payload: JSON.stringify({ [idField]: id, triggeredBy: req.user?.username || "system" }),
          status: "pending",
        },
      });

      res.status(200).json({
        message: `${module} sync queued`,
        data: { logId: log.id, ...{ [idField]: id } },
      });
    } catch (error) {
      console.error(`Error queuing ${module} sync:`, error);
      res.status(500).json({ message: "Error queuing sync", error });
    }
  };
};

export const syncPatient = createManualSyncHandler("patient", "sync", "prn");
export const syncAppointment = createManualSyncHandler("appointment", "sync", "appointmentId");
export const syncInvestigation = createManualSyncHandler("investigation", "sync", "orderId");
export const syncPrescription = createManualSyncHandler("pharmacy", "sync", "prescriptionId");
export const syncIpdAdmission = createManualSyncHandler("ipd", "sync", "admissionId");
export const syncDischarge = createManualSyncHandler("ipd", "sync_discharge", "dischargeId");

/**
 * Get pending syncs (status = pending OR failed with retries available)
 */
export const getPendingSyncs = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const pending = await prisma.hmisAuditLog.findMany({
      where: {
        OR: [{ status: "pending" }, { status: "failed", retryCount: { lt: 3 } }],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    res.status(200).json({ message: "Pending syncs retrieved", data: pending });
  } catch (error) {
    console.error("Error fetching pending syncs:", error);
    res.status(500).json({
      message: "Error fetching pending syncs",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Retry a specific failed sync
 */
export const retrySyncLog = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { logId } = req.params;
    const log = await prisma.hmisAuditLog.findUnique({
      where: { id: parseInt(logId) },
    });

    if (!log) {
      res.status(404).json({ message: "Sync log not found" });
      return;
    }

    const updated = await prisma.hmisAuditLog.update({
      where: { id: log.id },
      data: {
        retryCount: log.retryCount + 1,
        status: "pending",
      },
    });

    res.status(200).json({ message: "Sync retry triggered", data: updated });
  } catch (error) {
    console.error("Error retrying sync:", error);
    res.status(500).json({
      message: "Error retrying sync",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Retry all failed syncs (with retryCount < 3)
 */
export const retryAllFailedSyncs = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const failed = await prisma.hmisAuditLog.findMany({
      where: { status: "failed", retryCount: { lt: 3 } },
    });

    await Promise.all(
      failed.map((l) =>
        prisma.hmisAuditLog.update({
          where: { id: l.id },
          data: { retryCount: l.retryCount + 1, status: "pending" },
        })
      )
    );

    res.status(200).json({
      message: "All failed syncs queued for retry",
      data: { count: failed.length },
    });
  } catch (error) {
    console.error("Error retrying all syncs:", error);
    res.status(500).json({
      message: "Error retrying all syncs",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Sync statistics
 */
export const getSyncStats = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromDate, toDate } = req.query;
    const where: any = {};
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [total, success, failed, pending] = await Promise.all([
      prisma.hmisAuditLog.count({ where }),
      prisma.hmisAuditLog.count({ where: { ...where, status: "success" } }),
      prisma.hmisAuditLog.count({ where: { ...where, status: "failed" } }),
      prisma.hmisAuditLog.count({ where: { ...where, status: "pending" } }),
    ]);

    const byModuleRaw = await prisma.hmisAuditLog.groupBy({
      by: ["module", "status"],
      where,
      _count: { _all: true },
    });

    const byModule: Record<string, any> = {};
    byModuleRaw.forEach((r) => {
      if (!byModule[r.module]) byModule[r.module] = { success: 0, failed: 0, pending: 0 };
      byModule[r.module][r.status] = r._count._all;
    });

    res.status(200).json({
      message: "Sync statistics retrieved",
      data: {
        total,
        success,
        failed,
        pending,
        successRate: total ? Math.round((success / total) * 100) : 0,
        byModule,
      },
    });
  } catch (error) {
    console.error("Error fetching sync stats:", error);
    res.status(500).json({
      message: "Error fetching sync stats",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * HMIS health status
 */
export const getHmisHealth = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    const [recentSuccess, recentFailed] = await Promise.all([
      prisma.hmisAuditLog.count({
        where: { status: "success", createdAt: { gte: lastHour } },
      }),
      prisma.hmisAuditLog.count({
        where: { status: "failed", createdAt: { gte: lastHour } },
      }),
    ]);

    const total = recentSuccess + recentFailed;
    const healthy = total === 0 || recentSuccess / total >= 0.9;

    res.status(200).json({
      message: "HMIS health status",
      data: {
        healthy,
        status: healthy ? "healthy" : "degraded",
        recentHour: { success: recentSuccess, failed: recentFailed, total },
        successRate: total ? Math.round((recentSuccess / total) * 100) : 100,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Error fetching HMIS health:", error);
    res.status(500).json({
      message: "Error fetching HMIS health",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Failed syncs count
 */
export const getFailedSyncsCount = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const count = await prisma.hmisAuditLog.count({ where: { status: "failed" } });
    res.status(200).json({ count });
  } catch (error) {
    console.error("Error fetching failed syncs count:", error);
    res.status(500).json({ message: "Error", error });
  }
};

/**
 * Download audit log report as CSV
 */
export const downloadAuditReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromDate, toDate } = req.query;
    const where: any = {};
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const logs = await prisma.hmisAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
    });

    const headers = ["ID", "Direction", "Module", "Action", "Status", "RetryCount", "CreatedAt", "PayloadSummary"];
    const rows = logs.map((l) => [
      l.id,
      l.direction,
      l.module,
      l.action,
      l.status,
      l.retryCount,
      l.createdAt.toISOString(),
      (l.payload || "").slice(0, 120).replace(/,/g, ";").replace(/\n/g, " "),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="hmis-audit-log.csv"');
    res.status(200).send(csv);
  } catch (error) {
    console.error("Error downloading audit report:", error);
    res.status(500).json({
      message: "Error downloading audit report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Download sync status report as CSV
 */
export const downloadSyncReport = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const modules = ["patient", "appointment", "opd", "ipd", "investigation", "pharmacy", "emergency", "mlc", "lama", "dama"];
    const rows = await Promise.all(
      modules.map(async (m) => {
        const latest = await prisma.hmisAuditLog.findFirst({
          where: { module: m },
          orderBy: { createdAt: "desc" },
        });
        const failed = await prisma.hmisAuditLog.count({ where: { module: m, status: "failed" } });
        return [
          m,
          latest?.status || "none",
          latest?.createdAt?.toISOString() || "never",
          failed,
        ];
      })
    );

    const csv = ["Module,LastStatus,LastSync,FailedCount", ...rows.map((r) => r.join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="hmis-sync-status.csv"');
    res.status(200).send(csv);
  } catch (error) {
    console.error("Error downloading sync report:", error);
    res.status(500).json({
      message: "Error downloading sync report",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Clear audit logs older than N days
 */
export const clearAuditLogs = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { olderThanDays = 90 } = req.body;
    const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await prisma.hmisAuditLog.deleteMany({
      where: { createdAt: { lt: threshold }, status: "success" },
    });

    res.status(200).json({
      message: "Audit logs cleared",
      data: { deleted: result.count, olderThanDays },
    });
  } catch (error) {
    console.error("Error clearing audit logs:", error);
    res.status(500).json({
      message: "Error clearing audit logs",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Get webhook delivery logs
 */
export const getWebhookLogs = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { limit = 50 } = req.query;
    const logs = await prisma.hmisAuditLog.findMany({
      where: { direction: "pull" },
      orderBy: { createdAt: "desc" },
      take: parseInt(limit as string),
    });
    res.status(200).json({ message: "Webhook logs retrieved", data: logs });
  } catch (error) {
    console.error("Error fetching webhook logs:", error);
    res.status(500).json({
      message: "Error fetching webhook logs",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Retry webhook delivery
 */
export const retryWebhookDelivery = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { webhookId } = req.params;
    const log = await prisma.hmisAuditLog.findUnique({
      where: { id: parseInt(webhookId) },
    });
    if (!log) {
      res.status(404).json({ message: "Webhook log not found" });
      return;
    }
    const updated = await prisma.hmisAuditLog.update({
      where: { id: log.id },
      data: { retryCount: log.retryCount + 1, status: "pending" },
    });
    res.status(200).json({ message: "Webhook retry queued", data: updated });
  } catch (error) {
    console.error("Error retrying webhook:", error);
    res.status(500).json({
      message: "Error retrying webhook",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
