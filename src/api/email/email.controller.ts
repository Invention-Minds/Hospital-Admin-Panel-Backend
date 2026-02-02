// email.controller.ts
import { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import qs from 'qs';
import multer from 'multer';
import fs from 'fs';
dotenv.config();




// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587, // Use SSL/TLS for the connection
  // // service: 'Gmail', // or any SMTP service you're using
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
        subject: `${process.env.HOSPITAL_NAME} - Appointment Confirmed`,
        text: `Hi  ${appointmentDetails.doctorName},\n\nYou have a confirmed appointment with ${appointmentDetails.patientName} on ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nFor any questions, please contact the admin staff at 97420 20123. Thank you!`,
      };
    } else if (recipientType === 'patient') {
      return {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Confirmed`,
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} is confirmed on ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nFor any questions, please contact us at 97420 20123. Thank you!`,
      };
    }
  }
  switch (status) {
    case 'received':
      return {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Received`,
        text: `Hi ${appointmentDetails.patientName},\n\nWe have received your appointment request with  ${appointmentDetails.doctorName}. Our team will process it and get back to you shortly.\n\nIf you have any immediate questions, please reach out to us at 97420 20123. Thank you!`,
      };
    case 'rescheduled':
      return {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Rescheduled`,
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} has been rescheduled to ${appointmentDetails.date} at ${appointmentDetails.time}.\n\nIf you have any questions, feel free to reach out to us at 97420 20123. Thank you!`,
      };
    case 'cancelled':
      return {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Cancelled`,
        text: `Hi ${appointmentDetails.patientName},\n\nYour appointment with  ${appointmentDetails.doctorName} on ${appointmentDetails.date} has been cancelled.\n\nIf you need to reschedule or have any questions, please contact us at 97420 20123. Thank you for understanding!`,
      };
    default:
      return {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Update`,
        text: `Hi ${appointmentDetails.patientName},\n\nThere has been an update to your appointment.\n\nFor any questions, please contact us at 97420 20123. Thank you!`,
      };
  }
};

// Controller function to send email
export const sendEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, status, appointmentDetails, recipientType, whatsappNumber } = req.body;
    // console.log(to, status, appointmentDetails, recipientType)

    // Validation to ensure all required fields are provided
    if (!to || !status || !appointmentDetails) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }
    if (status === 'frontoffice') {
      const emailContenttoFrontOffice = {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Received From Website`,
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
      if (emailContenttoFrontOffice && process.env.HOSPITAL_NAME === 'Vasavi Hospitals' && whatsappNumber) {
        await sendWhatsappTemplate(whatsappNumber, emailContenttoFrontOffice.subject, emailContenttoFrontOffice.text);
      }
      res.status(200).json({ message: 'Email sent successfully', info });
    }
    else if (status === 'frontofficechatbot') {
      const emailContenttoFrontOffice = {
        subject: `${process.env.HOSPITAL_NAME} - Appointment Received From Chatbot`,
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
    else if (status === 'Call Back Request') {
      const emailContent = {
        subject: `New Callback Request from Website - ${appointmentDetails.page}`,
        text: `
          📞 Callback Request Details - Surgery page
    
          Patient Name: ${appointmentDetails.name}
          Contact Number: ${appointmentDetails.phone}
          Location: ${appointmentDetails.address}
    
          Page Filled From: ${appointmentDetails.page}
        `
      };
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContent.subject,
        text: emailContent.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Email sent successfully', info });
    }

    else {
      const emailContent = generateEmailContent(status, appointmentDetails, recipientType);
      console.log(emailContent)

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
    const { name, contact, address, service } = req.body;
    const file = req.file
    // console.log(req)

    // console.log(name, contact, address, file)
    if (!name || !contact || !address || !file) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (service === 'Blood Sample Collection') {
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: 'laboratory@rashtrotthanahospital.com',
        subject: `${process.env.HOSPITAL_NAME} - Door step delivery - Blood Sample Collection Request `,
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
    } else {
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: 'pharmacy@rashtrotthanahospital.com',
        subject: `${process.env.HOSPITAL_NAME} - Door step delivery - Pharmacy Request`,
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



    res.status(200).json({ message: 'Email sent successfully' });



    // Generate the email content based on the status


    // Send email using nodemailer

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
}



// Controller function to send health checkup package confirmation email
export const sendHealthCheckupConfirmationEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, appointmentDetails, status } = req.body;

    // Validation to ensure all required fields are provided
    if (!to || !appointmentDetails.packageName || !appointmentDetails.patientName || !appointmentDetails.appointmentDate || !appointmentDetails.appointmentTime) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }
    // const name = `${firstName} ${lastName}`;
    // Generate email content for health checkup package confirmation
    if (status === 'confirmed' || status === 'rescheduled' || status === 'Confirm') {
      const emailContent = {
        subject: `Appointment Status Update – ${process.env.HOSPITAL_NAME}`,
        text: `
        Dear ${appointmentDetails.patientName},

        Namaste!
        Your ${appointmentDetails.packageName} appointment is ${status} for ${appointmentDetails.appointmentDate} at ${appointmentDetails.appointmentTime}.

        Kindly note that there is a standard Turnaround Time (TAT) for all investigation reports. We recommend consulting your doctor once the reports are ready for further guidance.

        If you have any questions or need assistance, please contact us at 97420 20123.

        Thank you for choosing us.

        Regards,
        Team ${process.env.HOSPITAL_NAME}
      `,
      };
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContent.subject,
        text: emailContent.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Health Checkup Confirmation Email sent successfully', info });

    }
    else if (status === 'cancelled' || status === 'Cancelled') {
      const emailContent = {
        subject: `Cancellation of ${appointmentDetails.packageName} – ${appointmentDetails.appointmentDate}`,
        text: `
        Dear ${appointmentDetails.patientName},

        Namaste!

        Your ${appointmentDetails.packageName} package scheduled for ${appointmentDetails.appointmentDate} has been Cancelled.

        If you require any further assistance or wish to reschedule your appointment, please feel free to contact us at 97420 20123.

        Thank you!

        Regards,
        Team ${process.env.HOSPITAL_NAME}
      `,
      };
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContent.subject,
        text: emailContent.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Health Checkup Confirmation Email sent successfully', info });
    }
    else if (status === 'pending') {
      const emailContent = {
        subject: `Health Check Request for ${appointmentDetails.packageName}  Package`,
        text: `
        Dear ${appointmentDetails.patientName},

Namaste!

We have received your health check request for the ${appointmentDetails.packageName} package. Our team will get back to you shortly with further details.

For any assistance, please feel free to reach out to us at 97420 20123.

Thank you!

Regards,
Team ${process.env.HOSPITAL_NAME}
      `,
      };
      const mailOptions = {
        from: process.env.SMTP_USER,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: emailContent.subject,
        text: emailContent.text,
      };
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Health Checkup Confirmation Email sent successfully', info });
    }
    // Set up mail options

    // Send email using nodemailer



  } catch (error) {
    console.error('Error sending health checkup confirmation email:', error);
    res.status(500).json({ message: 'Failed to send health checkup confirmation email' });
  }
};

