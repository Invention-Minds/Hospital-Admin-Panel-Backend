import axios from 'axios';

// OTP over SMS via the Pinnacle gateway — same transport/template the SMS
// controller uses for the `otp` case. The message text MUST match the approved
// DLT template (SMS_DLT_TE_ID_FOR_OTP) verbatim, hence the fixed wording below.

const OTP_TTL_MS = 2 * 60 * 1000; // "Expires in 2 mins" — must match the DLT template

export function generateOtp(): string {
  // 6-digit, no Math.random dependency concerns here (normal request path).
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function otpExpiry(): Date {
  return new Date(Date.now() + OTP_TTL_MS);
}

/**
 * Send a one-time password over SMS. `service` is the flow label that fills the
 * {service} slot in the approved template (e.g. "Doctor Appointment").
 * Returns true on success; never throws (logs and returns false).
 */
export async function sendOtpSms(
  phone: string,
  name: string,
  otp: string,
  service: string,
): Promise<boolean> {
  const apiUrl = process.env.SMS_API_URL;
  const sender = process.env.SMS_SENDER;
  const apiKey = process.env.SMS_API_KEY;
  const entityId = process.env.DLT_ENTITY_ID;
  const templateId = process.env.SMS_DLT_TE_ID_FOR_OTP;
  if (!apiUrl || !sender || !apiKey || !entityId || !templateId) {
    console.error('[otp-sms] SMS env not configured (SMS_API_URL/SMS_SENDER/SMS_API_KEY/DLT_ENTITY_ID/SMS_DLT_TE_ID_FOR_OTP)');
    return false;
  }
  const message = `Dear ${name}, ${otp} is your One Time Password from Rashtrotthana Hospital for ${service} service. Expires in 2 mins. Please do not share this OTP with anyone.`;
  const url = `${apiUrl}/${sender}/${phone}/${encodeURIComponent(message)}/TXT?apikey=${apiKey}&dltentityid=${entityId}&dlttempid=${templateId}`;
  try {
    const res = await axios.get(url);
    console.log('[otp-sms] sent to', phone, res.data);
    return true;
  } catch (e: any) {
    console.error('[otp-sms] send failed:', e.response?.data || e.message);
    return false;
  }
}
