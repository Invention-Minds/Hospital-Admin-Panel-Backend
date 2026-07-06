import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../service/prisma-client';
import { sendText, sendList, sendButtons, downloadMedia, markReadAndTyping } from '../../service/gobuzz.service';
import { openai } from '../../config/openai';
import { generateOtp, otpExpiry, sendOtpSms } from '../../service/otp-sms.service';
import { createComplaintRecord } from '../feedback/complaint.controller';
import moment from 'moment-timezone';

const TZ = 'Asia/Kolkata';
const istYmd = (d?: Date | string): string => moment(d).tz(TZ).format('YYYY-MM-DD');
const istWeekday = (ymd: string): string => moment.tz(ymd, 'YYYY-MM-DD', TZ).format('ddd').toLowerCase();

// ─── Patient ↔ Doctor WhatsApp bot ─────────────────────────────────────────
//
// Inbound webhook registered with GoBuzz as:
//   POST /api/callback/<GOBUZZ_WEBHOOK_KEY>/<wabanumber>
// The :apiKey path segment is a shared secret validated below.
//
// Flow (state machine, persisted in WhatsappBotSession):
//   (new)            → greet + ask PRN                       → AWAITING_PRN
//   AWAITING_PRN     → verify Patient.prn, list their docs   → AWAITING_DOCTOR
//   AWAITING_DOCTOR  → validate doctor pick, ask question    → AWAITING_QUESTION
//   AWAITING_QUESTION→ create WhatsappQuery, notify doctor   → IN_CONVERSATION
//   IN_CONVERSATION  → append follow-ups to the open query (or restart)
//
// The doctor reads/answers in the Hospital Admin Panel (see whatsapp-query.*).

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h customer-service window
const RESTART_WORDS = new Set(['hi', 'hello', 'menu', 'start', 'restart', 'hey', 'stop', 'cancel', 'exit', 'end', 'quit', 'bye', 'close', 'back']);

// Exit/restart intent → back to main menu. Matches exact keywords plus short
// phrases like "stop", "no stop this", "main menu", "go back".
function isExitIntent(t?: string): boolean {
  const s = (t ?? '').trim().toLowerCase();
  if (!s) return false;
  if (RESTART_WORDS.has(s)) return true;
  return /^(no\s+)?(stop|cancel|exit|quit|end|close|menu|main\s*menu|back|go\s*back|start\s*over)(\s+(this|it|chat|now|please|here))?$/.test(s);
}

// Helpline shown on misuse / off-topic / repeated failures.
const HELPLINE = process.env.WHATSAPP_HELPLINE_NUMBER || '+91 80 0000 0000';
const MAX_PRN_ATTEMPTS = 5;        // wrong PRNs before we stop and show helpline
const MAX_QUERIES_PER_DAY = 5;     // new queries per phone per day

// Hospital / emergency details (env-driven).
const HOSPITAL_NAME = process.env.HOSPITAL_NAME || 'our hospital';
const HOSPITAL_ADDRESS = process.env.HOSPITAL_ADDRESS || '';
const HOSPITAL_MAP = process.env.HOSPITAL_GOOGLE_MAP || '';
const EMERGENCY_NUMBER = process.env.HOSPITAL_EMERGENCY_NUMBER || HELPLINE;

// Media retention notice (deletion handled by the cleanup cron).
const MEDIA_RETENTION_DAYS = Number(process.env.WHATSAPP_MEDIA_RETENTION_DAYS) || 5;
const MEDIA_NOTE = `Note: documents/images you send are securely stored for follow-up only and are automatically deleted after ${MEDIA_RETENTION_DAYS} days. If needed later, please send them again.`;

// Doorstep services — free radius from the hospital.
const HOSPITAL_LAT = process.env.HOSPITAL_LAT ? Number(process.env.HOSPITAL_LAT) : null;
const HOSPITAL_LNG = process.env.HOSPITAL_LNG ? Number(process.env.HOSPITAL_LNG) : null;
const DOORSTEP_FREE_RADIUS_KM = Number(process.env.DOORSTEP_FREE_RADIUS_KM) || 5;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type InboundMedia = { id: string; type: string; mime?: string; filename?: string };
type InboundLocation = { lat: number; lng: number };
type Inbound = { from: string; text?: string; replyId?: string; media?: InboundMedia; location?: InboundLocation };

const MEDIA_TYPES = ['image', 'document', 'video', 'audio'];

function parseInbound(body: any): Inbound | null {
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.from) return null;
  if (msg.type === 'text') {
    return { from: msg.from, text: (msg.text?.body ?? '').trim() };
  }
  if (msg.type === 'interactive') {
    const ir = msg.interactive;
    if (ir?.type === 'button_reply') {
      return { from: msg.from, replyId: ir.button_reply?.id, text: ir.button_reply?.title };
    }
    if (ir?.type === 'list_reply') {
      return { from: msg.from, replyId: ir.list_reply?.id, text: ir.list_reply?.title };
    }
  }
  if (msg.type === 'location' && msg.location) {
    return { from: msg.from, location: { lat: Number(msg.location.latitude), lng: Number(msg.location.longitude) } };
  }
  if (MEDIA_TYPES.includes(msg.type)) {
    const m = msg[msg.type]; // msg.image | msg.document | msg.video | msg.audio
    if (m?.id) {
      const caption = (m.caption ?? '').trim();
      return {
        from: msg.from,
        text: caption || undefined,
        media: { id: m.id, type: msg.type, mime: m.mime_type, filename: m.filename },
      };
    }
  }
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
};

function pickExt(mime?: string, filename?: string): string {
  if (filename && filename.includes('.')) return filename.slice(filename.lastIndexOf('.'));
  return (mime && EXT_BY_MIME[mime]) || '';
}

function mediaPlaceholder(media: InboundMedia): string {
  if (media.type === 'document') return `Document: ${media.filename ?? 'document'}`;
  if (media.type === 'image') return 'Image';
  return `Attachment (${media.type})`;
}

// Download from WhatsApp and persist under /files/whatsapp (local disk, same
// pattern as estimation PDFs). Returns the fields to store on the message.
type StoredMedia = { mediaUrl: string; mediaType: string; mediaMime?: string; fileName?: string };

async function ingestMedia(media: InboundMedia): Promise<StoredMedia | null> {
  const dl = await downloadMedia(media.id);
  if (!dl) return null;
  const storageDir = process.env.PDF_STORAGE_DIR || '/var/www/docminds/pdfs';
  const dir = path.join(storageDir, 'whatsapp');
  fs.mkdirSync(dir, { recursive: true });
  const mime = media.mime ?? dl.mime;
  const fileName = `${media.id}${pickExt(mime, media.filename)}`;
  fs.writeFileSync(path.join(dir, fileName), dl.buffer);
  return {
    mediaUrl: `/files/whatsapp/${fileName}`,
    mediaType: media.type,
    mediaMime: mime,
    fileName: media.filename ?? fileName,
  };
}

// Abuse guard: number of queries this phone has already opened today.
async function queriesToday(phone: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.whatsappQuery.count({ where: { patientPhone: phone, created_at: { gte: start } } });
}

// Distinct doctors who have consulted this PRN (own field or via patient relation).
async function doctorsForPrn(prn: number) {
  const appts = await prisma.appointment.findMany({
    where: { OR: [{ prnNumber: prn }, { patient: { prn } }], doctorId: { not: null } },
    select: { doctorId: true, doctorName: true },
    orderBy: { created_at: 'desc' },
  });
  const seen = new Map<number, string>();
  for (const a of appts) if (a.doctorId != null && !seen.has(a.doctorId)) seen.set(a.doctorId, a.doctorName);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

async function notifyDoctor(doctorId: number, queryId: number, prn: number, who: string, question: string) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { userId: true } });
  await prisma.notification
    .create({
      data: {
        type: 'whatsapp_query',
        title: 'New WhatsApp patient query',
        message: `${who} (PRN ${prn}): "${question.slice(0, 140)}"`,
        status: 'unread',
        userId: doctor?.userId ?? undefined,
        entityId: queryId,
        entityType: 'WhatsappQuery',
        targetRole: 'doctor',
      },
    })
    .catch((e) => console.warn('[whatsapp-bot] notify failed:', (e as Error).message));
}