export const sendEmailForApprover = async (req: Request, res: Response) => {
  try {
    const { pdfLink, estimationId, patientName, to } = req.body
    const emailContent = {
      subject: ` Estimation Document of ${patientName}] `,
      text: `

      Dear Team,

      Namaste!
      Please find the attached document with the details of the approved estimation for the treatment of ${patientName}. The estimation can be accessed through the link below:
      Doc: ${pdfLink}
      Thank you!

      Regards,
      Team ${process.env.HOSPITAL_NAME}
    `,
    };
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: emailContent.subject,
      text: emailContent.text,
    };
    const info = await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Health Checkup Confirmation Email sent successfully', info });

  }
  catch (error) {
    console.error('Error sending health checkup confirmation email:', error);
    res.status(500).json({ message: 'Failed to send health checkup confirmation email' });
  }
}

export const sendPackageMail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { packageName, firstName, lastName, phoneNumber, appointmentDate, email } = req.body;

    // const to = ['patientservices@rashtrotthanahospital.com', 'frontoffice@rashtrotthanahospital.com']
    const to = ['keerthanasaminathan0805@gmail.com', 'patientservices@rashtrotthanahospital.com', 'frontoffice@rashtrotthanahospital.com']
    const emailContenttoFrontOffice = {
      subject: 'New Appointment Request from Website - Health Check-up Page',
      text: `
      
          Patient Name: ${firstName} ${lastName}
      
          Patient Contact: ${phoneNumber}
      
          Package Name: ${packageName}

          Appointment Date: ${appointmentDate}

          Patient Email: ${email}
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


  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
};


export const sendServiceEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, appointmentDetails } = req.body;
    if (!to || !appointmentDetails) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    const emailContenttoFrontOffice = {
      subject: 'New Appointment Request from Website - Service Page',
      text: `
      
          Patient Name: ${appointmentDetails.firstName} ${appointmentDetails.lastName}
      
          Patient Email: ${appointmentDetails.email}
      
          Patient Contact: ${appointmentDetails.phone}

          Doctor Name: ${appointmentDetails.doctor}
      
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


  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
};


