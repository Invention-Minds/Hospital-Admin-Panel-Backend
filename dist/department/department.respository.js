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
class DepartmentRepository {
    constructor() {
        this.prisma = new client_1.PrismaClient();
    }
    // Create a new department
    createDepartment(name) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.prisma.department.create({
                    data: { name },
                });
            }
            catch (error) {
                throw new Error('Failed to create department');
            }
        });
    }
    // Get all departments
    getDepartments() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.prisma.department.findMany({
                    include: { doctors: true },
                });
            }
            catch (error) {
                throw new Error('Failed to get departments');
            }
        });
    }
}
exports.default = DepartmentRepository;