// ── Menus ──────────────────────────────────────────────────────────────────
async function sendMainMenu(to: string, greet = true): Promise<void> {
  await sendList(
    to,
    'DocMinds Services',
    `${greet ? `Hello, and a warm welcome to ${HOSPITAL_NAME}! I'm your virtual assistant.\n` : ''}How can we help you today?`,
    'Main menu',
    [
      { id: 'APPT', title: 'Doctor Appointment' },
      { id: 'DOORSTEP', title: 'Doorstep Services' },
      { id: 'EMERGENCY', title: 'Emergency' },
      { id: 'ENQUIRY', title: 'Enquiry' },
      { id: 'OTHERS', title: 'Others' },
    ],
  );
}

async function sendEnquiryMenu(to: string): Promise<void> {
  await sendList(to, 'Enquiry', 'What is your enquiry about?', 'Choose', [
    { id: 'ENQ_REPORT', title: 'Report follow-up' },
    { id: 'ENQ_SURGERY', title: 'Surgery estimation' },
    { id: 'ENQ_INSURANCE', title: 'Insurance enquiry' },
    { id: 'ENQ_COMPLAINT', title: 'Raise a complaint' },
  ]);
}

async function sendEmergency(to: string): Promise<void> {
  let msg = `For emergencies, please call ${HOSPITAL_NAME} immediately:\nPhone: ${EMERGENCY_NUMBER}`;
  if (HOSPITAL_ADDRESS) msg += `\nAddress: ${HOSPITAL_ADDRESS}`;
  if (HOSPITAL_MAP) msg += `\nLocation: ${HOSPITAL_MAP}`;
  msg += `\n\nReply "menu" for other options.`;
  await sendText(to, msg);
}

// Map a reply-button/list id or typed text to a menu choice id.
function pickChoice(replyId: string | undefined, text: string | undefined, map: Record<string, string>): string | null {
  if (replyId && map[replyId.toUpperCase()] !== undefined) return replyId.toUpperCase();
  if (replyId && Object.values(map).includes(replyId)) return replyId; // id passed directly
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return null;
  return map[t] ?? null;
}

const MAIN_MENU_MAP: Record<string, string> = {
  '1': 'APPT', appointment: 'APPT', doctor: 'APPT', appt: 'APPT',
  '2': 'DOORSTEP', doorstep: 'DOORSTEP', home: 'DOORSTEP',
  '3': 'EMERGENCY', emergency: 'EMERGENCY',
  '4': 'ENQUIRY', enquiry: 'ENQUIRY', enquire: 'ENQUIRY', inquiry: 'ENQUIRY',
  '5': 'OTHERS', other: 'OTHERS', others: 'OTHERS',
  APPT: 'APPT', DOORSTEP: 'DOORSTEP', EMERGENCY: 'EMERGENCY', ENQUIRY: 'ENQUIRY', OTHERS: 'OTHERS',
};
const ENQUIRY_MENU_MAP: Record<string, string> = {
  '1': 'ENQ_REPORT', report: 'ENQ_REPORT',
  '2': 'ENQ_SURGERY', surgery: 'ENQ_SURGERY', estimation: 'ENQ_SURGERY',
  '3': 'ENQ_INSURANCE', insurance: 'ENQ_INSURANCE',
  '4': 'ENQ_COMPLAINT', complaint: 'ENQ_COMPLAINT',
  ENQ_REPORT: 'ENQ_REPORT', ENQ_SURGERY: 'ENQ_SURGERY', ENQ_INSURANCE: 'ENQ_INSURANCE', ENQ_COMPLAINT: 'ENQ_COMPLAINT',
};

// ── Scratch (per-flow field collection) ─────────────────────────────────────
function readScratch(s: { scratch: string | null }): any {
  try { return s.scratch ? JSON.parse(s.scratch) : {}; } catch { return {}; }
}
async function mergeScratch(from: string, s: { scratch: string | null }, patch: Record<string, unknown>): Promise<any> {
  const next = { ...readScratch(s), ...patch };
  await prisma.whatsappBotSession.update({ where: { phone: from }, data: { scratch: JSON.stringify(next) } });
  return next;
}

// ── Generic OTP + consent (shared by all data-collecting flows) ─────────────
const CONSENT_TEXT =
  'Do you agree to share your personal information with the hospital and its authorized partners to provide the requested healthcare service and related support?';

const OTP_SERVICE_LABEL: Record<string, string> = {
  APPT: 'Doctor Appointment', REPORT: 'Report Followup', DOORSTEP: 'Doorstep Service',
  ENQ_SURGERY: 'Surgery Estimation', ENQ_INSURANCE: 'Insurance Enquiry', ENQ_COMPLAINT: 'Complaint', OTHERS: 'Enquiry',
};

async function startOtp(from: string, name: string, flow: string): Promise<void> {
  const otp = generateOtp();
  await prisma.whatsappBotSession.update({
    where: { phone: from },
    data: { state: 'OTP', otpCode: otp, otpExpiresAt: otpExpiry() },
  });
  const ok = await sendOtpSms(from, name || 'Patient', otp, OTP_SERVICE_LABEL[flow] || 'Service');
  await sendText(
    from,
    ok
      ? 'We have sent a 6-digit OTP to your number. Enter it to continue (valid 2 minutes). Reply "resend" for a new code.'
      : `We couldn't send the OTP right now. Please try again later or call ${HELPLINE}.`,
  );
}

async function askConsent(from: string): Promise<void> {
  await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'CONSENT' } });
  await sendButtons(from, CONSENT_TEXT, [
    { id: 'CONSENT_YES', title: 'I Agree' },
    { id: 'CONSENT_NO', title: 'I Do Not Agree' },
  ]);
}

// ── Appointment helpers ─────────────────────────────────────────────────────
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

// Free slots for a doctor on a YYYY-MM-DD date, in "hh:mm AM/PM" (same format as
// the booking UI), minus booked/confirmed/pending/unavailable; future-only today.
async function getFreeSlots(doctorId: number, dateISO: string): Promise<string[]> {
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
  return free.slice(0, 30); // paginated 9/page downstream
}

// Next bookable dates for a doctor (IST): only weekdays they're available, and
// excluding their leave / unavailable dates. Scans up to 21 days, returns `count`.
async function availableDates(doctorId: number, count = 7): Promise<{ id: string; title: string }[]> {
  const avails = await prisma.doctorAvailability.findMany({ where: { doctorId }, select: { day: true } });
  const days = new Set(avails.map((a) => (a.day ?? '').toLowerCase()).filter(Boolean));
  const since = moment().tz(TZ).startOf('day').toDate();
  const horizon = moment().tz(TZ).add(21, 'days').endOf('day').toDate();
  const [unav, leave] = await Promise.all([
    prisma.unavailableDates.findMany({ where: { doctorId, date: { gte: since, lte: horizon } }, select: { date: true } }),
    prisma.leaveDates.findMany({ where: { doctorId, date: { gte: since, lte: horizon } }, select: { date: true } }),
  ]);
  const blocked = new Set([...unav, ...leave].map((x) => istYmd(x.date)));
  const out: { id: string; title: string }[] = [];
  for (let i = 0; i < 21 && out.length < count; i++) {
    const m = moment().tz(TZ).add(i, 'days');
    const ymd = m.format('YYYY-MM-DD');
    const wd = m.format('ddd').toLowerCase();
    if (days.size && !days.has(wd)) continue; // doctor not available that weekday
    if (blocked.has(ymd)) continue; // leave / unavailable
    out.push({ id: ymd, title: m.format('ddd, DD MMM') });
  }
  return out;
}

// Paginated list. If everything fits (≤9) show it plainly. Otherwise page by 8
// and add "« Previous" (id PREV) / "Show more »" (id MORE) nav rows — 8 + 2 nav
// = WhatsApp's 10-row max. Item ids are stable, so selection works on any page.
const PAGE_SIZE = 8;
type ListItem = { id: string; title: string; description?: string };
async function sendPagedList(from: string, header: string, body: string, button: string, items: ListItem[], page: number): Promise<void> {
  const toRow = (it: ListItem): ListItem => ({ id: it.id, title: it.title, ...(it.description ? { description: it.description } : {}) });
  if (items.length <= 9) { await sendList(from, header, body, button, items.slice(0, 9).map(toRow)); return; }
  const start = page * PAGE_SIZE;
  const rows: ListItem[] = items.slice(start, start + PAGE_SIZE).map(toRow);
  if (page > 0) rows.unshift({ id: 'PREV', title: '« Previous' });
  if (start + PAGE_SIZE < items.length) rows.push({ id: 'MORE', title: 'Show more »' });
  await sendList(from, header, body, button, rows);
}

async function listDepartments() {
  return prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}
