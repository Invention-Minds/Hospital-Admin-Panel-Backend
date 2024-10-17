"use strict";
// src/whatsapp/whatsapp.controller.ts
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
exports.sendWhatsAppMessage = void 0;
const axios_1 = __importDefault(require("axios"));
const sendWhatsAppMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { patientName, doctorName, appointmentTime, appointmentDate, phoneNumber } = req.body;
    const url = "https://103.229.250.150/unified/v2/send";
    const headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJJbmZpbml0byIsImlhdCI6MTcyODk3ODAxOSwic3ViIjoiUmFzaHRyb3R0aGFuYWFwaXJzbGN1bXl5In0.nyimuGTcfskkFLaE87hNtZ75tjEaFktsSNBPblKG5k4" // Replace with your actual token
    };
    const data = {
        "apiver": "1.0",
        "whatsapp": {
            "ver": "2.0",
            "dlr": {
                "url": ""
            },
            "messages": [
                {
                    "id": "1",
                    "coding": 1,
                    "msgtype": 1,
                    "type": "text",
                    "templateInfo": '1480342~patientName~doctorName~appointmentDate~appointmentTime',
                    "addresses": [
                        {
                            "seq": "NA",
                            "to": "919342287945",
                            "from": "918050110333",
                            "tag": "Appointment Confirmation"
                        }
                    ],
                }
            ]
        }
    };
    try {
        const response = yield axios_1.default.post(url, data, { headers });
        res.status(200).json({ message: 'WhatsApp message sent successfully', response: response.data });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to send WhatsApp message',
            details: error.response ? error.response.data : error.message
        });
    }
    // res.status(200).json({ message: 'WhatsApp API function is working without sending a message' });
});
exports.sendWhatsAppMessage = sendWhatsAppMessage;
