import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { getClinicalActor } from '../../middleware/audit-guard';
import { auditLog } from '../../service/app-audit';
import { notifyConsultationStarted } from '../appointments/appointment.controller';
import { clearPriorityFor, getPriorityFor } from '../priority/priority.controller';
import { snapshotTemplateFields } from '../note-template/note-template.controller';
import { buildRecordFile } from '../../service/record-builder.service';
import { uploadMediaToGoBuzz, sendDocumentTemplate, formatGoBuzzPhone } from '../../service/gobuzz-document';
import { generatePrescriptionId } from '../prescription/prescription.controller';
import { syncPrescriptionToHmis } from '../prescription/prescription-sync';

// Doctor mobile app — the logged-in doctor's OPD day. Separate from the web
// endpoints (which stay unchanged): the queue is scoped server-side to the
// doctor, "today" is the hospital's date (IST, not UTC), visit progress is one
// state instead of four booleans, and start/finish/save write only the fields
// they own. Users without a Doctor row (admins) see every doctor's queue.

const TZ = 'Asia/Kolkata';
/** OPDAssessment has no diagnosis column; it is stored as the first line of treatmentPlan. */
export const DX_PREFIX = 'Diagnosis: ';

export type OpdVisitState = 'waiting' | 'in_consultation' | 'done' | 'postponed';

export function visitState(a: { checkedOut: boolean | null; endConsultation: boolean | null; postPond: boolean | null }): OpdVisitState {
  if (a.checkedOut && a.endConsultation) return 'done';
  if (a.checkedOut) return 'in_consultation';
  if (a.postPond) return 'postponed';
  return 'waiting';
}

export function joinPlan(diagnosis: string | null | undefined, plan: string | null | undefined): string | null {
  const dx = diagnosis?.trim();
  const rest = plan?.trim() ?? '';
  if (!dx) return rest || null;
  return rest ? `${DX_PREFIX}${dx}\n\n${rest}` : `${DX_PREFIX}${dx}`;
}

export function splitPlan(stored: string | null | undefined): { diagnosis: string; treatmentPlan: string } {
  const text = stored ?? '';
  if (!text.startsWith(DX_PREFIX)) return { diagnosis: '', treatmentPlan: text };
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  return { diagnosis: first.slice(DX_PREFIX.length).trim(), treatmentPlan: nl === -1 ? '' : text.slice(nl).trim() };
}

/** "10:30 AM" → minutes since midnight, for ordering; unparsable times sort last. */
function slotMinutes(time: string | null | undefined): number {
  const m = moment(time ?? '', ['h:mm A', 'hh:mm A', 'HH:mm'], true);
  return m.isValid() ? m.hours() * 60 + m.minutes() : 24 * 60;
}

async function currentDoctor(req: Request) {
  const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
  return userId
    ? prisma.doctor.findFirst({
        where: { userId },
        select: { id: true, name: true, kmcNumber: true, departmentName: true, departmentId: true, slotDuration: true },
      })
    : null;
}

const APPOINTMENT_SELECT = {
  id: true,
  phoneNumber: true,
  doctorId: true,
  doctorName: true,
  department: true,
  patientName: true,
  prnNumber: true,
  age: true,
  gender: true,
  date: true,
  time: true,
  type: true,
  patientType: true,
  isfollowup: true,
  checkedInTime: true,
  checkedOut: true,
  checkedOutTime: true,
  endConsultation: true,
  endConsultationTime: true,
  postPond: true,
  BPs: true,
  BPd: true,
  pulse: true,
  RR: true,
  temp: true,
  spo2: true,
  height: true,
  weight: true,
} as const;

/** Loads the appointment and checks it belongs to the logged-in doctor (admins pass). Sends the error itself. */
async function loadOwnAppointment(req: Request, res: Response) {
  const appointmentId = Number(req.params.appointmentId);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    res.status(400).json({ error: 'Invalid appointment id' });
    return null;
  }
  const [doctor, appt] = await Promise.all([
    currentDoctor(req),
    prisma.appointment.findUnique({ where: { id: appointmentId }, select: APPOINTMENT_SELECT }),
  ]);
  if (!appt) {
    res.status(404).json({ error: 'Appointment not found' });
    return null;
  }
  if (doctor && appt.doctorId !== doctor.id) {
    res.status(403).json({ error: 'This patient is not in your OPD' });
    return null;
  }
  return { doctor, appt };
}