async function listDoctorsByDept(departmentId: number) {
  return prisma.doctor.findMany({ where: { departmentId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}
async function sendDepartments(from: string, page = 0): Promise<void> {
  const deps = await listDepartments();
  if (!deps.length) { await sendText(from, `No departments are configured. Please call ${HELPLINE}.`); return; }
  const items: ListItem[] = [{ id: 'DEPT_HELP', title: 'Not sure / Help me choose' }, ...deps.map((d) => ({ id: `DEP_${d.id}`, title: d.name }))];
  await sendPagedList(from, 'Select department', 'Choose the department, or let us suggest one.', 'Departments', items, page);
}
async function sendDoctorsForDept(from: string, departmentId: number, page = 0): Promise<void> {
  const docs = await listDoctorsByDept(departmentId);
  if (!docs.length) { await sendText(from, 'No doctors are available in that department right now. Reply "menu".'); return; }
  await sendPagedList(from, 'Select doctor', 'Choose your doctor.', 'Doctors', docs.map((d) => ({ id: `DOC_${d.id}`, title: d.name })), page);
}
async function sendDateOptions(from: string, doctorId: number): Promise<void> {
  const dates = await availableDates(doctorId);
  if (!dates.length) { await sendText(from, `No available dates for this doctor in the next few weeks. Please call ${HELPLINE}.`); return; }
  await sendList(from, 'Select date', 'Choose a preferred date.', 'Dates', dates.map((d) => ({ id: `DATE_${d.id}`, title: d.title })));
}
function slotItems(slots: string[]): ListItem[] {
  return slots.map((s, i) => ({ id: `SLOT_${i}`, title: s }));
}

// ── "Help me choose" — symptom-based department suggestion (text or voice) ───
const LANGS: { id: string; title: string; code: string }[] = [
  { id: 'LANG_en', title: 'English', code: 'en' },
  { id: 'LANG_kn', title: 'Kannada', code: 'kn' },
  { id: 'LANG_hi', title: 'Hindi', code: 'hi' },
  { id: 'LANG_ml', title: 'Malayalam', code: 'ml' },
  { id: 'LANG_ta', title: 'Tamil', code: 'ta' },
  { id: 'LANG_te', title: 'Telugu', code: 'te' },
];
async function sendLangList(from: string): Promise<void> {
  await sendList(from, 'Select language', 'Choose the language you’ll describe your problem in.', 'Languages', LANGS.map((l) => ({ id: l.id, title: l.title })));
}

function matchMenuKeywords(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const emergencyKeywords = ['emergency', 'ambulance', 'accident', 'critical', 'bleeding', 'heart attack', 'chest pain'];
  if (emergencyKeywords.some(kw => text.includes(kw))) {
    return 'EMERGENCY';
  }

  const apptKeywords = [
    'pain', 'stomach', 'fever', 'cough', 'headache', 'vomit', 'cold', 'flu',
    'consult', 'doctor', 'appointment', 'booking', 'checkup', 'ill', 'sick', 'symptom'
  ];
  if (apptKeywords.some(kw => text.includes(kw))) {
    return 'APPT';
  }

  const doorstepKeywords = ['medicine', 'pharmacy', 'delivery', 'lab', 'test', 'pickup', 'sample', 'home care', 'doorstep'];
  if (doorstepKeywords.some(kw => text.includes(kw))) {
    return 'DOORSTEP';
  }

  const enquiryKeywords = ['insurance', 'bill', 'cost', 'price', 'complaint', 'report', 'enquiry', 'inquiry'];
  if (enquiryKeywords.some(kw => text.includes(kw))) {
    return 'ENQUIRY';
  }

  return `I couldn't understand your request. Can you please elaborate?`;
}

// Pick the best department for described symptoms (must be one of ours).
async function suggestDepartment(symptoms: string): Promise<{ id: number; name: string } | null> {
  const deps = await listDepartments();
  if (!deps.length || !process.env.OPENAI_API_KEY) return null;
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 20,
      messages: [
        { role: 'system', content: `You are a hospital triage assistant. From this department list, reply with EXACTLY one department name that best fits the patient's symptoms, nothing else. Departments: ${deps.map((d) => d.name).join(', ')}.` },
        { role: 'user', content: symptoms.slice(0, 800) },
      ],
    });
    const ans = (r.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
    return deps.find((d) => d.name.toLowerCase() === ans) || deps.find((d) => ans.includes(d.name.toLowerCase())) || null;
  } catch (e) {
    console.warn('[whatsapp-bot] dept suggest failed:', (e as Error).message);
    return null;
  }
}

// Classify free-typed text into a top-level intent so we can route without a menu tap.
const INTENTS = ['APPT', 'DOORSTEP', 'EMERGENCY', 'ENQ_REPORT', 'ENQ_SURGERY', 'ENQ_INSURANCE', 'ENQ_COMPLAINT', 'OTHERS', 'GREETING', 'UNKNOWN'];
async function classifyIntent(text: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return 'UNKNOWN';
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 8,
      messages: [
        {
          role: 'system',
          content: `Classify the patient's WhatsApp message into ONE code; reply with only the code.
APPT = book/reschedule a doctor appointment, consult, see/meet a doctor, follow-up visit
DOORSTEP = home lab sample collection, or medicine/pharmacy home delivery
EMERGENCY = medical emergency, urgent help, ambulance
ENQ_REPORT = questions or clarification about their lab/investigation/test/scan report or results
ENQ_SURGERY = surgery cost / estimate / procedure enquiry
ENQ_INSURANCE = insurance / cashless / mediclaim enquiry
ENQ_COMPLAINT = complaint / grievance / dissatisfaction
OTHERS = a specific request fitting none of the above
GREETING = greeting, thanks, or small talk with no request
UNKNOWN = unclear`,
        },
        { role: 'user', content: text.slice(0, 400) },
      ],
    });
    const code = (r.choices?.[0]?.message?.content ?? '').trim().toUpperCase().replace(/[^A-Z_]/g, '');
    return INTENTS.includes(code) ? code : 'UNKNOWN';
  } catch (e) {
    console.warn('[whatsapp-bot] intent classify failed:', (e as Error).message);
    return 'UNKNOWN';
  }
}

