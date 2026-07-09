/// <reference path="../global.d.ts" />

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';

import doctorRoutes from './api/doctor/doctor.routes';
import departmentRoutes from './api/department/department.routes';
import surgeonRoutes from './api/surgeon/surgeon.routes';
import appointmentRoutes from './api/appointments/appointment.routes';
import loginRoutes from './api/login/login.routes';
import whatsappRoutes from './api/whatsapp/whatsapp.routes';
import emailRoutes from './api/email/email.routes';
import patientRoutes from './api/patient/patient.routes';
import smsRoutes from './api/sms/sms.routes';
import uploadRoutes from './api/upload/upload.routes';
import serviceRoutes from './api/services/services.routes';
import estimationRoutes from './api/estimation/estimation.routes';
import channelRoutes from './api/channel/channel.routes';
import screenshotRoutes from './api/screenshot/screenshot.routes';
import extraSlotCountRoutes from './api/extraslots/extraslots.router';
import adRoutes from './api/ad/ad.routes';
import serviceRadiologyRoutes from './api/service-radiology/service-radiology.routes';
import whatsappBotRoutes from './api/whatsapp-bot/whatsapp-bot.routes';
import whatsappQueryRoutes from './api/whatsapp-query/whatsapp-query.routes';
import doorstepRoutes from './api/doorstep/doorstep.routes';
import doctorNotesRoutes from './api/doctor-notes/doctor-notes.routes';
import prescriptionRoutes from './api/prescription/prescription.routes';
import historyRoutes from './api/history-notes/history-notes.routes';
import investigationRoutes from './api/investigation/investigation.routes';
import queueRoutes from './api/mhc-checkin/mhc-checkin.routes';
import radiologyQueueRoutes from './api/radiology-queue/radiologu-queue.routes';
import opdRoutes from './api/opd/opd.routes';
import erRoutes from './api/er/er.routes';
import therapyRoutes from './api/therapy/therapy.routes';
import callBackRoutes from './api/callback/callback.routes';
import voiceOPDRoutes from './api/voiceOPD/voiceOPD.routes';
import emergencyRoutes from './api/emergency/emergency.routes';
import incidentRoutes from './api/incident/incident.routes';
import feedbackRoutes from './api/feedback/feedback.routes';
import complaintRoutes from './api/feedback/complaint.routes';
import qualityRoutes from './api/quality/quality.routes';
import qualityIndicatorRoutes from './api/quality/quality-indicator.routes';
import qualityRcaRoutes from './api/quality/quality-rca.routes';
import qualityAuditObservationRoutes from './api/quality/quality-audit-observation.routes';
import qualityDenominatorRoutes from './api/quality/quality-denominator.routes';
import {
  surveillanceEventsRouter, deviceDaysRouter, sterilizationCyclesRouter,
} from './api/quality/quality-surveillance.routes';
import {
  equipmentRouter, equipmentEventsRouter, utilityFailuresRouter,
  ambulanceCallsRouter, maintenanceComplaintsRouter,
} from './api/quality/quality-facility.routes';
import qualityTatEventRoutes from './api/quality/quality-tat-event.routes';
import { criticalDrugsRouter, stockEventsRouter } from './api/quality/quality-pharmacy.routes';
import qualityLabRadRoutes from './api/quality/quality-lab-rad.routes';
import roleAliasRoutes from './api/role-alias/role-alias.routes';
import emergencyCodesRoutes from './api/emergency-codes/emergency-codes.routes';
import mlcRoutes from './api/mlc/mlc.routes';
import lamaDamaRoutes from './api/lama-dama/lama-dama.routes';
import hmisSyncRoutes from './api/hmis-sync/hmis-sync.routes';
import ipdRoutes from './api/ipd/ipd.routes';
import ipdPrescriptionRoutes from './api/ipd/ipd-prescription.routes';
import wardManagementRoutes from './api/ipd/ward-management.routes';
import criticalValuesRoutes from './api/hmis-sync/critical-values.routes';
import priorityRoutes from './api/priority/priority.routes';
import signatureRoutes from './api/signature/signature.routes';
import featureFlagRoutes from './api/feature-flag/feature-flag.routes';
import consentRoutes from './api/consent/consent.routes';
import revenueRoutes from './api/revenue/revenue.routes';
import { registerRevenueCron } from './api/revenue/revenue.cron';
import { registerHmisHardeningCron } from './api/hmis-sync/hmis-hardening.cron';
import bedRequestRoutes from './api/bed-request/bed-request.routes';
import dailyClosureRoutes from './api/daily-closure/daily-closure.routes';
import icuTransferRoutes from './api/icu-transfer/icu-transfer.routes';
import icuClinicalRoutes from './api/icu-clinical/icu-clinical.routes';
import staffHandoverRoutes from './api/staff-handover/staff-handover.routes';
import nabhAuditRoutes from './api/nabh-audit/nabh-audit.routes';
import otWorkflowRoutes from './api/ot-workflow/ot-workflow.routes';
import noteTemplateRoutes from './api/note-template/note-template.routes';
import dieteticsRoutes from './api/dietetics/dietetics.routes';
import schedulingRoutes from './api/scheduling/scheduling.routes';
import dayCareRoutes from './api/day-care/day-care.routes';
import diagnosisCodeMasterRoutes from './api/masters/diagnosis-code-master.routes';
import opProcedureRoutes from './api/op-procedure/op-procedure.routes';
import dashboardRoutes from './api/dashboard/dashboard.routes';
import staffAdminRoutes from './api/staff/staff.routes';
import nursingStationRoutes from './api/nursing-station/nursing-station.routes';
import investigationResultRoutes from './api/investigation-result/investigation-result.routes';
import treatmentDashboardRoutes from './api/treatment-dashboard/treatment-dashboard.routes';
import attendanceRoutes from './api/attendance/attendance.routes';
import moduleUsageRoutes from './api/module-usage/module-usage.routes';
import { registerAcuityRefreshCron } from './api/treatment-dashboard/treatment-dashboard.cron';
import { registerReferralEscalationCron } from './api/emergency/referral-escalation.cron';
import { registerIncidentRulesCron } from './api/incident/incident-rules.cron';
import { registerQualityAutoSourceCron } from './api/quality/quality-indicator-auto.cron';
import { registerQualityOutlierCron } from './api/quality/quality-outlier.cron';
import { registerQualityDataQualityCron } from './api/quality/quality-data-quality';
import { registerFeedbackSendCron } from './api/feedback/feedback-send.cron';
import { registerComplaintSlaCron } from './api/feedback/complaint-sla.cron';
import { registerFeedbackExpiryCron } from './api/feedback/feedback-expiry.cron';
import { registerFeedbackReminderCron } from './api/feedback/feedback-reminder.cron';
import { registerMealOrderCron } from './api/dietetics/meal-order.cron';
import { clearAllPriorities } from './api/priority/priority.controller';
import { hmisSyncQueue } from './api/hmis-sync/hmis-sync.queue';
import { initializeFollowUpReminders } from './api/ipd/follow-up-automation';
import { registerBedCensusCron } from './api/ipd/bed-census-snapshot';
import { registerDischargeSummaryNagCron } from './api/ipd/discharge-summary-nag.cron';
import { registerWhatsappAutoCloseCron } from './api/whatsapp-bot/whatsapp-auto-close.cron';
import { registerWhatsappMediaCleanupCron } from './api/whatsapp-bot/whatsapp-media-cleanup.cron';
import { softAuth, securityLogger } from './middleware/security-logger';
import { registerSecurityAlertCron, registerSecurityLogPruneCron } from './service/security-alert.cron';
import { globalRateLimit, initGlobalRateLimit } from './middleware/global-rate-limit';
import securityRoutes from './api/security/security.routes';
import notificationRecipientRoutes from './api/notification-recipient/notification-recipient.routes';