function vitalsOf(a: { BPs: string | null; BPd: string | null; pulse: string | null; RR: string | null; temp: string | null; spo2: string | null; height: string | null; weight: string | null }) {
  return {
    bp: a.BPs && a.BPd ? `${a.BPs}/${a.BPd}` : null,
    pulse: a.pulse || null,
    rr: a.RR || null,
    temp: a.temp || null,
    spo2: a.spo2 || null,
    height: a.height || null,
    weight: a.weight || null,
  };
}

/** GET /api/opd/my-queue — today's checked-in patients for the logged-in doctor. */
export const getMyOpdQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctor = await currentDoctor(req);
    const today = moment().tz(TZ).format('YYYY-MM-DD');

    const appts = await prisma.appointment.findMany({
      where: {
        date: today,
        checkedIn: true,
        status: 'confirmed',
        ...(doctor ? { doctorId: doctor.id } : {}),
      },
      select: APPOINTMENT_SELECT,
      take: 300,
    });

    const ids = appts.map((a) => a.id);
    const prns = [...new Set(appts.map((a) => a.prnNumber).filter((p): p is number => p != null).map(String))];
    const startOfToday = moment.tz(today, TZ).toDate();

    const [notes, results, allergies] = await Promise.all([
      // The doctor's OPD note for today's visit (DoctorNote: one per PRN per date).
      prns.length
        ? prisma.doctorNote.findMany({ where: { prn: { in: prns.map(Number) }, date: today }, select: { id: true, prn: true }, orderBy: { id: 'desc' } })
        : [],
      prns.length
        ? prisma.investigationResult.findMany({
            where: { prn: { in: prns }, isDeleted: false, createdAt: { gte: startOfToday } },
            select: { prn: true, criticalFlag: true },
          })
        : [],
      prns.length ? prisma.allergy.findMany({ where: { prn: { in: prns } }, select: { prn: true, genericName: true } }) : [],
    ]);

    const noteByPrn = new Map<number, number>();
    for (const n of notes) if (!noteByPrn.has(n.prn)) noteByPrn.set(n.prn, n.id);

    const data = appts
      .map((a) => {
        const prn = a.prnNumber != null ? String(a.prnNumber) : null;
        const res = prn ? results.filter((r) => r.prn === prn) : [];
        const pr = getPriorityFor(a.id);
        return {
          id: a.id,
          patientName: a.patientName,
          prn,
          age: a.age,
          gender: a.gender,
          time: a.time,
          visitType: a.isfollowup ? 'Follow-up' : a.patientType || a.type || null,
          state: visitState(a),
          checkedInAt: a.checkedInTime,
          startedAt: a.checkedOutTime,
          finishedAt: a.endConsultationTime,
          priority: pr && pr.priority !== 'normal' ? { level: pr.priority, reason: pr.reason ?? null } : null,
          assessmentId: a.prnNumber != null ? noteByPrn.get(a.prnNumber) ?? null : null,
          resultsToday: res.length,
          criticalToday: res.some((r) => r.criticalFlag),
          allergies: prn ? allergies.filter((x) => x.prn === prn).map((x) => x.genericName) : [],
          vitals: vitalsOf(a),
          doctorName: doctor ? undefined : a.doctorName,
        };
      })
      .sort((x, y) => {
        // In consultation first, then priority patients, then by slot time.
        const rank = (r: typeof x) => (r.state === 'in_consultation' ? 0 : r.priority ? 1 : 2);
        return rank(x) - rank(y) || slotMinutes(x.time) - slotMinutes(y.time);
      });

    res.status(200).json({
      data,
      date: today,
      doctor: doctor ? { id: doctor.id, name: doctor.name, kmcNumber: doctor.kmcNumber, department: doctor.departmentName, departmentId: doctor.departmentId } : null,
    });
  } catch (error) {
    console.error('[opd:my-queue] failed:', error);
    res.status(500).json({ error: 'Failed to load your OPD queue' });
  }
};