// Transcribe a downloaded voice note in the patient's chosen language.
async function transcribeAudio(buffer: Buffer, langCode: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const dir = path.join(process.env.PDF_STORAGE_DIR || '/var/www/docminds/pdfs', 'whatsapp-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `voice-${Date.now()}.ogg`);
  fs.writeFileSync(tmp, buffer);
  try {
    const t = await openai.audio.transcriptions.create({ file: fs.createReadStream(tmp), language: langCode, model: 'gpt-4o-mini-transcribe' });
    return (t as { text?: string }).text ?? '';
  } catch (e) {
    console.warn('[whatsapp-bot] transcribe failed:', (e as Error).message);
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// Suggest a department from symptoms and move to doctor selection. Falls back to
// the full department list if nothing matched or the suggested dept has no doctors.
async function proceedWithSymptoms(from: string, symptoms: string): Promise<void> {
  const dept = await suggestDepartment(symptoms);
  const s = await prisma.whatsappBotSession.findUnique({ where: { phone: from } });
  if (!s) return;
  const docs = dept ? await listDoctorsByDept(dept.id) : [];
  if (!dept || !docs.length) {
    await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DEPT' } });
    await sendText(from, dept
      ? `The suggested ${dept.name} department has no doctors available for booking right now. Please choose another:`
      : 'I couldn’t auto-detect a department. Please choose one:');
    await sendDepartments(from, 0);
    return;
  }
  await mergeScratch(from, s, { departmentId: dept.id, department: dept.name, _docPage: 0 });
  await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DOCTOR' } });
  await sendText(from, `Based on what you described, we suggest the *${dept.name}* department. Please choose a doctor:`);
  await sendDoctorsForDept(from, dept.id, 0);
}

// Free follow-up eligibility = doctor(s) this PRN completed a visit with in the
// last 7 days. Empty array → not eligible. Follow-ups are only with these doctors.
async function recentVisitDoctors(prn: number): Promise<{ id: number; name: string; department: string }[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const appts = await prisma.appointment.findMany({
    where: { prnNumber: prn, status: 'completed', created_at: { gte: since }, doctorId: { not: null } },
    select: { doctorId: true, doctorName: true, department: true },
    orderBy: { created_at: 'desc' },
  });
  const seen = new Map<number, { name: string; department: string }>();
  for (const a of appts) if (a.doctorId != null && !seen.has(a.doctorId)) seen.set(a.doctorId, { name: a.doctorName, department: a.department });
  return [...seen.entries()].map(([id, v]) => ({ id, name: v.name, department: v.department }));
}

async function finalizeFlow(from: string, session: { flow: string | null; scratch: string | null }, now: Date): Promise<void> {
  const sc = readScratch(session);
  if (session.flow === 'APPT') {
    const appt = await prisma.appointment.create({
      data: {
        patientName: sc.name ?? 'WhatsApp Patient',
        phoneNumber: from,
        email: '',
        doctorId: sc.doctorId,
        doctorName: sc.doctorName ?? '',
        department: sc.department ?? '',
        date: sc.date,
        time: sc.slot,
        status: 'pending',
        requestVia: 'whatsapp',
        type: sc.type === 'followup' ? 'followup' : 'new',
        isNew: sc.type !== 'followup',
        isfollowup: sc.type === 'followup',
        prnNumber: sc.prn ?? undefined,
      },
    });
    await prisma.notification
      .create({
        data: {
          type: 'whatsapp_appointment',
          title: 'New WhatsApp appointment request',
          message: `${sc.name} requested a ${sc.type === 'followup' ? 'free follow-up' : 'new visit'} with ${sc.doctorName} on ${sc.date} ${sc.slot}`,
          status: 'unread',
          entityId: appt.id,
          entityType: 'Appointment',
          targetRole: 'admin',
        },
      })
      .catch((e) => console.warn('[whatsapp-bot] appt notify failed:', (e as Error).message));
    await finishWithThanks(
      from,
      `Thank you, ${sc.name}. Your ${sc.type === 'followup' ? 'free follow-up' : 'appointment'} request with ${sc.doctorName} on ${sc.date} at ${sc.slot} is received and is PENDING. Our teleconsultation team will call you shortly to confirm.`,
    );
    return;
  }
  if (session.flow === 'REPORT') {
    const created = await prisma.whatsappQuery.create({
      data: {
        refNo: `TMP-${Date.now()}`,
        patientPhone: from,
        prn: sc.prn,
        patientName: sc.name ?? null,
        doctorId: sc.doctorId,
        doctorName: sc.doctorName ?? '',
        status: 'open',
        lastPatientMsgAt: now,
        messages: { create: { direction: 'IN', body: sc.bodyText ?? '', sender: sc.name ?? from, ...(sc.media ?? {}) } },
      },
    });
    const refNo = `Q-${10000 + created.id}`;
    await prisma.whatsappQuery.update({ where: { id: created.id }, data: { refNo } });
    await prisma.whatsappBotSession.update({
      where: { phone: from },
      data: { state: 'IN_CONVERSATION', flow: null, activeQueryId: created.id, scratch: null },
    });
    await notifyDoctor(sc.doctorId, created.id, sc.prn, sc.name ?? from, sc.bodyText ?? '');
    await sendText(
      from,
      `Your ${sc.hadMedia ? 'report' : 'question'} has been sent to ${sc.doctorName}. You’ll get the reply here on WhatsApp.\nReference: *${refNo}*${sc.hadMedia ? `\n\n${MEDIA_NOTE}` : ''}`,
    );
    return;
  }

  if (session.flow === 'DOORSTEP') {
    const serviceLabel = sc.serviceType === 'PHARMACY_DELIVERY' ? 'pharmacy delivery' : 'lab sample pickup';
    const created = await prisma.doorstepRequest.create({
      data: {
        refNo: `DS-${Date.now()}`,
        patientPhone: from,
        prn: sc.prn ?? undefined,
        patientName: sc.name ?? 'WhatsApp Patient',
        serviceType: sc.serviceType === 'PHARMACY_DELIVERY' ? 'PHARMACY_DELIVERY' : 'LAB_PICKUP',
        address: sc.address ?? '',
        details: sc.details ?? null,
        lat: sc.lat ?? null,
        lng: sc.lng ?? null,
        distanceKm: sc.distanceKm ?? null,
        withinFreeRadius: typeof sc.withinFreeRadius === 'boolean' ? sc.withinFreeRadius : null,
        status: 'pending',
        consentAt: now,
      },
    });
    const refNo = `DS-${10000 + created.id}`;
    await prisma.doorstepRequest.update({ where: { id: created.id }, data: { refNo } });
    await prisma.notification
      .create({
        data: {
          type: 'whatsapp_doorstep',
          title: 'New doorstep service request',
          message: `${sc.name} requested ${serviceLabel} — ${(sc.address ?? '').slice(0, 120)}`,
          status: 'unread',
          entityId: created.id,
          entityType: 'DoorstepRequest',
          targetRole: 'admin',
        },
      })
      .catch((e) => console.warn('[whatsapp-bot] doorstep notify failed:', (e as Error).message));
    let charge: string;
    if (sc.withinFreeRadius === true) charge = `You are within ${DOORSTEP_FREE_RADIUS_KM} km — this service is free.`;
    else if (sc.withinFreeRadius === false) charge = `You appear to be beyond ${DOORSTEP_FREE_RADIUS_KM} km, so a delivery charge may apply — our team will confirm.`;
    else charge = 'Our team will confirm any applicable charges.';
    await finishWithThanks(
      from,
      `Thank you, ${sc.name}. Your ${serviceLabel} request (${refNo}) is received and is PENDING. ${charge} Our team will call you shortly to arrange it.`,
    );
    return;
  }

  if (session.flow === 'ENQ_SURGERY' || session.flow === 'ENQ_INSURANCE' || session.flow === 'OTHERS') {
    const isSurgery = session.flow === 'ENQ_SURGERY';
    const isInsurance = session.flow === 'ENQ_INSURANCE';
    const pageName = isSurgery ? 'WhatsApp - Surgery Estimation' : isInsurance ? 'WhatsApp - Insurance Enquiry' : 'WhatsApp - Others';
    const notes: Record<string, string> = {};
    if (sc.procedure) notes.procedure = sc.procedure;
    if (sc.insurance) notes.insurance = sc.insurance;
    if (sc.message) notes.message = sc.message;
    const cb = await prisma.callbackRequest.create({
      data: { name: sc.name ?? 'WhatsApp Patient', mobile: from, pageName, notes },
    });
    await prisma.notification
      .create({
        data: {
          type: 'whatsapp_enquiry',
          title: pageName,
          message: `${sc.name}: ${sc.procedure ?? sc.message ?? ''}${sc.insurance ? ` / ${sc.insurance}` : ''}`.slice(0, 200),
          status: 'unread',
          entityId: cb.id,
          entityType: 'CallbackRequest',
          targetRole: 'admin',
        },
      })
      .catch((e) => console.warn('[whatsapp-bot] enquiry notify failed:', (e as Error).message));
    await finishWithThanks(from, `Thank you, ${sc.name}. Your ${isSurgery ? 'surgery estimation' : isInsurance ? 'insurance' : ''} enquiry is received. Our team will call you back shortly.`);
    return;
  }

  if (session.flow === 'ENQ_COMPLAINT') {
    const c = await createComplaintRecord({
      description: sc.description ?? '',
      channel: 'whatsapp',
      patientPrn: sc.prn ? String(sc.prn) : null,
      patientName: sc.name ?? null,
    });
    await prisma.notification
      .create({
        data: {
          type: 'whatsapp_complaint',
          title: 'New WhatsApp complaint',
          message: `${sc.name} (${c.code}): ${(sc.description ?? '').slice(0, 150)}`,
          status: 'unread',
          entityType: 'Complaint',
          targetRole: 'admin',
        },
      })
      .catch((e) => console.warn('[whatsapp-bot] complaint notify failed:', (e as Error).message));
    await finishWithThanks(from, `Thank you, ${sc.name}. Your complaint (${c.code}) has been registered. Our team will follow up.`);
    return;
  }

  // Fallback.
  await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU', flow: null, scratch: null } });
  await sendText(from, 'Done. Reply "menu" for options.');
  void now;
}

// Start a flow for a resolved intent/menu id. Returns false if not a known flow.
async function startFlow(from: string, intent: string): Promise<boolean> {
  switch (intent) {
    case 'EMERGENCY':
      await sendEmergency(from); // stays in MENU
      return true;
    case 'APPT':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_TYPE', flow: 'APPT', scratch: null } });
      await sendButtons(from, 'Doctor Appointment — what would you like to book?', [{ id: 'NEW', title: 'New visit' }, { id: 'FOLLOWUP', title: 'Follow-up visit' }]);
      return true;
    case 'DOORSTEP':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_SERVICE', flow: 'DOORSTEP', scratch: null } });
      await sendButtons(from, 'Doorstep Services — what do you need?', [{ id: 'LAB_PICKUP', title: 'Lab sample pickup' }, { id: 'PHARMACY_DELIVERY', title: 'Pharmacy delivery' }]);
      return true;
    case 'ENQUIRY':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU_ENQUIRY' } });
      await sendEnquiryMenu(from);
      return true;
    case 'ENQ_REPORT':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'AWAITING_PRN', flow: 'REPORT', prn: null, doctorId: null, doctorName: null, activeQueryId: null, prnAttempts: 0, scratch: null } });
      await sendText(from, 'Report follow-up. Please reply with your *PRN* (Patient Registration Number).');
      return true;
    case 'ENQ_SURGERY':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_S_NAME', flow: 'ENQ_SURGERY', scratch: null } });
      await sendText(from, 'Surgery estimation enquiry. Please type your full name.');
      return true;
    case 'ENQ_INSURANCE':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_I_NAME', flow: 'ENQ_INSURANCE', scratch: null } });
      await sendText(from, 'Insurance enquiry. Please type your full name.');
      return true;
    case 'ENQ_COMPLAINT':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_C_NAME', flow: 'ENQ_COMPLAINT', scratch: null } });
      await sendText(from, 'Raise a complaint. Please type your full name.');
      return true;
    case 'OTHERS':
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'OTHERS_NAME', flow: 'OTHERS', scratch: null } });
      await sendText(from, 'Sure — please type your full name.');
      return true;
    default:
      return false;
  }
}