// Load environment variables from .env file
dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}

const PORT = process.env.PORT || 3000;

const app = express();

// Behind nginx/LB: trust the first proxy hop so req.ip is the real client IP
// (used by rate limiting + security logging) instead of the proxy address.
app.set('trust proxy', 1);

// Allowed CORS origins. Override in prod via CORS_ALLOWED_ORIGINS (comma-
// separated); falls back to the built-in list (incl. local dev origins) when
// the env var is unset.
const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [
    'http://localhost:4200',
    // Mobile app: Ionic dev server + Capacitor native webview origins
    'http://localhost:8100',
    'http://localhost:8101',
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    'ionic://localhost',
    'https://www.rashtrotthanahospital.com',
    'https://rashtrotthanahospital.docminds.in',
    'https://demo.docminds.in',
    'http://192.168.9.139:4200',
    'https://vasavihospitals.com',
    'https://docminds.inventionminds.com',
    'https://docmindsjmrh.imapps.in',
    'http://192.168.13.148:4200',
  ];

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(helmet());
// Body size cap. 1gb was a DoS vector; 50mb covers base64 image/PDF JSON
// payloads. Tune via JSON_BODY_LIMIT. File uploads use multipart (multer),
// which is not bounded by this.
const bodyLimit = process.env.JSON_BODY_LIMIT || '50mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