/** POST /api/opd/my-queue/:appointmentId/start — closes any other open consultation of this doctor, then starts this one. */
export const startMyConsultation = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt, doctor } = own;

    if (appt.checkedOut) {
      res.status(200).json({ data: { id: appt.id, state: visitState(appt) } });
      return;
    }

    const now = new Date();
    if (appt.doctorId != null) {
      await prisma.appointment.updateMany({
        where: { doctorId: appt.doctorId, date: appt.date, checkedOut: true, NOT: { endConsultation: true }, id: { not: appt.id } },
        data: { endConsultation: true, endConsultationTime: now },
      });
    }
    const waited = appt.checkedInTime ? Math.max(0, Math.round((now.getTime() - appt.checkedInTime.getTime()) / 60000)) : null;
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { checkedOut: true, checkedOutTime: now, ...(waited != null ? { waitingTime: String(waited) } : {}) },
    });

    clearPriorityFor(appt.id);
    if (appt.doctorId != null) {
      notifyConsultationStarted({
        doctorId: appt.doctorId,
        appointmentId: appt.id,
        patientName: appt.patientName,
        doctorName: doctor?.name ?? appt.doctorName,
      });
    }
    await auditLog(req, { module: 'opd', action: 'UPDATE', entityType: 'Appointment', entityId: appt.id, payload: { consultation: 'started', via: 'mobile' } });

    res.status(200).json({ data: { id: appt.id, state: 'in_consultation' as OpdVisitState, startedAt: now } });
  } catch (error) {
    console.error('[opd:my-queue:start] failed:', error);
    res.status(500).json({ error: 'Failed to start the consultation' });
  }
};

/** POST /api/opd/my-queue/:appointmentId/finish */
export const finishMyConsultation = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt } = own;

    const now = new Date();
    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        checkedOut: true,
        ...(appt.checkedOutTime ? {} : { checkedOutTime: now }),
        endConsultation: true,
        endConsultationTime: now,
      },
    });
    await auditLog(req, { module: 'opd', action: 'UPDATE', entityType: 'Appointment', entityId: appt.id, payload: { consultation: 'finished', via: 'mobile' } });

    res.status(200).json({ data: { id: appt.id, state: 'done' as OpdVisitState, finishedAt: now } });
  } catch (error) {
    console.error('[opd:my-queue:finish] failed:', error);
    res.status(500).json({ error: 'Failed to finish the consultation' });
  }
};

/** The doctor's OPD note for a visit = the web's DoctorNote (one per PRN per visit date). */
const NOTE_FIELDS = ['chiefComplaints', 'diagnosis', 'generalExamination', 'clinicalNotes', 'advice', 'cvs', 'rs', 'cns', 'pa'] as const;
type NoteField = (typeof NOTE_FIELDS)[number];

type DoctorNoteRow = {
  id: number;
  noteTemplateId: string | null;
  templatedValues: string | null;
  updatedAt: Date;
} & Partial<Record<NoteField, string | null>>;

function shapeNote(n: DoctorNoteRow) {
  let template: { schema: unknown[]; values: Record<string, unknown> } | null = null;
  if (n.noteTemplateId && n.templatedValues) {
    try {
      const t = JSON.parse(n.templatedValues) as { _schema?: unknown[]; _values?: Record<string, unknown> };
      template = { schema: Array.isArray(t._schema) ? t._schema : [], values: t._values ?? {} };
    } catch {
      template = { schema: [], values: {} };
    }
  }
  return {
    id: n.id,
    fields: Object.fromEntries(NOTE_FIELDS.map((k) => [k, n[k] ?? ''])) as Record<NoteField, string>,
    noteTemplateId: n.noteTemplateId,
    template,
    updatedAt: n.updatedAt,
  };
}

async function findVisitNote(prn: number, date: string) {
  return prisma.doctorNote.findFirst({ where: { prn, date }, orderBy: { id: 'desc' } });
}

/** GET /api/opd/my-queue/:appointmentId — patient header, vitals, allergies, OPD note, last prescription. */
export const getMyConsultation = async (req: Request, res: Response): Promise<void> => {
  try {
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt, doctor } = own;
    const prn = appt.prnNumber != null ? String(appt.prnNumber) : null;

    const [note, allergies, lastRx] = await Promise.all([
      appt.prnNumber != null ? findVisitNote(appt.prnNumber, appt.date) : null,
      prn ? prisma.allergy.findMany({ where: { prn }, select: { id: true, genericName: true } }) : [],
      prn
        ? prisma.prescription.findFirst({
            where: { prn },
            orderBy: { id: 'desc' },
            select: {
              prescriptionId: true,
              prescribedDate: true,
              prescribedBy: true,
              tablets: { select: { genericName: true, brandName: true, frequency: true, duration: true, instructions: true, quantity: true } },
            },
          })
        : null,
    ]);

    res.status(200).json({
      data: {
        id: appt.id,
        patientName: appt.patientName,
        prn,
        age: appt.age,
        gender: appt.gender,
        time: appt.time,
        date: appt.date,
        state: visitState(appt),
        // Templates are looked up by the doctor's department (as on the web), else the visit's.
        department: doctor?.departmentName ?? appt.department,
        // For a counselling estimate (the estimate goes to this number on WhatsApp).
        phone: appt.phoneNumber,
        vitals: vitalsOf(appt),
        allergies,
        note: note ? shapeNote(note) : null,
        lastPrescription: lastRx,
      },
    });
  } catch (error) {
    console.error('[opd:my-queue:get] failed:', error);
    res.status(500).json({ error: 'Failed to load the consultation' });
  }
};