const GREET_WORDS = new Set(['hi', 'hello', 'hey', 'hii', 'helo', 'menu', 'start', 'thanks', 'thank you', 'ok', 'okay']);

// AI fallback: understand free-typed text and start the matching flow.
// Returns true if it routed to a flow.
async function routeFreeText(from: string, text?: string): Promise<boolean> {
  const t = (text ?? '').trim();
  if (!t || GREET_WORDS.has(t.toLowerCase())) return false;
  const intent = await classifyIntent(t);
  if (intent === 'GREETING' || intent === 'UNKNOWN') return false;
  return startFlow(from, intent);
}

// Finish a one-shot flow: confirm + thank, then offer to continue.
async function finishWithThanks(from: string, confirmation: string): Promise<void> {
  await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'POST_DONE', flow: null, scratch: null } });
  await sendText(from, confirmation);
  await sendButtons(from, 'Is there anything else we can help you with?', [
    { id: 'ELSE_YES', title: 'Yes, show menu' },
    { id: 'ELSE_NO', title: 'No, thank you' },
  ]);
}

export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  // Validate shared secret in the URL path.
  if (process.env.GOBUZZ_WEBHOOK_KEY && req.params.apiKey !== process.env.GOBUZZ_WEBHOOK_KEY) {
    res.status(401).send('unauthorized');
    return;
  }

  // Always 200 fast so GoBuzz doesn't retry; process best-effort.
  const inbound = parseInbound(req.body);
  res.status(200).send('ok');
  if (!inbound) return;

  // Mark read + show "typing…" while we work (concurrent, best-effort).
  const msgId = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
  if (msgId) markReadAndTyping(msgId).catch(() => {});

  try {
    await routeMessage(inbound);
  } catch (err) {
    console.error('[whatsapp-bot] error:', err);
    sendText(inbound.from, 'Sorry, something went wrong. Please type "hi" to start again.').catch(() => { });
  }
};

