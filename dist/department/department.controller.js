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
exports.getDepartments = exports.createDepartment = void 0;
const department_resolver_1 = __importDefault(require("./department.resolver"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const departmentResolver = new department_resolver_1.default();
// Function to create a department
const createDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name } = req.body;
        const department = yield prisma.department.create({
            data: { name },
        });
        res.status(201).json(department);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
});
exports.createDepartment = createDepartment;
const getDepartments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const departments = yield prisma.department.findMany();
        res.json(departments);
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
});
exports.getDepartments = getDepartments;