export const conditionalEmail = async (req: Request, res: Response): Promise<void> => {

  try {
    const { to, appointmentDetails, status, whatsappNumber } = req.body;

    var emailContent

    if (status === "Contact-Page") {
      emailContent = {
        subject: `New Appointment Request from Website - ${status}`,
        text: `
        
            Patient Name: ${appointmentDetails.name}
                
            Patient Contact: ${appointmentDetails.phone}
  
            Services: ${appointmentDetails.service}
        
            Message: ${appointmentDetails.message}
          `
      };
    }

    else if (status === "Enquiry-Form") {
      emailContent = {
        subject: `New Appointment Request from Website - ${status}`,
        text: `
        
            Patient Name: ${appointmentDetails.name}
                
            Patient Contact: ${appointmentDetails.phone}
  
            Date: ${appointmentDetails.date}

            Service: ${appointmentDetails.service}
        
            Message: ${appointmentDetails.message}
          `
      };
    }

    else if (status === "Package-Enquiry") {
      emailContent = {
        subject: `New Appointment Request from Website - ${status}`,
        text: `

            Package Name : ${appointmentDetails.packageName}

            Patient Name: ${appointmentDetails.name}

            Patient Contact: ${appointmentDetails.phone}
                  
            Email: ${appointmentDetails.email}
        
            Date: ${appointmentDetails.date}

            Message: ${appointmentDetails.message}
          `
      };
    }

    else if (status === "Service-Page") {
      emailContent = {
        subject: `New Appointment Request from Website - ${status}`,
        text: `
    
              Patient Name: ${appointmentDetails.name}
  
              Patient Contact: ${appointmentDetails.phone}
                    
              Email: ${appointmentDetails.email}
  
              Doctor: ${appointmentDetails.doctor}
          
              Date: ${appointmentDetails.date}
  
              Message: ${appointmentDetails.message}
            `
      };
    }

    else if (status === "Specialty-Page") {
      emailContent = {
        subject: `New Appointment Request from Website - ${status}`,
        text: `
  
            Patient Name: ${appointmentDetails.name}

            Patient Contact: ${appointmentDetails.phone}
                  
            Email: ${appointmentDetails.email}

            Service: ${appointmentDetails.service}
        
            Date: ${appointmentDetails.date}

            Message: ${appointmentDetails.message}
          `
      };
    }
    else if (status === "Callback-Form") {
      emailContent = {
        subject: `New Callback Request from Website - ${appointmentDetails.page}`,
        text: `
          📞 Callback Request Details - Surgery page
    
          Patient Name: ${appointmentDetails.name}
          Contact Number: ${appointmentDetails.phone}
          Location: ${appointmentDetails.address}
    
          Page Filled From: ${appointmentDetails.page}
        `
      };
      // await sendPatientWhatsappTemplate(
      //   appointmentDetails.phone,
      // );
    }
    else if (status === "Health Checkup Appointment Booking") {
      emailContent = {
        subject: `New Appointment Request from Website - ${status}`,
        text: `
  
            Patient Name: ${appointmentDetails.name}

            Patient Contact: ${appointmentDetails.phone}
        
            Date: ${appointmentDetails.date}

            Page Filled From: ${appointmentDetails.page}
          `
      };
    }


    else {
      res.status(404).json({ message: 'Invalid Page Name' });
    }


    const mailOptions = {
      from: process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: emailContent?.subject,
      text: emailContent?.text,
    };

    const info = await transporter.sendMail(mailOptions);
    if (emailContent) {
      console.log(emailContent.subject, emailContent.text)
      await sendWhatsappTemplate(whatsappNumber, emailContent.subject, emailContent.text);
    }

    res.status(200).json({ message: 'Email sent successfully', info });

  }
  catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }

}

import axios from 'axios';
import { sub } from 'date-fns';

