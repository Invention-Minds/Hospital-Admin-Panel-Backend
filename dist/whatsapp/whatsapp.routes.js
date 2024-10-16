"use strict";
// src/whatsapp/whatsapp.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const whatsapp_controller_1 = require("./whatsapp.controller"); // Ensure this path is correct
const router = (0, express_1.Router)();
// Define the route for sending WhatsApp messages
router.post('/send', whatsapp_controller_1.sendWhatsAppMessage);
exports.default = router; // Make sure this line is present
