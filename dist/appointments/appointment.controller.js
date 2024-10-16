"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppointmentsByRole = exports.getAppointmentsByUser = exports.getPendingAppointments = exports.getTotalAppointments = exports.deleteAppointment = exports.updateAppointment = exports.getAppointments = exports.createAppointment = void 0;
const appointment_resolver_1 = __importDefault(require("./appointment.resolver"));
const doctor_repository_1 = __importDefault(require("../doctor/doctor.repository"));
const appointment_repository_1 = __importDefault(require("./appointment.repository"));
const resolver = new appointment_resolver_1.default();
const doctorRepository = new doctor_repository_1.default();
const appointmentRepository = new appointment_repository_1.default();
const createAppointment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        req.body.status = req.body.status === 'Confirm' ? 'confirmed' :
            req.body.status === 'Cancel' ? 'cancelled' : req.body.status;
        const { patientName, phoneNumber, doctorName, doctorId, department, time, status, email, requestVia, smsSent, emailSent } = req.body;
        // Convert the date to "YYYY-MM-DD" format
        let date = new Date(req.body.date).toISOString().split('T')[0];
        // Ensure the status field matches Prisma enum
        const bookedSlots = yield doctorRepository.getBookedSlots(doctorId, date);
        const isSlotAvailable = !bookedSlots.some(slot => slot.time === time);
        if (!isSlotAvailable) {
            res.status(400).json({ error: 'Selected slot is not available' });
            return;
        }
        // Check availability before proceeding
        const day = new Date(req.body.date).toLocaleString('en-us', { weekday: 'short' }).toLowerCase(); // Get the day, e.g., 'mon', 'tue', etc.
        const doctorAvailability = yield doctorRepository.getDoctorAvailability(doctorId, day);
        if (!doctorAvailability) {
            res.status(400).json({ error: 'Doctor is not available on the selected day.' });
            return;
        }
        const slotDuration = doctorAvailability.slotDuration;
        const availableFrom = doctorAvailability.availableFrom.split('-');
        const availableStartTime = availableFrom[0];
        const availableEndTime = availableFrom[1];
        // Check if the requested time falls within the available slots
        const requestedTime = time.split('-');
        if (requestedTime[0] < availableStartTime || requestedTime[1] > availableEndTime) {
            res.status(400).json({ error: 'Selected time slot is not available.' });
            return;
        }
        const userId = req.body.userId || null;
        // Create the appointment with Prisma
        const newAppointment = yield resolver.createAppointment({
            patientName,
            phoneNumber,
            doctorName,
            doctorId,
            department,
            date, // Ensure the date is in the proper format
            time,
            status,
            email,
            requestVia,
            smsSent,
            emailSent,
            userId
        });
        console.log("New Appointment:", newAppointment);
        if (newAppointment.status === 'confirmed') {
            yield doctorRepository.addBookedSlot(doctorId, date, time);
            res.status(201).json(newAppointment);
        }
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.createAppointment = createAppointment;
const getAppointments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const appointments = yield resolver.getAppointments();
        res.status(200).json(appointments);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.getAppointments = getAppointments;
const updateAppointment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.body.userId || null;
        const updatedAppointment = yield resolver.updateAppointment(Number(req.params.id), Object.assign(Object.assign({}, req.body), { userId }));
        res.status(200).json(updatedAppointment);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.updateAppointment = updateAppointment;
const deleteAppointment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield resolver.deleteAppointment(Number(req.params.id));
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.deleteAppointment = deleteAppointment;
// Endpoint to get total appointments for today
const getTotalAppointments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date } = req.query; // Get today's date from query parameters
        if (!date) {
            res.status(400).json({ error: 'Date is required' });
            return;
        }
        const count = yield appointmentRepository.getAppointmentsCountForDate(date);
        res.json({ count });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.getTotalAppointments = getTotalAppointments;
// Endpoint to get pending requests for today
const getPendingAppointments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date } = req.query;
        const count = yield appointmentRepository.getPendingAppointmentsCountForDate(date);
        res.json({ count });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.getPendingAppointments = getPendingAppointments;
const getAppointmentsByUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, status } = req.query;
        // Find appointments filtered by userId and optionally by status
        const appointments = yield appointmentRepository.findAppointmentsByUser(Number(userId), status ? status.toString() : undefined);
        res.status(200).json(appointments);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.getAppointmentsByUser = getAppointmentsByUser;
const getAppointmentsByRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { role, id } = req.user;
        // Assuming user information is stored in the request after authentication
        if (role === 'admin') {
            const appointments = yield resolver.getAppointmentsByUser(id);
            res.status(200).json(appointments);
        }
        else if (role === 'sub_admin' || role === 'super_admin') {
            const appointments = yield resolver.getAllAdminAppointmentsAndUser(id);
            res.status(200).json(appointments);
        }
        else {
            res.status(403).json({ error: 'Unauthorized access' });
        }
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
});
exports.getAppointmentsByRole = getAppointmentsByRole;
