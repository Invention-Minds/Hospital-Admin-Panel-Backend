import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

import doctorRoutes from './src/api/doctor/doctor.routes';
import departmentRoutes from './src/api/department/department.routes';
import appointmentRoutes from './src/api/appointments/appointment.routes';
import loginRoutes from './src/api/login/login.routes';
import whatsappRoutes from './src/api/whatsapp/whatsapp.routes';
import emailRoutes from './src/api/email/email.routes';

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());

app.use(cors({
  origin: 'http://localhost:4200', 
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