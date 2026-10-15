import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import {
  recordAppointmentEventSystem,
  slotSnapshot,
  subjectSnapshot,
} from '../../service/appointment-event';

// ─── AI voice/chat receptionist — data access ───────────────────────────────
//
// Machine-to-machine API for the AI receptionist agent (E:\AI Calling). Booking
// mirrors the WhatsApp bot (whatsapp-bot.controller.ts finalizeFlow): requests are
// created as 'pending' without reserving a BookedSlot; staff confirm in the panel.
// Slot/date rules are the same as the bot's getFreeSlots / availableDates.

const TZ = 'Asia/Kolkata';
const istYmd = (d?: Date | string): string => moment(d).tz(TZ).format('YYYY-MM-DD');
const istWeekday = (ymd: string): string => moment.tz(ymd, 'YYYY-MM-DD', TZ).format('ddd').toLowerCase();

export const SOURCE = 'ai-receptionist';
// Notification.message is a plain String → VARCHAR(191) on MySQL.
const MSG_MAX = 190;

/** Last 10 digits of an Indian phone number ("+91 98765-43210" → "9876543210"). */
export const last10 = (phone: string): string => (phone ?? '').replace(/\D/g, '').slice(-10);

function fmtSlot(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}
function slotToMin(slot: string): number {
  const [time, period] = slot.trim().split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  else if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

export async function listDepartments() {
  return prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

export async function listDoctors(filter: { departmentId?: number; q?: string }) {
  return prisma.doctor.findMany({
    where: {
      isActive: true,
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.q ? { name: { contains: filter.q } } : {}),
    },
    select: { id: true, name: true, qualification: true, departmentId: true, departmentName: true, doctorType: true },
    orderBy: { name: 'asc' },
  });
}

/** Free slots for a doctor on a YYYY-MM-DD date in "hh:mm AM/PM", future-only today. */
export async function getFreeSlots(doctorId: number, dateISO: string): Promise<string[]> {
  const day = istWeekday(dateISO);
  const avail = await prisma.doctorAvailability.findFirst({ where: { doctorId, day } });
  if (!avail?.availableFrom?.includes('-')) return [];
  const [start, end] = avail.availableFrom.split('-');
  const step = avail.slotDuration || 20;
  const toMin = (s: string) => { const [h, m] = s.trim().split(':').map(Number); return h * 60 + m; };
  const startMin = toMin(start);
  const endMin = toMin(end);
  const all: string[] = [];
  for (let cur = startMin; cur < endMin; cur += step) all.push(fmtSlot(cur));

  const [booked, appts, unav] = await Promise.all([
    prisma.bookedSlot.findMany({ where: { doctorId, date: dateISO, complete: false }, select: { time: true } }),
    prisma.appointment.findMany({ where: { doctorId, date: dateISO, status: { in: ['pending', 'confirmed'] } }, select: { time: true } }),
    prisma.unavailableSlot.findMany({ where: { doctorId, date: dateISO }, select: { time: true } }),
  ]);
  const taken = new Set([...booked, ...appts, ...unav].map((x) => (x.time ?? '').trim()));
  let free = all.filter((s) => !taken.has(s));

  if (istYmd() === dateISO) {
    const nowIst = moment().tz(TZ);
    const nowMin = nowIst.hours() * 60 + nowIst.minutes();
    free = free.filter((s) => slotToMin(s) > nowMin);
  }
  return free;
}

/** Next bookable dates (IST) within 21 days: doctor's weekdays minus leave/unavailable. */
export async function availableDates(doctorId: number, count = 7): Promise<{ date: string; label: string }[]> {
  const avails = await prisma.doctorAvailability.findMany({ where: { doctorId }, select: { day: true } });
  const days = new Set(avails.map((a) => (a.day ?? '').toLowerCase()).filter(Boolean));
  const since = moment().tz(TZ).startOf('day').toDate();
  const horizon = moment().tz(TZ).add(21, 'days').endOf('day').toDate();
  const [unav, leave] = await Promise.all([
    prisma.unavailableDates.findMany({ where: { doctorId, date: { gte: since, lte: horizon } }, select: { date: true } }),
    prisma.leaveDates.findMany({ where: { doctorId, date: { gte: since, lte: horizon } }, select: { date: true } }),
  ]);
  const blocked = new Set([...unav, ...leave].map((x) => istYmd(x.date)));
  const out: { date: string; label: string }[] = [];
  for (let i = 0; i < 21 && out.length < count; i++) {
    const m = moment().tz(TZ).add(i, 'days');
    const ymd = m.format('YYYY-MM-DD');
    const wd = m.format('ddd').toLowerCase();
    if (days.size && !days.has(wd)) continue;
    if (blocked.has(ymd)) continue;
    out.push({ date: ymd, label: m.format('ddd, DD MMM') });
  }
  return out;
}

/** Patients registered on this number plus their upcoming (pending/confirmed) appointments. */
export async function findPatientsByPhone(phone: string) {
  const digits = last10(phone);
  if (digits.length !== 10) return { patients: [], upcomingAppointments: [] };
  const [patients, upcoming] = await Promise.all([
    prisma.patientDetails.findMany({
      where: { OR: [{ mobileNo: { endsWith: digits } }, { contactNo: { endsWith: digits } }] },
      select: { prn: true, name: true, age: true, gender: true },
      take: 10,
    }),
    prisma.appointment.findMany({
      where: { phoneNumber: { endsWith: digits }, status: { in: ['pending', 'confirmed'] }, date: { gte: istYmd() } },
      select: { id: true, patientName: true, doctorName: true, department: true, date: true, time: true, status: true },
      orderBy: { date: 'asc' },
      take: 10,
    }),
  ]);
  return { patients, upcomingAppointments: upcoming };
}

export class BookingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AppointmentRequestInput {
  patientName: string;
  phone: string;
  doctorId: number;
  date: string; // YYYY-MM-DD
  time: string; // hh:mm AM/PM
  age?: number | string;
  gender?: string;
  prn?: number;
  type?: 'new' | 'followup';
  reason?: string;
  channel?: string; // 'voice' | 'chat'
  sessionId?: string;
}

/** Create a pending appointment request (same semantics as the WhatsApp bot). */
export async function createAppointmentRequest(input: AppointmentRequestInput) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: input.doctorId },
    select: { id: true, name: true, departmentName: true, isActive: true },
  });
  if (!doctor || doctor.isActive === false) throw new BookingError(404, 'Doctor not found');

  // Never request a slot that is already taken/unavailable (no hold is placed).
  const free = await getFreeSlots(doctor.id, input.date);
  if (!free.includes(input.time)) throw new BookingError(409, 'Slot is not available');

  const isFollowup = input.type === 'followup';
  const appt = await prisma.appointment.create({
    data: {
      patientName: input.patientName,
      phoneNumber: last10(input.phone),
      email: '',
      doctorId: doctor.id,
      doctorName: doctor.name,
      department: doctor.departmentName,
      date: input.date,
      time: input.time,
      status: 'pending',
      requestVia: SOURCE,
      type: isFollowup ? 'followup' : 'new',
      isNew: !isFollowup,
      isfollowup: isFollowup,
      prnNumber: input.prn ?? undefined,
      age: input.age != null ? String(input.age) : undefined,
      gender: input.gender ?? undefined,
    },
  });

  await recordAppointmentEventSystem({
    appointmentId: appt.id,
    eventType: 'REQUESTED',
    to: slotSnapshot(appt),
    subject: subjectSnapshot(appt),
    actorType: 'bot',
    actorName: `${SOURCE}:${last10(input.phone)}`,
    source: SOURCE,
    payload: { channel: input.channel ?? 'voice', sessionId: input.sessionId ?? null, reason: input.reason ?? null },
  });

  await prisma.notification
    .create({
      data: {
        type: 'ai_receptionist_appointment',
        title: 'New AI receptionist appointment request',
        message: `${input.patientName} requested a ${isFollowup ? 'follow-up' : 'new visit'} with ${doctor.name} on ${input.date} ${input.time}`.slice(0, MSG_MAX),
        status: 'unread',
        entityId: appt.id,
        entityType: 'Appointment',
        targetRole: 'admin',
      },
    })
    .catch((e) => console.warn('[ai-receptionist] appt notify failed:', (e as Error).message));

  return appt;
}