/**
 * PUT /api/opd/my-queue/:appointmentId/assessment — save the doctor's OPD note.
 * Body: { fields: {chiefComplaints, diagnosis, ...} } for the standard note, or
 * { noteTemplateId, templatedValueMap } for a template (frozen at save time, like the web).
 * Saving never messages the patient — POST /send-notes does that.
 */
export const saveMyAssessment = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt, doctor } = own;
    if (appt.prnNumber == null) {
      res.status(400).json({ error: 'This visit has no PRN, so a note cannot be saved. Ask reception to link the patient.' });
      return;
    }

    const b = (req.body ?? {}) as { fields?: Record<string, unknown>; noteTemplateId?: unknown; templatedValueMap?: unknown };
    const fields: Partial<Record<NoteField, string>> = {};
    for (const k of NOTE_FIELDS) if (typeof b.fields?.[k] === 'string') fields[k] = b.fields[k] as string;

    let templatePart: { noteTemplateId: string | null; templatedValues: string | null } = { noteTemplateId: null, templatedValues: null };
    if (typeof b.noteTemplateId === 'string' && b.noteTemplateId && b.templatedValueMap && typeof b.templatedValueMap === 'object') {
      const schema = await snapshotTemplateFields(b.noteTemplateId);
      if (!schema) {
        res.status(400).json({ error: 'That note template no longer exists.' });
        return;
      }
      templatePart = { noteTemplateId: b.noteTemplateId, templatedValues: JSON.stringify({ _schema: schema, _values: b.templatedValueMap }) };
    }

    const by = req.user?.username ?? null;
    const existing = await findVisitNote(appt.prnNumber, appt.date);
    const saved = existing
      ? await prisma.doctorNote.update({
          where: { id: existing.id },
          data: { ...fields, ...templatePart, doctorId: existing.doctorId ?? doctor?.id ?? appt.doctorId, updatedBy: by },
        })
      : await prisma.doctorNote.create({
          data: { prn: appt.prnNumber, date: appt.date, ...fields, ...templatePart, doctorId: doctor?.id ?? appt.doctorId, createdBy: by, updatedBy: by },
        });

    await auditLog(req, {
      module: 'doctor-notes',
      action: existing ? 'UPDATE' : 'CREATE',
      entityType: 'DoctorNote',
      entityId: saved.id,
      payload: { appointmentId: appt.id, templated: !!templatePart.noteTemplateId, via: 'mobile' },
    });
    res.status(200).json({ data: shapeNote(saved) });
  } catch (error) {
    console.error('[opd:my-queue:assessment] failed:', error);
    res.status(500).json({ error: 'Failed to save the OPD note' });
  }
};

/** Same AppAuditLog key the web's "Send visit summary" writes, so web and app share the send history. */
const VISIT_SUMMARY_SEND_AUDIT = { module: 'opd-visit-summary', action: 'WHATSAPP_SENT', entityType: 'Appointment' } as const;

class SendError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Send a PDF to the visit's patient on WhatsApp the way the web's working
 * "Send visit summary" does: an approved document template with the PDF
 * attached, body params [patient name, doctor name]. Recipient = the registered
 * patient number (else the booking number), never a number from the client.
 * Throws SendError with a doctor-readable reason; nothing fails silently.
 */
