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
exports.getBookedSlots = exports.addBookedSlot = exports.getDoctorAvailability = exports.deleteDoctor = exports.updateDoctor = exports.getDoctorById = exports.getDoctors = exports.createDoctor = void 0;
const doctor_resolver_1 = __importDefault(require("./doctor.resolver"));
const client_1 = require("@prisma/client");
const resolver = new doctor_resolver_1.default();
const prisma = new client_1.PrismaClient();
const createDoctor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, email, phone_number, departmentName, // This is the department name coming from frontend
        qualification, availabilityDays, // Days available // Timing from frontend (e.g., "09:00-10:00")
        slotDuration, // Duration of each slot
        unavailableDates, // Dates when doctor is unavailable
         } = req.body;
        console.log(req.body);
        let availableFrom = req.body.availableFrom;
        // Validation to ensure all required fields are present
        if (!name || !email || !phone_number || !departmentName || !qualification || !availableFrom || !slotDuration || !availabilityDays) {
            res.status(400).json({ error: 'All fields are required.' });
            return;
        }
        // Find the department by its name to get its ID
        const foundDepartment = yield prisma.department.findUnique({
            where: {
                name: departmentName,
            },
        });
        if (!foundDepartment) {
            res.status(400).json({ error: 'Invalid department name.' });
            return;
        }
        // Map through the availabilityDays object and create an array of available days
        // const availableDaysArray = Object.keys(availabilityDays).filter(day => availabilityDays[day]);
        // const availability = Object.entries(availabilityDays)
        //   .filter(([day, isAvailable]) => isAvailable)
        //   .map(([day]) => ({
        //     day,
        //     availableFrom: availableTime,
        //     availableTo: slotTiming,
        //   }));
        const availableDaysArray = [];
        for (const [day, isAvailable] of Object.entries(availabilityDays)) {
            if (isAvailable) {
                availableDaysArray.push({
                    day,
                    availableFrom,
                    slotDuration,
                });
            }
        }
        // Create the doctor with the correct departmentId and availability details
        const newDoctor = yield prisma.doctor.create({
            data: {
                name,
                email,
                phone_number,
                qualification,
                availableFrom,
                slotDuration,
                departmentId: foundDepartment.id,
                departmentName: foundDepartment.name,
                availability: {
                    create: availableDaysArray
                },
                unavailableDates: unavailableDates ? {
                    create: unavailableDates.map((date) => ({
                        date: new Date(date),
                    })),
                } : undefined,
            },
            include: {
                department: true, // Include department to get its details
            },
        });
        console.log("after added", newDoctor);
        res.status(201).json(newDoctor);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.createDoctor = createDoctor;
