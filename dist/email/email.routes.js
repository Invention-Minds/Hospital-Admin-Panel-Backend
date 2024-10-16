"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// email.routes.ts
const express_1 = require("express");
const email_controller_1 = require("./email.controller");
const router = (0, express_1.Router)();
// Route to send email
router.post('/send-email', email_controller_1.sendEmail);
exports.default = router;