async function sendVisitPdf(opts: {
  appt: { prnNumber: number | null; patientName: string; phoneNumber: string | null };
  doctorName: string;
  filePath: string;
  displayName: string;
  templateName: string;
  templateLang: string;
}): Promise<{ sentTo: string; messageId: string }> {
  const nonBlank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined);
  const pd =
    opts.appt.prnNumber != null
      ? await prisma.patientDetails.findUnique({ where: { prn: opts.appt.prnNumber }, select: { name: true, mobileNo: true } })
      : null;
  const phone = nonBlank(pd?.mobileNo) ?? nonBlank(opts.appt.phoneNumber);
  if (!phone) throw new SendError(400, 'No phone number on record for this patient.');
  const patientName = nonBlank(pd?.name) ?? nonBlank(opts.appt.patientName) ?? 'Patient';
  const bodyParamNames = (process.env.GOBUZZ_OPD_SUMMARY_PARAM_NAMES || '').split(',').map((n) => n.trim()).filter(Boolean);
  try {
    const mediaId = await uploadMediaToGoBuzz(opts.filePath);
    const response = await sendDocumentTemplate({
      to: formatGoBuzzPhone(phone),
      templateName: opts.templateName,
      templateLang: opts.templateLang,
      mediaId,
      filename: opts.displayName,
      bodyParams: [patientName, opts.doctorName],
      ...(bodyParamNames.length ? { bodyParamNames } : {}),
    });
    const messageId = response.data?.messages?.[0]?.id;
    if (!messageId) {
      console.error('[opd:mobile-send] unexpected GoBuzz response:', response.data);
      throw new SendError(502, 'WhatsApp did not accept the message. Try again.');
    }
    return { sentTo: `******${phone.replace(/\D/g, '').slice(-4)}`, messageId };
  } catch (e) {
    if (e instanceof SendError) throw e;
    const gobuzz = (e as { response?: { data?: any } })?.response?.data;
    const reason = gobuzz
      ? gobuzz?.error?.error_data?.details || gobuzz?.error?.message || gobuzz?.message || JSON.stringify(gobuzz)
      : (e as Error).message;
    console.error('[opd:mobile-send] GoBuzz rejection:', gobuzz ? JSON.stringify(gobuzz) : e);
    throw new SendError(502, `WhatsApp send rejected: ${String(reason).slice(0, 200)}`);
  }
}

/**
 * POST /api/opd/my-queue/:appointmentId/send-notes — WhatsApp the consultation
 * summary PDF (notes, vitals, tests, medicines) to the patient, only when the
 * doctor taps send. Uses the web's approved visit-summary templates
 * (GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME; ..._UPDATE_... for a resend).
 */
export const sendMyNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt, doctor } = own;
    const note = appt.prnNumber != null ? await findVisitNote(appt.prnNumber, appt.date) : null;
    if (!note || appt.prnNumber == null) {
      res.status(409).json({ error: 'Save the OPD note before sending it.' });
      return;
    }
    const previous = await prisma.appAuditLog.count({ where: { ...VISIT_SUMMARY_SEND_AUDIT, entityId: String(appt.id) } });
    const first = process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME;
    const templateName = previous > 0 ? process.env.GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_NAME || first : first;
    if (!templateName) {
      res.status(503).json({ error: 'The visit-summary WhatsApp template is not set up on the server (GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME).' });
      return;
    }
    const templateLang =
      previous > 0
        ? process.env.GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_LANG || process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_LANG || 'en'
        : process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_LANG || 'en';
    const built = await buildRecordFile('REC_OPD', String(note.id), appt.prnNumber, appt.patientName);
    if (!built) {
      res.status(500).json({ error: 'Could not build the consultation summary PDF.' });
      return;
    }
    const sent = await sendVisitPdf({
      appt,
      doctorName: doctor?.name ?? appt.doctorName ?? 'your doctor',
      filePath: built.filePath,
      displayName: `VisitSummary_${appt.date}.pdf`,
      templateName,
      templateLang,
    });
    await auditLog(req, {
      ...VISIT_SUMMARY_SEND_AUDIT,
      entityId: appt.id,
      payload: { prn: appt.prnNumber, date: appt.date, template: previous > 0 ? 'updated' : 'initial', templateName, sentTo: sent.sentTo, messageId: sent.messageId, noteId: note.id, via: 'mobile' },
    });
    res.status(200).json({ data: { noteId: note.id, sentTo: sent.sentTo, sentAt: new Date() } });
  } catch (error) {
    if (error instanceof SendError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('[opd:my-queue:send-notes] failed:', error);
    res.status(500).json({ error: 'Failed to send the consultation summary' });
  }
};

/**
 * GET /api/opd/my-estimates?prn= — the counselling estimates this doctor has
 * raised (optionally for one patient), newest first, with the admission a
 * confirmed estimate was referred to. Read-only; raising and referring use the
 * existing /api/estimation endpoints. Users without a Doctor row must pass a PRN.
 */
