// email.controller.ts
import { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
dotenv.config();




// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587, // Use SSL/TLS for the connection
  // service: 'Gmail', // or any SMTP service you're using
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Helper function to generate email content based on status
const generateEmailContent = (status: string, appointmentDetails: any, recipientType: string) => {
  if (status === 'confirmed') {
    if (recipientType === 'doctor') {
      return {
        subject: 'Rashtrotthana Hospital - Appointment Confirmed',
        text: `Hi  ${appointmentDetails.doctorName},\n\nYou have a confirmed appointment with ${appointmentDetails.patientName} on ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nFor any questions, please contact the admin staff at 97420 20123. Thank you!`,
      };
    } else if (recipientType === 'patient') {
      return {
        subject: 'Rashtrotthana Hospital - Appointment Confirmed',
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} is confirmed on ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nFor any questions, please contact us at 97420 20123. Thank you!`,
      };
    }
  }
  switch (status) {
    case 'received':
      return {
        subject: 'Rashtrotthana Hospital - Appointment Received',
        text: `Hi ${appointmentDetails.patientName},\n\nWe have received your appointment request with  ${appointmentDetails.doctorName}. Our team will process it and get back to you shortly.\n\nIf you have any immediate questions, please reach out to us at 97420 20123. Thank you!`,
      };
    case 'rescheduled':
      return {
        subject: 'Rashtrotthana Hospital - Appointment Rescheduled',
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} has been rescheduled to ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nIf you have any questions, feel free to reach out to us at 97420 20123. Thank you!`,
      };
    case 'cancelled':
      return {
        subject: 'Rashtrotthana Hospital - Appointment Cancelled',
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} on ${appointmentDetails.date} has been cancelled.\n\nIf you need to reschedule or have any questions, please contact us at 97420 20123. Thank you for understanding!`,
      };
    default:
      return {
        subject: 'Rashtrotthana Hospital - Appointment Update',
        text: `Hi ${appointmentDetails.patientName},\n\nThere has been an update to your appointment.\n\nFor any questions, please contact us at 97420 20123. Thank you!`,
      };
  }
};


// Controller function to send email
// Controller function to send email
export const sendEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, status, appointmentDetails, recipientType } = req.body;
    // console.log(to, status, appointmentDetails, recipientType)

    // Validation to ensure all required fields are provided
    if (!to || !status || !appointmentDetails) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }
    if (status === 'frontoffice') {
      const emailContenttoFrontOffice = {
        subject: 'Rashtrotthana Hospital - Appointment Received From Website',
        text: `
          Doctor Name: ${appointmentDetails.doctorName}
      
          Doctor Designation: ${appointmentDetails.doctorDesignation}
      
          Patient Name: ${appointmentDetails.patientName}
      
          Patient Email: ${appointmentDetails.patientEmail}
      
          Patient Contact: ${appointmentDetails.patientContact}
      
          Appointment Date: ${appointmentDetails.appointmentDate}
      
          Appointment Time: ${appointmentDetails.appointmentTime}
      
          Message: ${appointmentDetails.message}
        `
      };
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContenttoFrontOffice.subject,
        text: emailContenttoFrontOffice.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Email sent successfully', info });
    }
    else if( status === 'frontofficechatbot' ){
      const emailContenttoFrontOffice = {
        subject: 'Rashtrotthana Hospital - Appointment Received From Chatbot',
        text: `
          Doctor Name: ${appointmentDetails.doctorName}
      
          Doctor Designation: ${appointmentDetails.doctorDesignation}
      
          Patient Name: ${appointmentDetails.patientName}
      
          Patient Contact: ${appointmentDetails.patientContact}
      
          Appointment Date: ${appointmentDetails.appointmentDate}
      
          Appointment Time: ${appointmentDetails.appointmentTime}
      
        `
      };
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContenttoFrontOffice.subject,
        text: emailContenttoFrontOffice.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Email sent successfully', info });
    }
    
    else{
      const emailContent = generateEmailContent(status, appointmentDetails, recipientType);

      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContent.subject,
        text: emailContent.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Email sent successfully', info });
    }

      // Generate the email content based on the status
    

      // Send email using nodemailer
      
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).json({ message: 'Failed to send email' });
    }
  };

export const sendMailtoLab = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, contact, address,service } = req.body;
        const file = req.file
        // console.log(req)
        
// console.log(name, contact, address, file)
        if (!name || !contact || !address || !file) {
             res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        if(service === 'Blood Sample Collection'){
          const mailOptions = {
            from: process.env.SMTP_USER,
            to: 'laboratory@rashtrotthanahospital.com',
            subject: "Rashtrotthana Hospital - Door step delivery - Blood Sample Collection Request ",
            text: `
                Name: ${name}
                Contact: ${contact}
                Address: ${address}
            `,
            attachments: [
                {
                    filename: file!.originalname,
                    path: file!.path
                }
            ]
        }
        const info = await transporter.sendMail(mailOptions);
      fs.unlinkSync(file!.path);
        }else{
          const mailOptions = {
            from: process.env.SMTP_USER,
            to: 'pharmacy@rashtrotthanahospital.com',
            subject: "Rashtrotthana Hospital - Door step delivery - Pharmacy Request ",
            text: `
                Name: ${name}
                Contact: ${contact}
                Address: ${address}
            `,
            attachments: [
                {
                    filename: file!.originalname,
                    path: file!.path
                }
            ]
        }
        const info = await transporter.sendMail(mailOptions);
      fs.unlinkSync(file!.path);
        }
        

      
      res.status(200).json({ message: 'Email sent successfully'});
    
   

      // Generate the email content based on the status
    

      // Send email using nodemailer
      
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).json({ message: 'Failed to send email' });
    }
  }




