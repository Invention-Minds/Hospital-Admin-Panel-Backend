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
// Phase 9 — sync hardening
import {
  listDeadLetters,
  getDeadLetter,
  resolveDeadLetter,
  runDeadLetterMover,
  listConflicts,
  getConflict,
  createConflict,
  resolveConflict,
} from "./hmis-hardening.controller";
import { authenticateToken } from "../../middleware/middleware";
import { verifyWebhookSecret } from "../../middleware/webhook-secret";

const router = express.Router();

// ============================================================================
// Webhook receivers — authenticated by shared secret (X-Webhook-Secret),
// NOT JWT (the HMIS is an external system, not a logged-in user).
// ============================================================================
const webhookAuth = verifyWebhookSecret("HMIS_WEBHOOK_SECRET");
router.post("/webhooks/payment-confirmed", webhookAuth, paymentConfirmedWebhook);
router.post("/webhooks/lab-result-ready", webhookAuth, labResultReadyWebhook);
router.post("/webhooks/radiology-result-ready", webhookAuth, radiologyResultReadyWebhook);
router.post("/webhooks/pharmacy-dispensed", webhookAuth, pharmacyDispensedWebhook);
router.post("/webhooks/bed-status-update", webhookAuth, bedStatusUpdateWebhook);
router.post("/webhooks/discharge-confirmed", webhookAuth, dischargeConfirmedWebhook);

// Public health probe (uptime monitors) — must stay unauthenticated.
router.get("/health", getHmisHealth);

// ============================================================================
// Everything below is staff/admin tooling — JWT required.
// ============================================================================
router.use(authenticateToken);

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

// Stats & health (/health is registered above as a public probe)
router.get("/stats", getSyncStats);
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

// ============================================================================
// Phase 9 — Sync hardening
// ============================================================================
router.get("/dead-letter", listDeadLetters);
router.get("/dead-letter/:id", getDeadLetter);
router.post("/dead-letter/:id/resolve", resolveDeadLetter);
router.post("/dead-letter/run-mover", runDeadLetterMover);

router.get("/conflicts", listConflicts);
router.get("/conflicts/:id", getConflict);
router.post("/conflicts", createConflict);
router.post("/conflicts/:id/resolve", resolveConflict);

export default router;
