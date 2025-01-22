/// <reference path="../global.d.ts" />

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

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
import { channel } from 'diagnostics_channel';

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());

app.use(cors({
  origin: ['http://localhost:4200','https://rashtrotthanahosptial.netlify.app/', 'https://hosptial-admin-panel.netlify.app/','http://localhost:58679/','https://www.rashtrotthanahospital.com/','http://localhost:63904/','https://rashtrotthanahospital.docminds.in/','https://www.publicholidaysglobal.com/api/holidays/IN/2024'], 
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
