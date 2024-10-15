import express from 'express';
import doctorRoutes from './src/doctor/doctor.routes';
import departmentRoutes from './src/department/department.routes';
import appointmentRoutes from './src/appointments/appointment.routes';
import loginRoutes from './src/login/login.routes';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();


const app = express();
app.use(cors());
app.use(express.json());
app.use(cors({origin: 'http://localhost:51167/'}));
app.use(cors({
  origin: 'http://localhost:4200', // Adjust to match your Angular app's URL
  methods: ['GET', 'POST'],
  credentials: true
}));

// Use department and doctor routes
app.use('/api/doctors', doctorRoutes);  // The issue might be here.
app.use('/api/departments', departmentRoutes);  // The issue might be here.
app.use('/api/appointments', appointmentRoutes);
app.use('/api/login', loginRoutes);

// Sample route to check server status
app.get('/', (req, res) => {
  res.send('Server is up and running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