export interface EnquiryInput {
  name: string;
  phone: string;
  category: string;
  summary: string;
  priority?: 'normal' | 'urgent';
  sessionId?: string;
  language?: string;
}

/** Callback/enquiry for staff (lands in the existing CallbackRequest list). */
export async function createEnquiry(input: EnquiryInput) {
  const pageName = `AI Receptionist - ${input.category}`;
  const cb = await prisma.callbackRequest.create({
    data: {
      name: input.name,
      mobile: last10(input.phone),
      pageName,
      notes: {
        summary: input.summary,
        priority: input.priority ?? 'normal',
        sessionId: input.sessionId ?? null,
        language: input.language ?? null,
      },
    },
  });
  await prisma.notification
    .create({
      data: {
        type: 'ai_receptionist_enquiry',
        title: input.priority === 'urgent' ? `URGENT: ${pageName}` : pageName,
        message: `${input.name} (${last10(input.phone)}): ${input.summary}`.slice(0, MSG_MAX),
        status: 'unread',
        entityId: cb.id,
        entityType: 'CallbackRequest',
        targetRole: 'admin',
      },
    })
    .catch((e) => console.warn('[ai-receptionist] enquiry notify failed:', (e as Error).message));
  return cb;
}

export interface EscalationInput {
  phone: string;
  name?: string;
  reason: string;
  emergency: boolean;
  summary?: string;
  sessionId?: string;
}

/** Alert staff that the agent escalated (emergency or human requested). */
export async function createEscalationAlert(input: EscalationInput) {
  return prisma.notification.create({
    data: {
      type: input.emergency ? 'ai_receptionist_emergency' : 'ai_receptionist_escalation',
      title: input.emergency ? 'EMERGENCY flagged by AI receptionist' : 'AI receptionist: caller needs a human',
      message: `${input.name ?? 'Caller'} (${last10(input.phone)}): ${input.reason}${input.summary ? ` — ${input.summary}` : ''}`.slice(0, MSG_MAX),
      status: 'unread',
      isCritical: input.emergency,
      targetRole: 'admin',
    },
  });
}
