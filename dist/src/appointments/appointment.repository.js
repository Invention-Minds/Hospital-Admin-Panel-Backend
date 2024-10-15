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
class AppointmentRepository {
    create(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.appointment.create({ data });
        });
    }
    findMany() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.appointment.findMany({ include: { doctor: true } });
        });
    }
    update(id, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.appointment.update({ where: { id }, data });
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.appointment.delete({ where: { id } });
        });
    }
    isSlotAvailable(doctorId, date, time) {
        return __awaiter(this, void 0, void 0, function* () {
            const appointment = yield prisma.appointment.findFirst({
                where: {
                    doctorId,
                    date,
                    time,
                },
            });
            return !appointment; // Returns true if no appointment exists for the given date and time
        });
    }
    getAppointmentsCountForDate(date) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.appointment.count({
                where: {
                    date,
                },
            });
        });
    }
    // Method to get the count of pending requests for the given date
    getPendingAppointmentsCountForDate(date) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield prisma.appointment.count({
                where: {
                    date,
                    status: 'pending',
                },
            });
        });
    }
}
exports.default = AppointmentRepository;
