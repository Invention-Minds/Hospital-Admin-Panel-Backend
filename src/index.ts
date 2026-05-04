/// <reference path="../global.d.ts" />

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';

import doctorRoutes from './api/doctor/doctor.routes';
import departmentRoutes from './api/department/department.routes';
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
import { clearAllPriorities } from './api/priority/priority.controller';
import { hmisSyncQueue } from './api/hmis-sync/hmis-sync.queue';
import { initializeFollowUpReminders } from './api/ipd/follow-up-automation';
import { registerBedCensusCron } from './api/ipd/bed-census-snapshot';

// Load environment variables from .env file
dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}

const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors({
  origin: [
    'http://localhost:4200',
    'https://www.rashtrotthanahospital.com',
    'https://rashtrotthanahospital.docminds.in',
    'https://demo.docminds.in',
    'http://192.168.9.139:4200',
    'https://vasavihospitals.com',
    'https://docminds.inventionminds.com',
    'https://docmindsjmrh.imapps.in',
    'http://192.168.13.148:4200',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(helmet());
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ limit: '1gb', extended: true }));


// Use department and doctor routes
app.use('/api/doctors', doctorRoutes);  
app.use('/api/departments', departmentRoutes);  
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

    // // Initialize follow-up appointment reminders (daily at 8 AM)
    // initializeFollowUpReminders();

    // // Sprint 4a Phase 1e — Daily bed census snapshot cron (00:05 local)
    // registerBedCensusCron();

    // Patient priority — clear in-memory map at midnight (same-day data only)
    const cron = require('node-cron');
    cron.schedule('0 0 * * *', () => {
      clearAllPriorities();
    });
    console.log('✅ Patient priority daily-reset cron registered (00:00)');

    console.log('✅ Phase 3 services initialized successfully\n');
  }, 2000); // Wait 2 seconds to ensure database connection
});

const unexpectedErrorHandler = (error: Error) => {
  console.error(error);
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);
