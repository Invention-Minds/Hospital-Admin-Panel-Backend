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
    findUserByUsername(username) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma.user.findUnique({
                where: { username },
            });
        });
    }
    findUserById(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma.user.findUnique({
                where: { id: userId },
            });
        });
    }
    createUser(username, password, role) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma.user.create({
                data: {
                    username,
                    password,
                    role,
                },
            });
        });
    }
    updatePasswordByUsername(username, newPassword) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma.user.update({
                where: { username },
                data: { password: newPassword },
            });
        });
    }
    updatePasswordByUserId(userId, newPassword) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma.user.update({
                where: { id: userId },
                data: { password: newPassword },
            });
        });
    }
    deleteUserByUsername(username) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma.user.delete({
                where: { username },
            });
        });
    }
    ;
}
exports.default = new AppointmentRepository();