// Security request logging — soft-auth (decode token if present, never reject)
// then log every request on finish. No-op unless SECURITY_LOGGING_ENABLED=true.
app.use(securityLogger);
app.use(softAuth);
// Global per-IP rate limiter — 429 + auto-block on abuse. Whitelist + loopback
// exempt. No-op when GLOBAL_RATE_LIMIT_ENABLED=false.
app.use(globalRateLimit);


// Use department and doctor routes
app.use('/api/doctors', doctorRoutes);  
app.use('/api/departments', departmentRoutes);
app.use('/api/surgeons', surgeonRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/login', loginRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/storage',uploadRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/estimation', estimationRoutes);
app.use('/api/channel', channelRoutes);
app.use('/api/capture-screenshoot', screenshotRoutes);
app.use('/api/extraslot-count', extraSlotCountRoutes);
app.use('/api/ads',adRoutes);
app.use('/api/radiology',serviceRadiologyRoutes);
app.use('/api/callback', whatsappBotRoutes);
app.use('/api/whatsapp-query', whatsappQueryRoutes);
app.use('/api/doorstep', doorstepRoutes);
app.use('/api/doctor-notes',doctorNotesRoutes);
app.use('/api/prescription', prescriptionRoutes);
app.use('/api/history-notes', historyRoutes);
app.use('/api/investigation', investigationRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/radiology-queue', radiologyQueueRoutes);
app.use('/api/opd', opdRoutes);
app.use('/api/er', erRoutes);
app.use('/api/therapy-appt', therapyRoutes);
app.use('/api/call-back',callBackRoutes);
app.use('/api/voice-opd', voiceOPDRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/emergency-codes', emergencyCodesRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/quality/indicators', qualityIndicatorRoutes);
app.use('/api/quality/rcas', qualityRcaRoutes);
app.use('/api/quality/audit-observations', qualityAuditObservationRoutes);
app.use('/api/quality/denominators', qualityDenominatorRoutes);
app.use('/api/quality/surveillance-events', surveillanceEventsRouter);
app.use('/api/quality/device-days', deviceDaysRouter);
app.use('/api/quality/sterilization-cycles', sterilizationCyclesRouter);
app.use('/api/quality/equipment', equipmentRouter);
app.use('/api/quality/equipment-events', equipmentEventsRouter);
app.use('/api/quality/utility-failures', utilityFailuresRouter);
app.use('/api/quality/ambulance-calls', ambulanceCallsRouter);
app.use('/api/quality/maintenance-complaints', maintenanceComplaintsRouter);
app.use('/api/quality/tat-events', qualityTatEventRoutes);
app.use('/api/quality/pharmacy/critical-drugs', criticalDrugsRouter);
app.use('/api/quality/pharmacy/stock-events', stockEventsRouter);
app.use('/api/quality/lab-rad-events', qualityLabRadRoutes);
app.use('/api/role-aliases', roleAliasRoutes);
app.use('/api/mlc', mlcRoutes);
app.use('/api/lama-dama', lamaDamaRoutes);
app.use('/api/hmis-sync', hmisSyncRoutes);
app.use('/api/ipd', ipdRoutes);
app.use('/api/ipd-pharmacy', ipdPrescriptionRoutes);
app.use('/api/ward', wardManagementRoutes);
app.use('/api/critical-values', criticalValuesRoutes);
app.use('/api/priority', priorityRoutes);
app.use('/api/signature', signatureRoutes);
app.use('/api/feature-flag', featureFlagRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/bed-request', bedRequestRoutes);
app.use('/api/daily-closure', dailyClosureRoutes);
app.use('/api/icu-transfer', icuTransferRoutes);
// Phase 9.6 — ICU clinical artefacts (vitals, progress, sedation, restraints,
// bundles, family comms, step-down). All admission-scoped.
app.use('/api/ipd', icuClinicalRoutes);
app.use('/api/staff-handover', staffHandoverRoutes);
app.use('/api/nabh-audit', nabhAuditRoutes);
app.use('/api/ot', otWorkflowRoutes);
app.use('/api/note-template', noteTemplateRoutes);
app.use('/api/dietetics', dieteticsRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/day-care', dayCareRoutes);
app.use('/api/masters/diagnosis-codes', diagnosisCodeMasterRoutes);
app.use('/api/op-procedures', opProcedureRoutes);
app.use('/api/dashboard', dashboardRoutes);
// Phase 9.10 — Nurse / clinical-staff admin (separate from OT staff master)
app.use('/api/staff', staffAdminRoutes);
app.use('/api/nursing-stations', nursingStationRoutes);
// Phase 9.11 — Lab & Radiology results (upload, list, view, ack)
app.use('/api/investigation-results', investigationResultRoutes);
// Phase 9.13 — Treatment Dashboard (NEWS2 deterioration watchboard)
app.use('/api/treatment-dashboard', treatmentDashboardRoutes);
app.use('/api/attendance', attendanceRoutes);
// Security — super-admin IP block management (rate limiter)
app.use('/api/security', securityRoutes);
// Message recipient phone numbers (DB-managed, per deployment)
app.use('/api/notification-recipients', notificationRecipientRoutes);
// Module Utilization analytics — per-module active vs inactive users (AppAuditLog)
app.use('/api/module-usage', moduleUsageRoutes);

app.use('/files', express.static(process.env.PDF_STORAGE_DIR || '/var/www/docminds/pdfs'));


app.use(compression())

// Sample route to check server status
app.get('/', (req, res) => {
  res.send('Server is up and running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // Initialize Phase 3 background services
  setTimeout(() => {
    console.log('\n🚀 Initializing Phase 3 services...');

    // Initialize HMIS polling queue (lab/radiology results, bed availability, retry logic)
    // hmisSyncQueue.initializePollingJobs();

    // Initialize follow-up appointment reminders (daily at 8 AM)
    initializeFollowUpReminders();

    // // Sprint 4a Phase 1e — Daily bed census snapshot cron (00:05 local)
    // registerBedCensusCron();

    // Patient priority — clear in-memory map at midnight (same-day data only)
    const cron = require('node-cron');
    cron.schedule('0 0 * * *', () => {
      clearAllPriorities();
    });
    console.log('✅ Patient priority daily-reset cron registered (00:00)');

    // Phase 2.5 / WF-1 — nightly revenue rollup at 00:30
    registerRevenueCron();

    // Phase 9 — HMIS dead-letter mover (every 15 min)
    registerHmisHardeningCron();

    // Dietetics — nightly MealOrder generator (22:00 local for "tomorrow")
    registerMealOrderCron();

    // Phase 9.13 — Treatment Dashboard NEWS2 acuity refresh (every 30 min)
    registerAcuityRefreshCron();

    // Phase 9.19 — Emergency referral escalation sweep (every 3 min)
    registerReferralEscalationCron();

    // Phase 9.24 — Incident auto-capture sweep (every 15 min)
    registerIncidentRulesCron();

    // Phase D — Nag the doctor every 15 min until the discharge summary is
    // signed; escalates to HOD after 2 missed cycles.
    registerDischargeSummaryNagCron();

    // WhatsApp bot — auto-close stale patient queries (daily 01:30)
    registerWhatsappAutoCloseCron();

    // WhatsApp bot — delete patient media past the retention window (daily 02:00)
    registerWhatsappMediaCleanupCron();

    // Phase 9.25 — Patient feedback survey auto-creator (every 30 min)
    registerFeedbackSendCron();

    // Phase 9.25 / Phase 6a — Complaint SLA breach auto-escalation (every 15 min)
    registerComplaintSlaCron();

    // Phase 9.25 / Phase 6d — Feedback survey expiry (hourly) + reminder (4h)
    registerFeedbackExpiryCron();
    registerFeedbackReminderCron();

    // Phase 9.26 / Phase 2 — Monthly QI auto-source (1st of month, 02:00)
    registerQualityAutoSourceCron();

    // Phase 9.26 / Phase 4 — Single-case outlier scanner (every 30 min)
    registerQualityOutlierCron();

    // Phase 9.26 / Phase 4 — Missing-record data-quality sweep (Mon 09:00)
    registerQualityDataQualityCron();

    // Security logging — aggregated threat-alert flush (~5 min) + daily log prune.
    registerSecurityAlertCron();
    registerSecurityLogPruneCron();

    // Global rate limiter — load active IP blocks into memory + refresh loop.
    initGlobalRateLimit();

    console.log('✅ Phase 3 services initialized successfully\n');
  }, 2000); // Wait 2 seconds to ensure database connection
});

const unexpectedErrorHandler = (error: Error) => {
  console.error(error);
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);
