import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';

dotenv.config();

// Same Gmail transport + SMTP_USER/SMTP_PASS as email.controller.ts and
// security-alert.ts. Kept in one place so moving OTP mail to SES/SendGrid
// later is a one-file change.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/** Sends a one-time code by email. Returns true on success; never throws. */
export async function sendOtpEmail(to: string, otp: string, purposeLabel: string, ttlMinutes: number): Promise<boolean> {
  const subject = `DocMinds verification code: ${otp}`;
  const text =
    `Your DocMinds verification code for ${purposeLabel} is ${otp}.\n\n` +
    `It expires in ${ttlMinutes} minutes. If you did not request this, contact your hospital administrator immediately.`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">` +
    `<p>Your DocMinds verification code for <b>${purposeLabel}</b> is:</p>` +
    `<p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#1d4ed8">${otp}</p>` +
    `<p>It expires in ${ttlMinutes} minutes.</p>` +
    `<p style="color:#6b7280">If you did not request this, contact your hospital administrator immediately.</p>` +
    `</div>`;
  try {
    await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text, html });
    return true;
  } catch (err) {
    console.error('[mailer] failed to send OTP email:', err);
    return false;
  }
}
