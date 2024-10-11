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
exports.deleteAppointment = exports.updateAppointment = exports.getAppointments = exports.createAppointment = void 0;
const appointment_resolver_1 = __importDefault(require("./appointment.resolver"));
const doctor_repository_1 = __importDefault(require("../doctor/doctor.repository"));
const resolver = new appointment_resolver_1.default();
const doctorRepository = new doctor_repository_1.default();
const createAppointment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        req.body.status = req.body.status === 'Confirm' ? 'confirmed' :
            req.body.status === 'Cancel' ? 'cancelled' : req.body.status;
        const { patientName, phoneNumber, doctorName, doctorId, department, time, status, email, requestVia, smsSent } = req.body;
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
            smsSent
        });
        console.log("New Appointment:", newAppointment);
        yield doctorRepository.addBookedSlot(doctorId, date, time);
        res.status(201).json(newAppointment);
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
        const updatedAppointment = yield resolver.updateAppointment(Number(req.params.id), req.body);
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
