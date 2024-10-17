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
const appointment_repository_1 = __importDefault(require("./appointment.repository"));
class AppointmentResolver {
    constructor() {
        this.repository = new appointment_repository_1.default();
    }
    createAppointment(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.create(data);
        });
    }
    checkAvailability(doctorId, date, time) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.isSlotAvailable(doctorId, date, time);
        });
    }
    getAppointments() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.findMany();
        });
    }
    updateAppointment(id, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.update(id, data);
        });
    }
    deleteAppointment(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.delete(id);
        });
    }
    getAppointmentsByUser(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.findAppointmentsByUserId(userId);
        });
    }
    getAllAdminAppointmentsAndUser(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.findAppointmentsByAdminAndUser(userId);
        });
    }
    getDoctorReport(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.repository.findAppointmentsByDoctorUserId(userId);
        });
    }
}
exports.default = AppointmentResolver;
