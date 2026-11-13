import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { getClinicalActor } from '../../middleware/audit-guard';
import { auditLog } from '../../service/app-audit';
import { notifyConsultationStarted } from '../appointments/appointment.controller';
import { clearPriorityFor, getPriorityFor } from '../priority/priority.controller';

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
      ids.length
        ? prisma.oPDAssessment.findMany({ where: { appointmentId: { in: ids } }, select: { id: true, appointmentId: true }, orderBy: { id: 'desc' } })
        : [],
      prns.length
        ? prisma.investigationResult.findMany({
            where: { prn: { in: prns }, isDeleted: false, createdAt: { gte: startOfToday } },
            select: { prn: true, criticalFlag: true },
          })
        : [],
      prns.length ? prisma.allergy.findMany({ where: { prn: { in: prns } }, select: { prn: true, genericName: true } }) : [],
    ]);

    const noteByAppt = new Map<number, number>();
    for (const n of notes) if (n.appointmentId != null && !noteByAppt.has(n.appointmentId)) noteByAppt.set(n.appointmentId, n.id);

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
          assessmentId: noteByAppt.get(a.id) ?? null,
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

/** GET /api/opd/my-queue/:appointmentId — patient header, vitals, allergies, saved note, last prescription. */
export const getMyConsultation = async (req: Request, res: Response): Promise<void> => {
  try {
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt } = own;
    const prn = appt.prnNumber != null ? String(appt.prnNumber) : null;

    const [note, allergies, lastRx] = await Promise.all([
      prisma.oPDAssessment.findFirst({
        where: { appointmentId: appt.id },
        orderBy: { id: 'desc' },
        select: { id: true, history: true, examination: true, investigation: true, treatmentPlan: true, updatedAt: true, noteTemplateId: true },
      }),
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
        vitals: vitalsOf(appt),
        allergies,
        note: note
          ? {
              id: note.id,
              history: note.history ?? '',
              examination: note.examination ?? '',
              investigation: note.investigation ?? '',
              ...splitPlan(note.treatmentPlan),
              templated: !!note.noteTemplateId,
              updatedAt: note.updatedAt,
            }
          : null,
        lastPrescription: lastRx,
      },
    });
  } catch (error) {
    console.error('[opd:my-queue:get] failed:', error);
    res.status(500).json({ error: 'Failed to load the consultation' });
  }
};

/** PUT /api/opd/my-queue/:appointmentId/assessment — create or update the OPD note for this visit. */
export const saveMyAssessment = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAppointment(req, res);
    if (!own) return;
    const { appt, doctor } = own;

    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const b = req.body ?? {};
    const sections = {
      history: str(b.history),
      examination: str(b.examination),
      investigation: str(b.investigation),
    };
    const diagnosis = str(b.diagnosis);
    const plan = str(b.treatmentPlan);

    const existing = await prisma.oPDAssessment.findFirst({
      where: { appointmentId: appt.id },
      orderBy: { id: 'desc' },
      select: { id: true, treatmentPlan: true, noteTemplateId: true },
    });
    if (existing?.noteTemplateId) {
      res.status(409).json({ error: 'This visit was written with a note template on the web panel. Edit it there.' });
      return;
    }

    // Only overwrite the plan when either half was sent; keep the other half as stored.
    let treatmentPlan: string | null | undefined;
    if (diagnosis !== undefined || plan !== undefined) {
      const prev = splitPlan(existing?.treatmentPlan);
      treatmentPlan = joinPlan(diagnosis ?? prev.diagnosis, plan ?? prev.treatmentPlan);
    }

    const content = {
      ...sections,
      ...(treatmentPlan !== undefined ? { treatmentPlan } : {}),
    };

    const v = vitalsOf(appt);
    const saved = existing
      ? await prisma.oPDAssessment.update({ where: { id: existing.id }, data: content })
      : await prisma.oPDAssessment.create({
          data: {
            ...content,
            appointmentId: appt.id,
            doctorId: appt.doctorId,
            name: appt.patientName,
            age: appt.age ?? '',
            gender: appt.gender,
            uhId: appt.prnNumber != null ? String(appt.prnNumber) : null,
            date: appt.date,
            assessmentTime: moment().tz(TZ).format('HH:mm'),
            consultant: doctor?.name ?? appt.doctorName,
            doctorName: doctor?.name ?? appt.doctorName,
            kmcNo: doctor?.kmcNumber ?? null,
            department: appt.department,
            bp: v.bp,
            pulse: v.pulse,
            hr: v.pulse,
            rr: v.rr,
            temp: v.temp,
            spo2: v.spo2,
            height: v.height,
            weight: v.weight,
            createdBy: actorId,
          },
        });

    await auditLog(req, {
      module: 'opd-assessment',
      action: existing ? 'UPDATE' : 'CREATE',
      entityType: 'OPDAssessment',
      entityId: saved.id,
      payload: { appointmentId: appt.id, via: 'mobile' },
    });

    res.status(200).json({
      data: {
        id: saved.id,
        history: saved.history ?? '',
        examination: saved.examination ?? '',
        investigation: saved.investigation ?? '',
        ...splitPlan(saved.treatmentPlan),
        templated: false,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    console.error('[opd:my-queue:assessment] failed:', error);
    res.status(500).json({ error: 'Failed to save the consultation note' });
  }
};
