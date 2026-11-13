import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { getClinicalActor } from '../../middleware/audit-guard';
import { auditLog } from '../../service/app-audit';
import { notifyConsultationStarted } from '../appointments/appointment.controller';
import { clearPriorityFor, getPriorityFor } from '../priority/priority.controller';
import { snapshotTemplateFields } from '../note-template/note-template.controller';
import { pushOpdNotesReady } from '../../service/record-push.service';

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
        select: { id: true, name: true, kmcNumber: true, departmentName: true, slotDuration: true },
      })
    : null;
}

const APPOINTMENT_SELECT = {
  id: true,
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
      doctor: doctor ? { id: doctor.id, name: doctor.name, kmcNumber: doctor.kmcNumber, department: doctor.departmentName } : null,
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

/**
 * POST /api/opd/my-queue/:appointmentId/send-notes — send the OPD notes to the
 * patient on WhatsApp: the same "OPD notes ready" message + PDF link the web
 * sends when a doctor saves a note. Only when the doctor taps send.
 */
export const sendMyNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt } = own;
    const note = appt.prnNumber != null ? await findVisitNote(appt.prnNumber, appt.date) : null;
    if (!note) {
      res.status(409).json({ error: 'Save the OPD note before sending it.' });
      return;
    }
    await pushOpdNotesReady(note.id); // never throws; failures are logged by the push service
    await auditLog(req, { module: 'doctor-notes', action: 'SEND', entityType: 'DoctorNote', entityId: note.id, payload: { appointmentId: appt.id, via: 'mobile' } });
    res.status(200).json({ data: { noteId: note.id, sentAt: new Date() } });
  } catch (error) {
    console.error('[opd:my-queue:send-notes] failed:', error);
    res.status(500).json({ error: 'Failed to send the OPD notes' });
  }
};