async function routeMessage({ from, text, replyId, media, location }: Inbound): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  let session = await prisma.whatsappBotSession.findUnique({ where: { phone: from } });

  // New or expired → show the main menu.
  if (!session || session.expiresAt < now) {
    session = await prisma.whatsappBotSession.upsert({
      where: { phone: from },
      create: { phone: from, state: 'MENU', lastInboundAt: now, expiresAt },
      update: { state: 'MENU', flow: null, prn: null, doctorId: null, doctorName: null, activeQueryId: null, prnAttempts: 0, scratch: null, otpCode: null, otpExpiresAt: null, consentAt: null, lastInboundAt: now, expiresAt },
    });
    await sendMainMenu(from, true);
    return;
  }

  await prisma.whatsappBotSession.update({ where: { phone: from }, data: { lastInboundAt: now, expiresAt } });

  // Global restart / stop shortcut → back to the main menu.
  if (isExitIntent(text)) {
    await prisma.whatsappBotSession.update({
      where: { phone: from },
      data: { state: 'MENU', flow: null, prn: null, doctorId: null, doctorName: null, activeQueryId: null, prnAttempts: 0, scratch: null, otpCode: null, otpExpiresAt: null, consentAt: null },
    });
    await sendMainMenu(from, false);
    return;
  }

  switch (session.state) {
    case 'MENU': {
      let choice = pickChoice(replyId, text, MAIN_MENU_MAP);
      if (!choice && text) {
        choice = matchMenuKeywords(text);
      }
      if (choice === 'EMERGENCY') { await sendEmergency(from); return; } // stays in MENU
      if (choice === 'ENQUIRY') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU_ENQUIRY' } });
        await sendEnquiryMenu(from);
        return;
      }
      if (choice === 'APPT') {
        const scratchData = text && !replyId ? JSON.stringify({ symptoms: text }) : null;
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_TYPE', flow: 'APPT', scratch: scratchData } });
        await sendButtons(from, 'Doctor Appointment — what would you like to book?', [
          { id: 'NEW', title: 'New visit' },
          { id: 'FOLLOWUP', title: 'Follow-up visit' },
        ]);
        return;
      }
      if (choice === 'DOORSTEP') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_SERVICE', flow: 'DOORSTEP', scratch: null } });
        await sendButtons(from, 'Doorstep Services — what do you need?', [
          { id: 'LAB_PICKUP', title: 'Lab sample pickup' },
          { id: 'PHARMACY_DELIVERY', title: 'Pharmacy delivery' },
        ]);
        return;
      }
      if (choice === 'OTHERS') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'OTHERS_NAME', flow: 'OTHERS', scratch: null } });
        await sendText(from, 'Please type your full name.');
        return;
      }
      if (await routeFreeText(from, text)) return; // AI intent fallback
      await sendMainMenu(from, false); // unrecognised → re-show
      return;
    }

    case 'MENU_ENQUIRY': {
      const choice = pickChoice(replyId, text, ENQUIRY_MENU_MAP);
      if (choice === 'ENQ_REPORT') {
        await prisma.whatsappBotSession.update({
          where: { phone: from },
          data: { state: 'AWAITING_PRN', flow: 'REPORT', prn: null, doctorId: null, doctorName: null, activeQueryId: null, prnAttempts: 0 },
        });
        await sendText(from, 'Report follow-up. Please reply with your *PRN* (Patient Registration Number).');
        return;
      }
      if (choice === 'ENQ_SURGERY') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_S_NAME', flow: 'ENQ_SURGERY', scratch: null } });
        await sendText(from, 'Surgery estimation enquiry. Please type your full name.');
        return;
      }
      if (choice === 'ENQ_INSURANCE') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_I_NAME', flow: 'ENQ_INSURANCE', scratch: null } });
        await sendText(from, 'Insurance enquiry. Please type your full name.');
        return;
      }
      if (choice === 'ENQ_COMPLAINT') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_C_NAME', flow: 'ENQ_COMPLAINT', scratch: null } });
        await sendText(from, 'Raise a complaint. Please type your full name.');
        return;
      }
      if (await routeFreeText(from, text)) return; // AI intent fallback
      await sendEnquiryMenu(from);
      return;
    }

    case 'POST_DONE': {
      const c = pickChoice(replyId, text, { ELSE_YES: 'ELSE_YES', ELSE_NO: 'ELSE_NO', yes: 'ELSE_YES', '1': 'ELSE_YES', no: 'ELSE_NO', '2': 'ELSE_NO' });
      if (c === 'ELSE_NO') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU', flow: null, scratch: null } });
        await sendText(from, `Thank you for contacting ${HOSPITAL_NAME}. Take care — message us anytime.`);
        return;
      }
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU' } });
      if (c !== 'ELSE_YES' && (await routeFreeText(from, text))) return; // typed a new request
      await sendMainMenu(from, false);
      return;
    }

    // ── Doctor Appointment flow ──────────────────────────────────────────
    case 'APPT_TYPE': {
      const c = pickChoice(replyId, text, {
        NEW: 'NEW', FOLLOWUP: 'FOLLOWUP', '1': 'NEW', new: 'NEW', '2': 'FOLLOWUP', follow: 'FOLLOWUP', followup: 'FOLLOWUP', 'follow-up': 'FOLLOWUP',
      });
      if (c !== 'NEW' && c !== 'FOLLOWUP') {
        if (await routeFreeText(from, text)) return; // they asked for a different service
        await sendButtons(from, 'Please choose:', [{ id: 'NEW', title: 'New visit' }, { id: 'FOLLOWUP', title: 'Follow-up visit' }]);
        return;
      }
      await mergeScratch(from, session, { type: c === 'FOLLOWUP' ? 'followup' : 'new' });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_PRN' } });
      await sendText(from, c === 'FOLLOWUP'
        ? 'Please enter your *PRN* (required for a follow-up).'
        : 'Please enter your *PRN*, or reply "new" if this is your first visit.');
      return;
    }

    case 'APPT_PRN': {
      const sc = readScratch(session);
      const t = (text ?? '').trim().toLowerCase();
      if (t === 'new') {
        if (sc.type === 'followup') { await sendText(from, 'A follow-up needs an existing PRN. Please enter your PRN, or reply "menu".'); return; }
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_NAME' } });
        await sendText(from, 'Please type your full name.');
        return;
      }
      const prn = parseInt((text ?? '').replace(/\D/g, ''), 10);
      if (!prn || Number.isNaN(prn)) { await sendText(from, 'Please enter a valid PRN (numbers only), or reply "new".'); return; }
      const pd = await prisma.patientDetails.findUnique({ where: { prn } });
      if (!pd) { await sendText(from, `No record for PRN ${prn}. Re-enter, or reply "new" for a first visit.`); return; }
      if (sc.type === 'followup') {
        const fuDocs = await recentVisitDoctors(prn);
        if (!fuDocs.length) {
          await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU', flow: null, scratch: null } });
          await sendText(from, 'A free follow-up applies only within 7 days of a completed visit, and we don’t see an eligible recent visit on this PRN. You can book a New visit — reply "menu".');
          return;
        }
        await mergeScratch(from, session, { prn, name: pd.name, _fuDocPage: 0 });
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_FU_DOCTOR' } });
        await sendPagedList(from, 'Select doctor', 'Choose the doctor you consulted.', 'Doctors', fuDocs.map((d) => ({ id: `DOC_${d.id}`, title: d.name })), 0);
        return;
      }
      await mergeScratch(from, session, { prn, name: pd.name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DEPT' } });
      await sendDepartments(from);
      return;
    }

    case 'APPT_NAME': {
      const name = (text ?? '').trim();
      if (name.length < 2) { await sendText(from, 'Please type your full name.'); return; }
      await mergeScratch(from, session, { name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DEPT' } });
      await sendDepartments(from);
      return;
    }

    case 'APPT_DEPT': {
      if (replyId === 'MORE' || replyId === 'PREV') {
        const cur = readScratch(session)._deptPage || 0;
        const page = replyId === 'PREV' ? Math.max(0, cur - 1) : cur + 1;
        await mergeScratch(from, session, { _deptPage: page });
        await sendDepartments(from, page);
        return;
      }
      if (replyId === 'DEPT_HELP' || (text && ['help', 'not sure', 'help me choose'].includes(text.trim().toLowerCase()))) {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_HELP_LANG' } });
        await sendLangList(from);
        return;
      }
      const deps = await listDepartments();
      let dep = replyId?.startsWith('DEP_') ? deps.find((d) => `DEP_${d.id}` === replyId) : undefined;
      if (!dep && text) dep = deps.find((d) => d.name.toLowerCase() === text.trim().toLowerCase());
      if (!dep) { await sendDepartments(from, readScratch(session)._deptPage || 0); return; }
      await mergeScratch(from, session, { departmentId: dep.id, department: dep.name, _docPage: 0 });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DOCTOR' } });
      await sendDoctorsForDept(from, dep.id, 0);
      return;
    }

    // "Help me choose" — language → symptoms (text/voice) → suggest department.
    case 'APPT_HELP_LANG': {
      const lang = (replyId ? LANGS.find((l) => l.id === replyId) : undefined)
        || (text ? LANGS.find((l) => l.title.toLowerCase() === text.trim().toLowerCase()) : undefined);
      if (!lang) { await sendLangList(from); return; }
      await mergeScratch(from, session, { helpLang: lang.code });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_HELP_INPUT' } });
      await sendText(from, 'Please describe what you are suffering from — type it, or send a voice message in your chosen language.');
      return;
    }

    case 'APPT_HELP_INPUT': {
      const sc = readScratch(session);
      const typed = (text ?? '').trim();
      if (typed) { await proceedWithSymptoms(from, typed); return; } // typed text — they already see it
      if (media && media.type === 'audio') {
        await sendText(from, 'Got your voice message — understanding it…');
        const dl = await downloadMedia(media.id);
        const transcript = (dl ? await transcribeAudio(dl.buffer, sc.helpLang || 'en') : null)?.trim();
        if (!transcript) { await sendText(from, 'Sorry, I couldn’t understand the audio. Please try again, or type your problem.'); return; }
        await mergeScratch(from, session, { symptoms: transcript });
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_HELP_CONFIRM' } });
        await sendButtons(from, `I understood:\n\n"${transcript}"\n\nIs that correct?`, [
          { id: 'HELP_YES', title: 'Yes, proceed' },
          { id: 'HELP_NO', title: 'Re-record' },
        ]);
        return;
      }
      await sendText(from, 'Please describe your problem as text, or send a voice message.');
      return;
    }

    case 'APPT_HELP_CONFIRM': {
      const c = pickChoice(replyId, text, {
        HELP_YES: 'HELP_YES', HELP_NO: 'HELP_NO', '1': 'HELP_YES', yes: 'HELP_YES', correct: 'HELP_YES',
        '2': 'HELP_NO', no: 'HELP_NO', 're-record': 'HELP_NO', rerecord: 'HELP_NO', redo: 'HELP_NO',
      });
      if (c === 'HELP_NO') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_HELP_INPUT' } });
        await sendText(from, 'No problem — please describe your problem again (type it or send a voice message).');
        return;
      }
      if (c !== 'HELP_YES') {
        await sendButtons(from, 'Please confirm:', [{ id: 'HELP_YES', title: 'Yes, proceed' }, { id: 'HELP_NO', title: 'Re-record' }]);
        return;
      }
      const symptoms = readScratch(session).symptoms || '';
      if (!symptoms) {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_HELP_INPUT' } });
        await sendText(from, 'Please describe your problem again.');
        return;
      }
      await proceedWithSymptoms(from, symptoms);
      return;
    }

    case 'APPT_DOCTOR': {
      const sc = readScratch(session);
      if (replyId === 'MORE' || replyId === 'PREV') {
        const page = replyId === 'PREV' ? Math.max(0, (sc._docPage || 0) - 1) : (sc._docPage || 0) + 1;
        await mergeScratch(from, session, { _docPage: page });
        await sendDoctorsForDept(from, sc.departmentId, page);
        return;
      }
      const docs = await listDoctorsByDept(sc.departmentId);
      let doc = replyId?.startsWith('DOC_') ? docs.find((d) => `DOC_${d.id}` === replyId) : undefined;
      if (!doc && text) doc = docs.find((d) => d.name.toLowerCase() === text.trim().toLowerCase());
      if (!doc) { await sendDoctorsForDept(from, sc.departmentId, sc._docPage || 0); return; }
      await mergeScratch(from, session, { doctorId: doc.id, doctorName: doc.name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DATE' } });
      await sendDateOptions(from, doc.id);
      return;
    }

    // Follow-up: pick only from doctors recently consulted (no department step).
    case 'APPT_FU_DOCTOR': {
      const sc = readScratch(session);
      const fuDocs = await recentVisitDoctors(sc.prn);
      if (replyId === 'MORE' || replyId === 'PREV') {
        const page = replyId === 'PREV' ? Math.max(0, (sc._fuDocPage || 0) - 1) : (sc._fuDocPage || 0) + 1;
        await mergeScratch(from, session, { _fuDocPage: page });
        await sendPagedList(from, 'Select doctor', 'Choose the doctor you consulted.', 'Doctors', fuDocs.map((d) => ({ id: `DOC_${d.id}`, title: d.name })), page);
        return;
      }
      let doc = replyId?.startsWith('DOC_') ? fuDocs.find((d) => `DOC_${d.id}` === replyId) : undefined;
      if (!doc && text) doc = fuDocs.find((d) => d.name.toLowerCase() === text.trim().toLowerCase());
      if (!doc) {
        await sendPagedList(from, 'Select doctor', 'Please pick the doctor you consulted.', 'Doctors', fuDocs.map((d) => ({ id: `DOC_${d.id}`, title: d.name })), sc._fuDocPage || 0);
        return;
      }
      await mergeScratch(from, session, { doctorId: doc.id, doctorName: doc.name, department: doc.department ?? '' });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'APPT_DATE' } });
      await sendDateOptions(from, doc.id);
      return;
    }

    case 'APPT_DATE': {
      const scd = readScratch(session);
      let ymd: string | undefined = replyId?.startsWith('DATE_') ? replyId.slice(5) : undefined;
      if (!ymd && text) ymd = (await availableDates(scd.doctorId)).find((d) => d.title.toLowerCase() === text.trim().toLowerCase())?.id;
      if (!ymd) { await sendDateOptions(from, scd.doctorId); return; }
      const sc = await mergeScratch(from, session, { date: ymd });
      const slots = await getFreeSlots(sc.doctorId, ymd);
      if (!slots.length) {
        await sendText(from, `No free slots for ${sc.doctorName} on ${moment.tz(ymd, 'YYYY-MM-DD', TZ).format('ddd, DD MMM')}. Please pick another date.`);
        await sendDateOptions(from, sc.doctorId);
        return;
      }
      await prisma.whatsappBotSession.update({
        where: { phone: from },
        data: { state: 'APPT_SLOT', scratch: JSON.stringify({ ...sc, _slots: slots, _slotPage: 0 }) },
      });
      await sendPagedList(from, 'Select time', 'Available slots:', 'Slots', slotItems(slots), 0);
      return;
    }

    case 'APPT_SLOT': {
      const sc = readScratch(session);
      const slots: string[] = sc._slots || [];
      if (replyId === 'MORE' || replyId === 'PREV') {
        const page = replyId === 'PREV' ? Math.max(0, (sc._slotPage || 0) - 1) : (sc._slotPage || 0) + 1;
        await mergeScratch(from, session, { _slotPage: page });
        await sendPagedList(from, 'Select time', 'Available slots:', 'Slots', slotItems(slots), page);
        return;
      }
      let slot: string | undefined;
      if (replyId?.startsWith('SLOT_')) slot = slots[parseInt(replyId.slice(5), 10)];
      if (!slot && text) slot = slots.find((s) => s.toLowerCase() === text.trim().toLowerCase());
      if (!slot) {
        await sendPagedList(from, 'Select time', 'Please pick a slot:', 'Slots', slotItems(slots), sc._slotPage || 0);
        return;
      }
      await mergeScratch(from, session, { slot });
      await startOtp(from, sc.name, 'APPT');
      return;
    }

    // ── Doorstep Services flow ───────────────────────────────────────────
    case 'DOORSTEP_SERVICE': {
      const c = pickChoice(replyId, text, {
        LAB_PICKUP: 'LAB_PICKUP', PHARMACY_DELIVERY: 'PHARMACY_DELIVERY',
        '1': 'LAB_PICKUP', lab: 'LAB_PICKUP', sample: 'LAB_PICKUP', pickup: 'LAB_PICKUP',
        '2': 'PHARMACY_DELIVERY', pharmacy: 'PHARMACY_DELIVERY', delivery: 'PHARMACY_DELIVERY', drugs: 'PHARMACY_DELIVERY',
      });
      if (c !== 'LAB_PICKUP' && c !== 'PHARMACY_DELIVERY') {
        if (await routeFreeText(from, text)) return; // they asked for a different service
        await sendButtons(from, 'Please choose a service:', [{ id: 'LAB_PICKUP', title: 'Lab sample pickup' }, { id: 'PHARMACY_DELIVERY', title: 'Pharmacy delivery' }]);
        return;
      }
      await mergeScratch(from, session, { serviceType: c });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_PRN' } });
      await sendText(from, 'Please enter your *PRN*, or reply "new" if you are not registered.');
      return;
    }

    case 'DOORSTEP_PRN': {
      const t = (text ?? '').trim().toLowerCase();
      if (t === 'new') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_NAME' } });
        await sendText(from, 'Please type your full name.');
        return;
      }
      const prn = parseInt((text ?? '').replace(/\D/g, ''), 10);
      if (!prn || Number.isNaN(prn)) { await sendText(from, 'Please enter a valid PRN (numbers only), or reply "new".'); return; }
      const pd = await prisma.patientDetails.findUnique({ where: { prn } });
      if (!pd) { await sendText(from, `No record for PRN ${prn}. Re-enter, or reply "new".`); return; }
      await mergeScratch(from, session, { prn, name: pd.name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_ADDRESS' } });
      await sendText(from, 'Please type your full address (house/flat, street, area, landmark, pincode).');
      return;
    }

    case 'DOORSTEP_NAME': {
      const name = (text ?? '').trim();
      if (name.length < 2) { await sendText(from, 'Please type your full name.'); return; }
      await mergeScratch(from, session, { name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_ADDRESS' } });
      await sendText(from, 'Please type your full address (house/flat, street, area, landmark, pincode).');
      return;
    }

    case 'DOORSTEP_ADDRESS': {
      const address = (text ?? '').trim();
      if (address.length < 6) { await sendText(from, 'Please type your full address.'); return; }
      await mergeScratch(from, session, { address });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_LOCATION' } });
      await sendText(from, `Optionally share your location pin (WhatsApp attach → Location) so we can check free-service eligibility (within ${DOORSTEP_FREE_RADIUS_KM} km). Or reply "skip".`);
      return;
    }

    case 'DOORSTEP_LOCATION': {
      if (location && HOSPITAL_LAT != null && HOSPITAL_LNG != null) {
        const km = Math.round(haversineKm(HOSPITAL_LAT, HOSPITAL_LNG, location.lat, location.lng) * 10) / 10;
        await mergeScratch(from, session, { lat: location.lat, lng: location.lng, distanceKm: km, withinFreeRadius: km <= DOORSTEP_FREE_RADIUS_KM });
      } else if (location) {
        // Got a pin but hospital coords aren't configured — store it, leave eligibility unknown.
        await mergeScratch(from, session, { lat: location.lat, lng: location.lng });
      } else if ((text ?? '').trim().toLowerCase() !== 'skip') {
        await sendText(from, 'Please share your location pin, or reply "skip".');
        return;
      }
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'DOORSTEP_DETAILS' } });
      await sendText(from, 'Any additional details for our team? Type them, or reply "skip".');
      return;
    }

    case 'DOORSTEP_DETAILS': {
      const sc = readScratch(session);
      const t = (text ?? '').trim();
      if (t && t.toLowerCase() !== 'skip') await mergeScratch(from, session, { details: t });
      await startOtp(from, sc.name, 'DOORSTEP');
      return;
    }

    // ── Enquiry: Surgery estimation ──────────────────────────────────────
    case 'ENQ_S_NAME': {
      const name = (text ?? '').trim();
      if (name.length < 2) { await sendText(from, 'Please type your full name.'); return; }
      await mergeScratch(from, session, { name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_S_PROC' } });
      await sendText(from, 'Which surgery or procedure is this enquiry about?');
      return;
    }
    case 'ENQ_S_PROC': {
      const proc = (text ?? '').trim();
      if (proc.length < 2) { await sendText(from, 'Please type the surgery / procedure name.'); return; }
      const sc = await mergeScratch(from, session, { procedure: proc });
      await startOtp(from, sc.name, 'ENQ_SURGERY');
      return;
    }

    // ── Enquiry: Insurance ───────────────────────────────────────────────
    case 'ENQ_I_NAME': {
      const name = (text ?? '').trim();
      if (name.length < 2) { await sendText(from, 'Please type your full name.'); return; }
      await mergeScratch(from, session, { name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_I_PROC' } });
      await sendText(from, 'Which surgery or procedure is this for?');
      return;
    }
    case 'ENQ_I_PROC': {
      const proc = (text ?? '').trim();
      if (proc.length < 2) { await sendText(from, 'Please type the surgery / procedure name.'); return; }
      await mergeScratch(from, session, { procedure: proc });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_I_PLAN' } });
      await sendText(from, 'Please share your insurance provider / plan details.');
      return;
    }
    case 'ENQ_I_PLAN': {
      const plan = (text ?? '').trim();
      if (plan.length < 2) { await sendText(from, 'Please type your insurance provider / plan.'); return; }
      const sc = await mergeScratch(from, session, { insurance: plan });
      await startOtp(from, sc.name, 'ENQ_INSURANCE');
      return;
    }

    // ── Enquiry: Complaint ───────────────────────────────────────────────
    case 'ENQ_C_NAME': {
      const name = (text ?? '').trim();
      if (name.length < 2) { await sendText(from, 'Please type your full name.'); return; }
      await mergeScratch(from, session, { name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'ENQ_C_DESC' } });
      await sendText(from, 'Please describe your complaint.');
      return;
    }
    case 'ENQ_C_DESC': {
      const desc = (text ?? '').trim();
      if (desc.length < 3) { await sendText(from, 'Please describe your complaint in a little more detail.'); return; }
      const sc = await mergeScratch(from, session, { description: desc });
      await startOtp(from, sc.name, 'ENQ_COMPLAINT');
      return;
    }

    // ── Others (free text) ───────────────────────────────────────────────
    case 'OTHERS_NAME': {
      const name = (text ?? '').trim();
      if (name.length < 2) { await sendText(from, 'Please type your full name.'); return; }
      await mergeScratch(from, session, { name });
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'OTHERS_MSG' } });
      await sendText(from, 'Please type your message / request.');
      return;
    }
    case 'OTHERS_MSG': {
      const msg = (text ?? '').trim();
      if (msg.length < 2) { await sendText(from, 'Please type your message.'); return; }
      const sc = await mergeScratch(from, session, { message: msg });
      await startOtp(from, sc.name, 'OTHERS');
      return;
    }

    // ── Generic OTP + consent (shared) ───────────────────────────────────
    case 'OTP': {
      const entry = (text ?? '').trim();
      const sc = readScratch(session);
      if (entry.toLowerCase() === 'resend') { await startOtp(from, sc.name, session.flow || ''); return; }
      if (!session.otpCode || !session.otpExpiresAt || session.otpExpiresAt < now) {
        await sendText(from, 'Your OTP has expired. Reply "resend" for a new code.');
        return;
      }
      if (entry.replace(/\D/g, '') !== session.otpCode) {
        await sendText(from, 'Incorrect OTP. Please re-enter, or reply "resend".');
        return;
      }
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { otpCode: null } });
      await askConsent(from);
      return;
    }

    case 'CONSENT': {
      const choice = pickChoice(replyId, text, {
        CONSENT_YES: 'CONSENT_YES', CONSENT_NO: 'CONSENT_NO', '1': 'CONSENT_YES', yes: 'CONSENT_YES', agree: 'CONSENT_YES', '2': 'CONSENT_NO', no: 'CONSENT_NO',
      });
      if (choice === 'CONSENT_NO') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU', flow: null, scratch: null } });
        await sendText(from, 'Understood. Without your consent we can’t process this request. Reply "menu" anytime.');
        return;
      }
      if (choice !== 'CONSENT_YES') { await askConsent(from); return; }
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { consentAt: now } });
      await finalizeFlow(from, session, now);
      return;
    }

    case 'AWAITING_PRN': {
      const digits = (text ?? '').replace(/\D/g, '');
      const prn = digits ? parseInt(digits, 10) : NaN;
      if (!prn || Number.isNaN(prn)) {
        await sendText(from, 'Please send a valid *PRN* (numbers only), e.g. 98432.');
        return;
      }
      const patient = await prisma.patientDetails.findUnique({ where: { prn } });
      if (!patient) {
        const attempts = (session.prnAttempts ?? 0) + 1;
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { prnAttempts: attempts } });
        if (attempts >= MAX_PRN_ATTEMPTS) {
          await sendText(from, `We couldn't verify your PRN after several attempts. Please call our helpline: ${HELPLINE}`);
        } else {
          await sendText(from, `No record found for PRN ${prn}. Please check and resend, or contact reception.`);
        }
        return;
      }
      const docs = await doctorsForPrn(prn);
      if (docs.length === 0) {
        await sendText(from, `Hi ${patient.name}, we couldn’t find a consulting doctor on PRN ${prn}. Please call our helpline: ${HELPLINE}`);
        return;
      }
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'AWAITING_DOCTOR', prn, prnAttempts: 0 } });
      await sendList(
        from,
        'Select a doctor',
        `Found your record, ${patient.name}.\nWhich doctor would you like to connect with?`,
        'Choose doctor',
        docs.map((d) => ({ id: String(d.id), title: d.name })),
      );
      return;
    }

    case 'AWAITING_DOCTOR': {
      if (!session.prn) {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'AWAITING_PRN' } });
        await sendText(from, 'Please resend your *PRN*.');
        return;
      }
      const docs = await doctorsForPrn(session.prn);
      // Accept the list-reply id, or a typed name match.
      let picked = replyId ? docs.find((d) => String(d.id) === replyId) : undefined;
      if (!picked && text) picked = docs.find((d) => d.name.toLowerCase() === text.toLowerCase());
      if (!picked) {
        await sendList(
          from,
          'Select a doctor',
          'Please pick a doctor from the list.',
          'Choose doctor',
          docs.map((d) => ({ id: String(d.id), title: d.name })),
        );
        return;
      }
      await prisma.whatsappBotSession.update({
        where: { phone: from },
        data: { state: 'AWAITING_QUESTION', doctorId: picked.id, doctorName: picked.name },
      });
      await sendText(from, `Please type your question about the investigation report for *${picked.name}*.`);
      return;
    }

    case 'AWAITING_QUESTION': {
      const question = (text ?? '').trim();
      if (!question && !media) {
        await sendText(from, 'Please type your question, or attach your report (PDF/image).');
        return;
      }
      if (!session.prn || !session.doctorId) {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'AWAITING_PRN' } });
        await sendText(from, 'Session expired. Please resend your *PRN*.');
        return;
      }
      // Abuse guard: cap new queries per phone per day.
      if (await queriesToday(from) >= MAX_QUERIES_PER_DAY) {
        await sendText(from, `You've reached today's limit for new queries. For urgent help, please call ${HELPLINE}.`);
        return;
      }
      const patient = await prisma.patientDetails.findUnique({ where: { prn: session.prn } });
      const stored = media ? await ingestMedia(media) : null;
      const bodyText = question || (media ? mediaPlaceholder(media) : '');
      // Collect the submission, then verify (OTP) + consent before creating the query.
      await mergeScratch(from, session, {
        prn: session.prn,
        doctorId: session.doctorId,
        doctorName: session.doctorName,
        name: patient?.name ?? from,
        bodyText,
        media: stored,
        hadMedia: !!media,
      });
      await startOtp(from, patient?.name ?? '', 'REPORT');
      return;
    }

    case 'IN_CONVERSATION': {
      const followUp = (text ?? '').trim();
      if (!followUp && !media) return;
      if (!session.activeQueryId) {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'AWAITING_PRN' } });
        await sendText(from, 'Please reply with your *PRN* to start a new query.');
        return;
      }
      const q = await prisma.whatsappQuery.findUnique({ where: { id: session.activeQueryId } });
      if (!q || q.status === 'closed') {
        await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'AWAITING_PRN', activeQueryId: null } });
        await sendText(from, 'That conversation is closed. Reply with your *PRN* to start a new query.');
        return;
      }
      const stored = media ? await ingestMedia(media) : null;
      const bodyText = followUp || (media ? mediaPlaceholder(media) : '');
      await prisma.whatsappQueryMessage.create({
        data: { queryId: q.id, direction: 'IN', body: bodyText, sender: q.patientName ?? from, ...(stored ?? {}) },
      });
      await prisma.whatsappQuery.update({ where: { id: q.id }, data: { status: 'open', lastPatientMsgAt: now } });
      await notifyDoctor(q.doctorId, q.id, q.prn, q.patientName ?? from, bodyText);
      await sendText(from, `Added to your conversation with ${q.doctorName} (${q.refNo}). Reply "menu" or "stop" to end.${media ? `\n\n${MEDIA_NOTE}` : ''}`);
      return;
    }

    default: {
      await prisma.whatsappBotSession.update({ where: { phone: from }, data: { state: 'MENU', flow: null } });
      await sendMainMenu(from, false);
    }
  }
}

// Delivery-status callback (sent/delivered/read/failed). Logged only for now.
export const handleDeliveryStatus = async (req: Request, res: Response): Promise<void> => {
  const statusData = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
  if (!statusData) {
    res.status(400).json({ message: 'Invalid delivery status payload' });
    return;
  }
  console.log(`📬 Delivery: ${statusData.id} → ${statusData.status} (${statusData.recipient_id})`);
  res.status(200).send('Delivery status received');
};
