import express from "express";
import {
  paymentConfirmedWebhook,
  labResultReadyWebhook,
  radiologyResultReadyWebhook,
  pharmacyDispensedWebhook,
  bedStatusUpdateWebhook,
  dischargeConfirmedWebhook,
  getAuditLogs,
  getSyncStatus,
  syncPatient,
  syncAppointment,
  syncInvestigation,
  syncPrescription,
  syncIpdAdmission,
  syncDischarge,
  getPendingSyncs,
  retrySyncLog,
  retryAllFailedSyncs,
  getSyncStats,
  getHmisHealth,
  getFailedSyncsCount,
  downloadAuditReport,
  downloadSyncReport,
  clearAuditLogs,
  getWebhookLogs,
  retryWebhookDelivery,
} from "./hmis-sync.controller";

const router = express.Router();

// ============================================================================
// Webhook receivers (no auth — HMIS posts here)
// ============================================================================
router.post("/webhooks/payment-confirmed", paymentConfirmedWebhook);
router.post("/webhooks/lab-result-ready", labResultReadyWebhook);
router.post("/webhooks/radiology-result-ready", radiologyResultReadyWebhook);
router.post("/webhooks/pharmacy-dispensed", pharmacyDispensedWebhook);
router.post("/webhooks/bed-status-update", bedStatusUpdateWebhook);
router.post("/webhooks/discharge-confirmed", dischargeConfirmedWebhook);

// ============================================================================
// Audit & Sync Management
// ============================================================================

// Audit logs
router.get("/audit-logs", getAuditLogs);
router.get("/audit-logs/download", downloadAuditReport);
router.post("/audit-logs/clear", clearAuditLogs);

// Sync status
router.get("/status", getSyncStatus);
router.get("/status/download", downloadSyncReport);

// Stats & health
router.get("/stats", getSyncStats);
router.get("/health", getHmisHealth);
router.get("/failed-syncs-count", getFailedSyncsCount);

// Manual sync triggers
router.post("/sync/patient", syncPatient);
router.post("/sync/appointment", syncAppointment);
router.post("/sync/investigation", syncInvestigation);
router.post("/sync/prescription", syncPrescription);
router.post("/sync/ipd-admission", syncIpdAdmission);
router.post("/sync/discharge", syncDischarge);

// Retry management
router.get("/pending-syncs", getPendingSyncs);
router.post("/sync/retry-all", retryAllFailedSyncs);
router.post("/sync/:logId/retry", retrySyncLog);

// Webhook management
router.get("/webhook-logs", getWebhookLogs);
router.post("/webhooks/:webhookId/retry", retryWebhookDelivery);

export default router;