// ✅ WhatsApp sender function
const sendWhatsappTemplate = async (
  numbers: string[] | string,
  subject: string,
  text: string
): Promise<void> => {
  try {
    // Ensure we always have an array of numbers
    const recipients = Array.isArray(numbers) ? numbers : [numbers];

    console.log(sanitizeForWhatsappSingleLine(subject), sanitizeForWhatsappSingleLine(text));

    // Loop through all numbers and send individually
    for (const to of recipients) {
      console.log(`📱 Sending WhatsApp message to ${to}..., ${subject}, ${text}`);
      const response = await axios.post(
        'https://api.wacto.app/api/v1.0/messages/send-template/918884545086',
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: 'website_lead_notification', // ✅ make sure this template is approved in Wacto
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: sanitizeForWhatsappSingleLine(subject) },
                  { type: 'text', text: sanitizeForWhatsappSingleLine(text) }
                ]
              }
            ]
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer O6q5lsQag02tDXTp95DQhg'
          }
        }
      );

      console.log(`✅ WhatsApp message sent to ${to}:`, response.data);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ WhatsApp API Error:', error.response?.data || error.message);
    } else if (error instanceof Error) {
      console.error('❌ General Error:', error.message);
    } else {
      console.error('❌ Unknown Error:', error);
    }
  }
};
function sanitizeForWhatsappSingleLine(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, ' ')   // replace all line breaks with a space
    .replace(/\s\s+/g, ' ')        // collapse multiple spaces
    .trim();                       // remove leading/trailing spaces
}
const sendPatientWhatsappTemplate = async (
  number: string
): Promise<void> => {
  try {
    console.log(`📱 Sending patient WhatsApp template to ${number}...`);

    const response = await axios.post(
      'https://api.wacto.app/api/v1.0/messages/send-template/918884545086',
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: number,
        type: "template",
        template: {
          name: "new_enquiry_reply",
          language: {
            code: "en"
          },
          components: []
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer O6q5lsQag02tDXTp95DQhg"
        }
      }
    );

    console.log("✅ Patient template message sent:", response.data);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ WhatsApp API Error:", error.response?.data || error.message);
    } else {
      console.error("❌ Unknown Error:", error);
    }
  }
};


const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

export const verifyRecaptcha = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ success: false, message: 'Missing reCAPTCHA token' });
    return;
  }

  if (!SECRET_KEY) {
    res.status(500).json({ success: false, message: 'Missing reCAPTCHA secret key in server config' });
    return;
  }

  try {
    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${SECRET_KEY}&response=${token}`;
    const response = await fetch(verifyUrl, { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      console.log('✅ reCAPTCHA verified successfully');
      res.status(200).json({ success: true });
    } else {
      console.warn('❌ reCAPTCHA verification failed:', data['error-codes']);
      res.status(400).json({
        success: false,
        errors: data['error-codes'] || ['verification_failed'],
      });
    }
  } catch (error) {
    console.error('Error verifying reCAPTCHA:', error);
    res.status(500).json({ success: false, message: 'Server error during reCAPTCHA verification' });
  }




};

const verifiedCaptchaSessions = new Set<string>();

async function verifyHcaptcha(token: string, ip: string): Promise<boolean> {
  try {
    const response = await axios.post(
      'https://hcaptcha.com/siteverify',
      qs.stringify({
        secret: process.env.HCAPTCHA_SECRET,
        response: token,
        remoteip: ip
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('✅ hCaptcha response:', response.data);
    return response.data.success === true;

  } catch (error: any) {
    console.error(
      '❌ hCaptcha verification error:',
      error.response?.data || error.message
    );
    return false;
  }
}
export const verifyCaptcha = async (req: Request, res: Response): Promise<void> => {
  try {
    const { captchaToken } = req.body;

    if (!captchaToken) {
      res.status(400).json({
        success: false,
        message: 'Captcha token missing'
      });
      return;
    }

    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      '';

    console.log('🌐 Client IP:', ip);

    const isHuman = await verifyHcaptcha(captchaToken, ip);

    if (!isHuman) {
      res.status(403).json({
        success: false,
        message: 'Captcha verification failed'
      });
      return;
    }

    // Optional: create a short-lived captcha session
    const sessionKey = `${ip}-${Date.now()}`;
    verifiedCaptchaSessions.add(sessionKey);

    setTimeout(() => {
      verifiedCaptchaSessions.delete(sessionKey);
    }, 5 * 60 * 1000); // 5 minutes

    res.status(200).json({
      success: true,
      message: 'Captcha verified successfully',
      captchaSession: sessionKey
    });

  } catch (error) {
    console.error('❌ Captcha verify error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during captcha verification'
    });
  }
};
export const sendEmailOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, name, otp } = req.body;

    if (!email || !otp) {
      res.status(400).json({ message: 'Email and OTP are required' });
      return;
    }

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `${process.env.HOSPITAL_NAME} - OTP Verification`,
      text: `
Dear ${name || 'User'},

Your One-Time Password (OTP) is:

🔐 ${otp}

This OTP is valid for 2 minutes.
Please do not share it with anyone.

Regards,
Team ${process.env.HOSPITAL_NAME}
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully via email',
    });
  } catch (error) {
    console.error('❌ Email OTP error:', error);
    res.status(500).json({ message: 'Failed to send OTP email' });
  }
};
