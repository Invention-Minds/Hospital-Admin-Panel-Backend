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
exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
// Nodemailer transporter configuration
const transporter = nodemailer_1.default.createTransport({
    service: 'Gmail', // or any SMTP service you're using
    auth: {
        user: 'inventionmindsblr@gmail.com',
        pass: 'Bsrenuk@1993',
    },
});
// Helper function to generate email content based on status
const generateEmailContent = (status, appointmentDetails) => {
    switch (status) {
        case 'received':
            return {
                subject: 'Appointment Received',
                text: `Hello ${appointmentDetails.patientName},\n\nYour appointment request has been received. We will get back to you soon.\n\nThank you.`,
            };
        case 'confirmed':
            return {
                subject: 'Appointment Confirmed',
                text: `Hello ${appointmentDetails.patientName},\n\nYour appointment with Dr. ${appointmentDetails.doctorName} on ${appointmentDetails.date} at ${appointmentDetails.time} has been confirmed.\n\nThank you.`,
            };
        case 'cancelled':
            return {
                subject: 'Appointment Cancelled',
                text: `Hello ${appointmentDetails.patientName},\n\nYour appointment with Dr. ${appointmentDetails.doctorName} on ${appointmentDetails.date} at ${appointmentDetails.time} has been cancelled.\n\nThank you.`,
            };
        default:
            return {
                subject: 'Appointment Update',
                text: `Hello ${appointmentDetails.patientName},\n\nThere has been an update to your appointment.\n\nThank you.`,
            };
    }
};
// Controller function to send email
// Controller function to send email
const sendEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { to, status, appointmentDetails } = req.body;
        // Validation to ensure all required fields are provided
        if (!to || !status || !appointmentDetails) {
            res.status(400).json({ message: 'Missing required fields' });
            return;
        }
        // Generate the email content based on the status
        const emailContent = generateEmailContent(status, appointmentDetails);
        const mailOptions = {
            from: 'your-email@gmail.com',
            to,
            subject: emailContent.subject,
            text: emailContent.text,
        };
        // Send email using nodemailer
        const info = yield transporter.sendMail(mailOptions);
        res.status(200).json({ message: 'Email sent successfully', info });
    }
    catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ message: 'Failed to send email' });
    }
});
exports.sendEmail = sendEmail;
