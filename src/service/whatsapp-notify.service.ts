import prisma from './prisma-client';
import { sendTemplate, uploadMedia } from './gobuzz.service';
import { getRegisteredNumber } from './record-access.service';
import { formatGoBuzzPhone } from './gobuzz-document';

// ─── WhatsApp push / journey notifications ─────────────────────────────────
//
// Business-initiated messages must use pre-approved templates (see
// docs/whatsapp-templates.md). Template NAMES here must match the approved ones.
//
// Safety:
//  - Everything is gated behind WHATSAPP_PUSH_ENABLED so nothing fires until the
//    templates are approved. Flip it on when they are.
//  - `refId` de-duplicates: an event replay never double-messages a patient.
//  - Every attempt (sent / failed / skipped) is logged.
//  - Never throws — a notification must not break the clinical flow that fired it.

const PUSH_ENABLED = process.env.WHATSAPP_PUSH_ENABLED === 'true';
const LANG = process.env.GOBUZZ_TEMPLATE_LANG || 'en_US';

export const TEMPLATES = {
  REPORT_READY: 'report_ready',
  OPD_NOTES_READY: 'opd_notes_ready',
  PRESCRIPTION_READY: 'prescription_ready',
  DISCHARGE_SUMMARY_READY: 'discharge_summary_ready',
  ADMISSION_WELCOME: 'admission_welcome',
  DISCHARGE_INITIATED: 'discharge_initiated',
  DISCHARGE_STEP_UPDATE: 'discharge_step_update',
  BILL_READY: 'bill_ready',
  DISCHARGE_GATEPASS: 'discharge_gatepass',
  APPOINTMENT_CONFIRMED: 'appointment_confirmed',
  APPOINTMENT_REMINDER: 'appointment_reminder',
  APPOINTMENT_CANCELLED: 'appointment_cancelled',
  DOORSTEP_STATUS_UPDATE: 'doorstep_status_update',
  ENQUIRY_ACKNOWLEDGEMENT: 'enquiry_acknowledgement',
  FEEDBACK_REQUEST: 'feedback_request',
} as const;

async function writeLog(input: {
  prn?: number | null; phone: string; template: string;
  refType?: string; refId?: string; status: string; error?: string;
}): Promise<void> {
  await prisma.whatsappNotificationLog
    .create({
      data: {
        prn: input.prn ?? null,
        phone: input.phone,
        template: input.template,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        status: input.status,
        error: input.error ?? null,
      },
    })
    .catch((e) => console.warn('[wa-notify] log failed:', (e as Error).message));
}

/**
 * Core sender. Resolves the patient's registered mobile from the PRN unless an
 * explicit phone is given. Returns true only when a message actually went out.
 */
export async function notifyPatient(input: {
  prn?: number | null;
  phone?: string | null;
  template: string;
  params: string[];
  /** Dynamic suffix for a URL button (e.g. a secure-link token). */
  urlToken?: string;
  /** Local file to attach as a DOCUMENT header (uploaded to GoBuzz first). */
  documentPath?: string;
  documentFilename?: string;
  refType?: string;
  refId?: string;
}): Promise<boolean> {
  const raw = input.phone ?? (input.prn ? await getRegisteredNumber(input.prn) : null);
  // Stored numbers are often bare 10-digit; WhatsApp needs the country code.
  const phone = raw ? formatGoBuzzPhone(raw) : null;

  if (!PUSH_ENABLED) {
    console.log(`[wa-notify] push disabled — would send ${input.template} to ${phone ?? 'unknown'}`);
    return false;
  }
  if (!phone) {
    await writeLog({ prn: input.prn, phone: '', template: input.template, refType: input.refType, refId: input.refId, status: 'skipped', error: 'no registered number' });
    return false;
  }

  // De-dupe: never send the same template twice for the same reference.
  if (input.refId) {
    const already = await prisma.whatsappNotificationLog.findFirst({
      where: { template: input.template, refId: input.refId, status: 'sent' },
      select: { id: true },
    });
    if (already) return false;
  }

  try {
    let documentId: string | undefined;
    if (input.documentPath) {
      const id = await uploadMedia(input.documentPath);
      if (id) documentId = id;
    }
    await sendTemplate(phone, input.template, LANG, input.params, {
      urlButtonParam: input.urlToken,
      headerDocumentId: documentId,
      headerDocumentFilename: input.documentFilename,
    });
    await writeLog({ prn: input.prn, phone, template: input.template, refType: input.refType, refId: input.refId, status: 'sent' });
    return true;
  } catch (e) {
    await writeLog({ prn: input.prn, phone, template: input.template, refType: input.refType, refId: input.refId, status: 'failed', error: (e as Error).message });
    console.error(`[wa-notify] ${input.template} failed:`, (e as Error).message);
    return false;
  }
}

