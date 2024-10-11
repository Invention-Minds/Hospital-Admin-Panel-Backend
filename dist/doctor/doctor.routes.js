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
const express_1 = __importDefault(require("express"));
const doctor_controller_1 = require("./doctor.controller");
const router = express_1.default.Router();
// Define routes for doctors
router.post('/', doctor_controller_1.createDoctor); // Changed from '/doctors' to '/'
router.get('/', doctor_controller_1.getDoctors); // Changed from '/doctors' to '/'
router.get('/availability', doctor_controller_1.getDoctorAvailability);
router.get('/booked-slots', doctor_controller_1.getBookedSlots);
router.post('/booked-slots', doctor_controller_1.addBookedSlot);
router.get('/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, doctor_controller_1.getDoctorById)(req, res); // Awaiting to ensure proper response flow
}));
router.put('/:id', doctor_controller_1.updateDoctor);
router.delete('/:id', doctor_controller_1.deleteDoctor);
exports.default = router;
