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
import callBackRoutes from './api/callback/callback.routes'

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
// app.use(express.json());
app.use(helmet());
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ limit: '1gb', extended: true }));

app.use(cors({
  origin: ['http://localhost:4200','https://www.rashtrotthanahospital.com/','https://rashtrotthanahospital.docminds.in/',
    'https://www.publicholidaysglobal.com/api/holidays/IN/2024','https://demo.docminds.in',
     'http://192.168.9.139:4200/', 'https://vasavihospitals.com/', 'https://docminds.inventionminds.com/', 'https://docmindsjmrh.imapps.in/'], 
  methods: ['GET', 'POST'],
  credentials: true
}));


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
app.use('/api/call-back',callBackRoutes)


app.use(compression())

// Sample route to check server status
app.get('/', (req, res) => {
  res.send('Server is up and running');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const unexpectedErrorHandler = (error: Error) => {
  console.error(error);
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);
