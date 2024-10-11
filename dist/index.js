"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });

const express_1 = __importDefault(require("express"));
const doctor_routes_1 = __importDefault(require("./doctor/doctor.routes"));
const department_routes_1 = __importDefault(require("./department/department.routes")); // Import department routes
const appointment_routes_1 =__importDefault(require("./appointments/appointment.routes"))
const cors_1 = __importDefault(require("cors"));

const app = (0, express_1.default)();

// Apply CORS Middleware before routes
app.use((0, cors_1.default)());
app.use(express_1.default.json());

// Use doctor routes and department routes
app.use('/api/doctors', doctor_routes_1.default);
app.use('/api/departments', department_routes_1.default);
app.use('/api/appointments', appointment_routes_1.default);

// Sample health check route to ensure server status
app.get('/', (req, res) => {
    res.send('Server is up and running');
});

// Catch-all route for non-existent endpoints
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});

// Error handler middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