export const getMyEstimates = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctor = await currentDoctor(req);
    const prnRaw = String(req.query.prn ?? '').trim();
    const prn = /^\d+$/.test(prnRaw) ? Number(prnRaw) : null;
    if (!doctor && prn === null) {
      res.status(403).json({ error: 'Only doctors have estimates' });
      return;
    }
    const rows = await prisma.estimationDetails.findMany({
      where: {
        NOT: { estimationId: 'emergency' },
        ...(doctor ? { consultantId: doctor.id } : {}),
        ...(prn !== null ? { patientUHID: prn } : {}),
      },
      orderBy: { id: 'desc' },
      take: prn !== null ? 30 : 100,
      select: {
        id: true, estimationId: true, patientName: true, patientUHID: true, estimationName: true,
        estimationType: true, statusOfEstimation: true, estimationStatus: true, estimationPreferredDate: true,
        estimatedDate: true, estimationCreatedTime: true, totalEstimationAmount: true, surgeryTime: true,
        totalDaysStay: true, icuStay: true, remarks: true, rejectReason: true, feedback: true,
      },
    });
    const admissions = rows.length
      ? await prisma.ipdAdmission.findMany({
          where: { referralEstimationId: { in: rows.map((r) => r.estimationId) }, status: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
          select: { referralEstimationId: true, admissionNo: true, status: true },
        })
      : [];
    const admissionOf = new Map<string, { admissionNo: string | null; status: string }>();
    for (const a of admissions) {
      if (a.referralEstimationId && !admissionOf.has(a.referralEstimationId)) admissionOf.set(a.referralEstimationId, { admissionNo: a.admissionNo, status: a.status });
    }
    res.status(200).json({
      data: rows.map((r) => ({
        ...r,
        status: r.statusOfEstimation ?? 'pending',
        admission: admissionOf.get(r.estimationId) ?? null,
      })),
    });
  } catch (error) {
    console.error('[opd:my-estimates] failed:', error);
    res.status(500).json({ error: 'Failed to load estimates' });
  }
};

type RxTabletIn = { genericName?: string; brandName?: string; frequency?: string; duration?: string; instructions?: string; quantity?: number };

/**
 * POST /api/opd/my-queue/:appointmentId/prescription — sign (save) the visit's
 * prescription WITHOUT messaging the patient. Same record, id format, audit and
 * HMIS sync as the web's POST /api/prescription, minus its automatic WhatsApp:
 * on the app the doctor decides when to send (see send-prescription).
 */
export const signMyPrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt, doctor } = own;
    if (appt.prnNumber == null) {
      res.status(400).json({ error: 'This visit has no PRN, so a prescription cannot be saved.' });
      return;
    }
    const tablets = (Array.isArray(req.body?.tablets) ? req.body.tablets : []) as RxTabletIn[];
    const clean = tablets
      .map((t) => ({
        genericName: String(t.genericName ?? '').trim(),
        brandName: String(t.brandName ?? '').trim(),
        frequency: String(t.frequency ?? '').trim(),
        duration: String(t.duration ?? '').trim(),
        instructions: String(t.instructions ?? '').trim(),
        quantity: Math.max(0, Math.round(Number(t.quantity) || 0)),
      }))
      .filter((t) => t.brandName || t.genericName);
    if (!clean.length || clean.some((t) => !t.frequency || !t.duration)) {
      res.status(400).json({ error: 'Every medicine needs a dose and a duration.' });
      return;
    }
    const prescriptionId = await generatePrescriptionId();
    const rx = await prisma.prescription.create({
      data: {
        prescriptionId,
        prescribedBy: doctor?.name ?? req.user?.username ?? 'Doctor',
        prn: String(appt.prnNumber),
        patientName: appt.patientName,
        prescribedDate: appt.date,
        prescribedById: String(actorId),
        prescribedByKMC: doctor?.kmcNumber ?? null,
        tablets: { create: clean.map((t) => ({ ...t, genericName: t.genericName || t.brandName, brandName: t.brandName || t.genericName })) },
      },
      include: { tablets: true },
    });
    await auditLog(req, {
      module: 'prescription', action: 'CREATE', entityType: 'Prescription', entityId: rx.id,
      payload: { prescriptionId, prn: rx.prn, tabletCount: clean.length, appointmentId: appt.id, via: 'mobile', sent: false },
    });
    res.status(201).json({ data: { prescriptionId, id: rx.id } });
    syncPrescriptionToHmis(rx).catch((err) => console.error('HMIS prescription sync failed:', err));
  } catch (error) {
    console.error('[opd:my-queue:prescription] failed:', error);
    res.status(500).json({ error: 'Failed to save the prescription' });
  }
};
