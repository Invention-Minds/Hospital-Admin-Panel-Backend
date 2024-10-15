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
const doctor_repository_1 = __importDefault(require("./doctor.repository"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
class DoctorResolver {
    constructor() {
        this.repository = new doctor_repository_1.default();
    }
    // Create a new doctor
    createDoctor(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.createDoctor(data);
        });
    }
    // Get all doctors
    getDoctors() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.getDoctors();
        });
    }
    // Get a doctor by ID
    getDoctorById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.getDoctorById(id);
        });
    }
    // Update a doctor by ID
    updateDoctor(id, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.updateDoctor(id, data);
        });
    }
    // Delete a doctor by ID
    deleteDoctor(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.deleteDoctor(id);
        });
    }
    getDoctorAvailability(doctorId, day) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Fetch availability details for the specific doctor and day
                const availability = yield this.repository.getDoctorAvailability(doctorId, day);
                console.log(availability);
                if (!availability) {
                    return null;
                }
                // Return available slots and slot duration details
                return {
                    availableFrom: availability.availableFrom,
                    slotDuration: availability.slotDuration,
                };
            }
            catch (error) {
                console.error('Error fetching doctor availability:', error);
                throw new Error('Unable to fetch doctor availability.');
            }
        });
    }
    getAvailableDoctors(date) {
        return __awaiter(this, void 0, void 0, function* () {
            const unavailableDoctorIds = yield this.repository.getUnavailableDoctors(date);
            console.log('Unavailable doctors in resolver:', unavailableDoctorIds);
            const availableDoctors = yield prisma.doctor.findMany({
                where: {
                    id: { notIn: unavailableDoctorIds },
                },
            });
            console.log('Available doctors:', availableDoctors);
            return availableDoctors;
        });
    }
    getAvailableDoctorsCount(date) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.repository.getAvailableDoctorsCount(date);
        });
    }
}
exports.default = DoctorResolver;
