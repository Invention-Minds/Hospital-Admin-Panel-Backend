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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
class DoctorRepository {
    constructor() {
        this.prisma = new client_1.PrismaClient();
    }
    // Method to create a new doctor
    createDoctor(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.prisma.doctor.create({
                data,
                include: {
                    availability: true,
                },
            });
        });
    }
    getDayOfWeek(dateString) {
        const date = new Date(dateString);
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        return days[date.getDay()];
    }
    // Method to get all doctors
    getDoctors() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.prisma.doctor.findMany({
                include: {
                    availability: true,
                },
            });
        });
    }
    getDoctorAvailability(doctorId, date) {
        return __awaiter(this, void 0, void 0, function* () {
            const day = this.getDayOfWeek(date);
            console.log("Fetching availability for doctorId:", doctorId, "on day:", day);
            return yield prisma.doctorAvailability.findFirst({
                where: {
                    doctorId,
                    day,
                },
            });
        });
    }
    // Method to find a specific doctor by ID
    getDoctorById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.prisma.doctor.findUnique({
                where: { id },
                include: { availability: true },
            });
        });
    }
    // Method to update doctor information
    updateDoctor(id, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.prisma.doctor.update({
                where: { id },
                data,
                include: {
                    availability: true,
                },
            });
        });
    }
    // Method to delete a doctor
    deleteDoctor(id) {
        return __awaiter(this, void 0, void 0, function* () {
            // Delete availability first
            yield this.prisma.doctorAvailability.deleteMany({
                where: { doctorId: id },
            });
            // Delete doctor
            return yield this.prisma.doctor.delete({
                where: { id },
            });
        });
    }
    // Method to add a booked slot to the BookedSlot model
    addBookedSlot(doctorId, date, time) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.prisma.bookedSlot.create({
                data: {
                    doctorId,
                    date,
                    time,
                },
            });
        });
    }
    // Method to get booked slots for a specific doctor and date
    getBookedSlots(doctorId, date) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.prisma.bookedSlot.findMany({
                where: {
                    doctorId,
                    date,
                },
            });
        });
    }
    getAvailableDoctorsCountForDate(date) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.doctor.count({
                where: {
                    unavailableDates: {
                        none: {
                            date: new Date(date),
                        },
                    },
                },
            });
        });
    }
    getUnavailableDoctors(date) {
        return __awaiter(this, void 0, void 0, function* () {
            const unavailableDoctors = yield prisma.unavailableDates.findMany({
                where: { date: new Date(date) },
                select: { doctorId: true },
            });
            console.log('Unavailable doctors:', unavailableDoctors);
            return unavailableDoctors.map((doctor) => doctor.doctorId);
        });
    }
    getAvailableDoctorsCount(date) {
        return __awaiter(this, void 0, void 0, function* () {
            const unavailableDoctorIds = yield this.getUnavailableDoctors(date);
            const totalDoctorsCount = yield prisma.doctor.count();
            return totalDoctorsCount - unavailableDoctorIds.length;
        });
    }
}
exports.default = DoctorRepository;
