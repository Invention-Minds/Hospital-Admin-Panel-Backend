// email.controller.ts
import { Request, Response } from 'express';
import nodemailer from 'nodemailer';

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587, // Use SSL/TLS for the connection
  // service: 'Gmail', // or any SMTP service you're using
  auth: {
    user: 'keerthanasaminathan0805@gmail.com',
    pass: 'kjzh yjab zdpx zxjq',
  },
});

// Helper function to generate email content based on status
const generateEmailContent = (status: string, appointmentDetails: any, recipientType: string) => {
  if (status === 'confirmed') {
    if (recipientType === 'doctor') {
      return {
        subject: 'Rashtrotthana Hospital - Appointment Confirmed',
        text: `Hi  ${appointmentDetails.doctorName},\n\nYou have a confirmed appointment with ${appointmentDetails.patientName} on ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nFor any questions, please contact the admin staff at 80501 10333. Thank you!`,
      };
    } else if (recipientType === 'patient') {
      return {
        subject: 'Rashtrotthana Hospital - Appointment Confirmed',
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} is confirmed on ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nFor any questions, please contact us at 80501 10333. Thank you!`,
      };
    }
  }
  switch (status) {
    case 'received':
      return {
        subject: 'Rashtrotthana Hospital - Appointment Received',
        text: `Hi ${appointmentDetails.patientName},\n\nWe have received your appointment request with  ${appointmentDetails.doctorName}. Our team will process it and get back to you shortly.\n\nIf you have any immediate questions, please reach out to us at 80501 10333. Thank you!`,
      };
    case 'rescheduled':
      return {
        subject: 'Rashtrotthana Hospital - Appointment Rescheduled',
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} has been rescheduled to ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nIf you have any questions, feel free to reach out to us at 80501 10333. Thank you!`,
      };
    case 'cancelled':
      return {
        subject: 'Rashtrotthana Hospital - Appointment Cancelled',
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} on ${appointmentDetails.date} has been cancelled.\n\nIf you need to reschedule or have any questions, please contact us at 80501 10333. Thank you for understanding!`,
      };
    default:
      return {
        subject: 'Rashtrotthana Hospital - Appointment Update',
        text: `Hi ${appointmentDetails.patientName},\n\nThere has been an update to your appointment.\n\nFor any questions, please contact us at 80501 10333. Thank you!`,
      };
  }
};


// Controller function to send email
// Controller function to send email
export const sendEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, status, appointmentDetails, recipientType } = req.body;
    console.log(to,status,appointmentDetails,recipientType)

    // Validation to ensure all required fields are provided
    if (!to || !status || !appointmentDetails) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    // Generate the email content based on the status
    const emailContent = generateEmailContent(status, appointmentDetails,recipientType);

    const mailOptions = {
      from: 'keerthanasaminathan0805@gmail.com',
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: emailContent.subject,
      text: emailContent.text,
    };

    // Send email using nodemailer
    const info = await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Email sent successfully', info });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
};