const getDoctors = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const doctors = yield prisma.doctor.findMany({
            include: {
                availability: true,
                department: true, // Include department to get its details
            },
        });
        res.json(doctors);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
});
exports.getDoctors = getDoctors;
const getDoctorById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Convert id to integer and handle non-numeric ids
        const doctorId = parseInt(id, 10);
        console.log("Doctor ID:", doctorId);
        console.log("Doctor ID in id:", id);
        // Return a response if id is not a valid number
        if (isNaN(doctorId)) {
            return res.status(400).json({ error: 'Id is wrong' });
        }
        // Find the doctor by ID in the database
        const doctor = yield prisma.doctor.findUnique({
            where: { id: doctorId },
            include: { availability: true, department: true },
        });
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found' });
        }
        return res.status(200).json(doctor);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal server error',
        });
    }
});
exports.getDoctorById = getDoctorById;
const updateDoctor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Update Request Body before try:", req.body);
    try {
        const { id } = req.params;
        const { name, email, phone_number, departmentName, qualification, availabilityDays, availableFrom, unavailableDates = [], } = req.body;
        const slotDuration = parseInt(req.body.slotDuration);
        console.log(slotDuration);
        console.log("Update Request Body:", req.body);
        // Validation: Ensure all required fields are present
        if (!name || !email || !phone_number || !departmentName || !qualification || !availableFrom || !slotDuration) {
            res.status(400).json({ error: 'All fields are required.' });
            return;
        }
        // Find the department by its name to get its ID
        const foundDepartment = yield prisma.department.findUnique({
            where: {
                name: departmentName,
            },
        });
        if (!foundDepartment) {
            res.status(400).json({ error: 'Invalid department name.' });
            return;
        }
        // Update the doctor with the basic fields
        yield prisma.doctor.update({
            where: { id: Number(id) },
            data: {
                name,
                email,
                phone_number,
                qualification,
                departmentId: foundDepartment.id,
                departmentName: foundDepartment.name,
                availableFrom,
                slotDuration,
            },
        });
        // Delete and recreate availability entries
        yield prisma.doctorAvailability.deleteMany({
            where: {
                doctorId: Number(id),
            },
        });
        const availabilityEntries = Object.entries(availabilityDays)
            .filter(([day, isAvailable]) => isAvailable)
            .map(([day]) => ({
            day,
            availableFrom,
            slotDuration,
            doctorId: Number(id),
        }));
        if (availabilityEntries.length > 0) {
            yield prisma.doctorAvailability.createMany({
                data: availabilityEntries,
            });
        }
        // Delete and recreate unavailable dates
        yield prisma.unavailableDates.deleteMany({
            where: {
                doctorId: Number(id),
            },
        });
        const unavailableDateEntries = unavailableDates.map((date) => ({
            date: new Date(date),
            doctorId: Number(id),
        }));
        if (unavailableDateEntries.length > 0) {
            yield prisma.unavailableDates.createMany({
                data: unavailableDateEntries,
            });
        }
        // Return the updated doctor along with availability and unavailable dates
        const doctorWithRelations = yield prisma.doctor.findUnique({
            where: { id: Number(id) },
            include: {
                availability: true,
                unavailableDates: true,
                department: true, // Include department to get its details
            },
        });
        res.status(200).json(doctorWithRelations);
    }
    catch (error) {
        console.error("Update Error:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
});
exports.updateDoctor = updateDoctor;
const deleteDoctor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield resolver.deleteDoctor(Number(id));
        res.json({ message: 'Doctor and related availability deleted' });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
});
exports.deleteDoctor = deleteDoctor;
const getDoctorAvailability = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Doctor ID from doctor:", req.query.doctorId);
        // Get doctorId from query and parse it to a number
        const doctorIdStr = req.query.doctorId;
        if (!doctorIdStr) {
            res.status(400).json({ error: 'Doctor ID is missing in the query parameters.' });
            return;
        }
        // Convert doctorId to a number
        const doctorId = parseInt(doctorIdStr, 10);
        // Validate that doctorId is a number
        if (isNaN(doctorId)) {
            res.status(400).json({ error: 'id is not wrong' });
            return;
        }
        const date = req.query.date;
        // Call the resolver to get availability
        const availability = yield resolver.getDoctorAvailability(doctorId, date);
        res.status(200).json(availability);
        return;
    }
    catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal server error',
        });
        return;
    }
});
exports.getDoctorAvailability = getDoctorAvailability;
const addBookedSlot = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { doctorId, date, time } = req.body;
        const existingBooking = yield prisma.bookedSlot.findFirst({
            where: {
                doctorId,
                date,
                time,
            },
        });
        console.log("Existing Booking:", existingBooking);
        if (existingBooking) {
            res.status(400).json({ error: 'Selected slot is already booked' });
            return;
        }
        if (!doctorId || !date || !time) {
            res.status(400).json({ error: 'Doctor ID, date, and time are required.' });
            return;
        }
        const bookedSlot = yield prisma.bookedSlot.create({
            data: {
                doctorId,
                date,
                time,
            },
        });
        res.status(201).json(bookedSlot);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
    }
});
exports.addBookedSlot = addBookedSlot;
const getBookedSlots = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { doctorId, date } = req.query;
        // Validate the request parameters
        if (!doctorId || !date) {
            res.status(400).json({ error: 'Doctor ID and date are required.' });
            return;
        }
        // Query booked slots for the given doctor and date
        const bookedSlots = yield prisma.bookedSlot.findMany({
            where: {
                doctorId: Number(doctorId),
                date: date,
            },
            select: {
                time: true,
            },
        });
        // Extract the times from the booked slots
        const bookedTimes = bookedSlots.map(slot => slot.time);
        res.status(200).json(bookedTimes);
    }
    catch (error) {
        console.error('Error fetching booked slots:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.getBookedSlots = getBookedSlots;