// ── Convenience wrappers (param order matches docs/whatsapp-templates.md) ────

export const notifyReportReady = (prn: number, name: string, testName: string, token: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.REPORT_READY, params: [name, testName, String(prn)], urlToken: token, refType: 'InvestigationResult', refId });

export const notifyOpdNotesReady = (prn: number, name: string, doctor: string, date: string, token: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.OPD_NOTES_READY, params: [name, doctor, date], urlToken: token, refType: 'DoctorNote', refId });

export const notifyPrescriptionReady = (prn: number, name: string, doctor: string, token: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.PRESCRIPTION_READY, params: [name, doctor], urlToken: token, refType: 'Prescription', refId });

export const notifyDischargeSummaryReady = (prn: number, name: string, doctor: string, token: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.DISCHARGE_SUMMARY_READY, params: [name, doctor], urlToken: token, refType: 'IpdDischarge', refId });

export const notifyAdmissionWelcome = (prn: number, name: string, unit: string, doctor: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.ADMISSION_WELCOME, params: [name, unit, doctor], refType: 'IpdAdmission', refId });

export const notifyDischargeInitiated = (prn: number, name: string, doctor: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.DISCHARGE_INITIATED, params: [name, doctor], refType: 'IpdDischarge', refId });

export const notifyDischargeStep = (prn: number, name: string, doneStep: string, nextStep: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.DISCHARGE_STEP_UPDATE, params: [name, doneStep, nextStep], refType: 'DischargeClearance', refId });

export const notifyBillReady = (prn: number, name: string, billNo: string, pdfPath: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.BILL_READY, params: [name, billNo], documentPath: pdfPath, documentFilename: `Bill-${billNo}.pdf`, refType: 'Bill', refId });

export const notifyDischargeGatepass = (prn: number, name: string, refId: string) =>
  notifyPatient({ prn, template: TEMPLATES.DISCHARGE_GATEPASS, params: [name], refType: 'IpdDischarge', refId });

export const notifyAppointmentConfirmed = (prn: number | null, phone: string, name: string, doctor: string, date: string, time: string, refId: string) =>
  notifyPatient({ prn, phone, template: TEMPLATES.APPOINTMENT_CONFIRMED, params: [name, doctor, date, time], refType: 'Appointment', refId });

export const notifyAppointmentReminder = (prn: number | null, phone: string, name: string, doctor: string, date: string, time: string, refId: string) =>
  notifyPatient({ prn, phone, template: TEMPLATES.APPOINTMENT_REMINDER, params: [name, doctor, date, time], refType: 'Appointment', refId });

export const notifyAppointmentCancelled = (prn: number | null, phone: string, name: string, doctor: string, date: string, refId: string) =>
  notifyPatient({ prn, phone, template: TEMPLATES.APPOINTMENT_CANCELLED, params: [name, doctor, date], refType: 'Appointment', refId });

export const notifyDoorstepStatus = (phone: string, name: string, service: string, refNo: string, status: string, prn?: number | null) =>
  notifyPatient({ prn, phone, template: TEMPLATES.DOORSTEP_STATUS_UPDATE, params: [name, service, refNo, status], refType: 'DoorstepRequest', refId: `${refNo}:${status}` });

export const notifyEnquiryAck = (phone: string, name: string, enquiryType: string, hours: string, refId: string) =>
  notifyPatient({ phone, template: TEMPLATES.ENQUIRY_ACKNOWLEDGEMENT, params: [name, enquiryType, hours], refType: 'CallbackRequest', refId });

export const notifyFeedbackRequest = (prn: number | null, phone: string, name: string, visitDate: string, token: string, refId: string) =>
  notifyPatient({ prn, phone, template: TEMPLATES.FEEDBACK_REQUEST, params: [name, visitDate], urlToken: token, refType: 'FeedbackSurvey', refId });
