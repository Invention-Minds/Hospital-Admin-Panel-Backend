import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { auditLogAs } from '../../service/app-audit';
import { notifyPendingAppointments } from '../appointments/appointment.controller';

/**
 * Doctor change log — who changed a doctor's details or schedule, and when.
 *
 * Every change is one AppAuditLog row (module 'doctor'); the "Doctor Updates"
 * page reads them back. The same call alerts the booking desks (Tele Caller +
 * Front Desk) through the in-app bell.
 *
 * Alerts are one Notification row per desk user, not one shared row per role:
 * the web bell deletes a notification when it is clicked, so a shared row
 * would disappear for every desk user as soon as one of them opened it.
 *
 * Never throws — a logging or alert failure must not fail the doctor change.
 */

export const DESK_SUB_ADMIN_TYPES = ['Tele Caller', 'Front Desk'];

export type DoctorChangeAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DEACTIVATE'
  | 'ACTIVATE'
  | 'DELETE'
  | 'ROOM_CHANGE'
  | 'LEAVE_ADDED'
  | 'LEAVE_REMOVED'
  | 'SLOTS_BLOCKED'
  | 'EXTRA_SLOTS'
  | 'ARRIVED'
  | 'ARRIVAL_UNDONE';

/** Changes the desk must act on — shown as critical in the bell. */
const CRITICAL_ACTIONS: DoctorChangeAction[] = ['DEACTIVATE', 'DELETE', 'LEAVE_ADDED'];

export interface FieldChange { field: string; from: string | null; to: string | null }

export interface DoctorChangeInput {
  action: DoctorChangeAction;
  doctorId: number;
  doctorName: string;
  /** One line for the bell and the log, e.g. "On leave 22 Nov – 24 Nov". */
  summary: string;
  changes?: FieldChange[];
  details?: Record<string, unknown>;
  /** Live appointments that fall inside the change (leave, blocked slots, deactivation). */
  affectedBookings?: number;
  /** false = log only, no bell alert (daily arrivals would flood the desk). Default true. */
  alert?: boolean;
}

interface Actor { id: number | null; username: string | null; fullName: string | null; role: string | null; subAdminType: string | null }

/**
 * Who made the request. Some doctor routes are not behind authenticateToken,
 * so when req.user is missing the bearer token is verified here (without
 * rejecting the request). Falls back to the username the client put in the
 * body, marked as unverified.
 */
async function resolveActor(req: Request, bodyFallback?: unknown): Promise<Actor> {
  let id: number | null = typeof req.user?.id === 'number' ? req.user.id : null;
  let username: string | null = req.user?.username ?? null;

  if (id == null) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
        if (!decoded?.purpose && typeof decoded?.id === 'number') {
          id = decoded.id;
          username = decoded.username ?? null;
        }
      } catch { /* invalid token — treated as unknown actor */ }
    }
  }

  if (id != null) {
    const u = await prisma.user.findUnique({
      where: { id },
      select: { username: true, fullName: true, role: true, subAdminType: true },
    });
    if (u) return { id, username: u.username, fullName: u.fullName, role: u.role, subAdminType: u.subAdminType };
    return { id, username, fullName: null, role: null, subAdminType: null };
  }

  const fallback = typeof bodyFallback === 'string' && bodyFallback.trim() ? `${bodyFallback.trim()} (unverified)` : null;
  return { id: null, username: fallback, fullName: null, role: null, subAdminType: null };
}

/** "Ramesh K (Tele Caller)" — what the desk sees as "Done by". */
export function actorLabel(a: { username: string | null; fullName?: string | null; role?: string | null; subAdminType?: string | null }): string {
  const name = a.fullName?.trim() || (a.username ?? 'Unknown').replace(/_(super_admin|sub_admin|admin|doctor)$/, '');
  const title = a.subAdminType?.trim() || a.role?.replace(/_/g, ' ') || '';
  return title ? `${name} (${title})` : name;
}

export async function recordDoctorChange(req: Request, input: DoctorChangeInput, bodyActor?: unknown): Promise<void> {
  try {
    const actor = await resolveActor(req, bodyActor);
    const by = actorLabel(actor);

    await auditLogAs(req, { id: actor.id, username: actor.username, role: actor.role }, {
      module: 'doctor',
      action: input.action,
      entityType: 'Doctor',
      entityId: input.doctorId,
      notes: input.summary,
      payload: {
        doctorName: input.doctorName,
        summary: input.summary,
        changes: input.changes ?? [],
        details: input.details ?? {},
        affectedBookings: input.affectedBookings ?? 0,
        actorFullName: actor.fullName,
        actorSubAdminType: actor.subAdminType,
      },
    });

    // Desk bell alerts are OFF unless DOCTOR_CHANGE_ALERTS_ENABLED=true: each
    // change created one notification per desk user and broadcast each one to
    // every open browser, which then re-downloaded the whole notification list
    // (22 Nov 2026 slowdown). The audit log above is always written.
    if (input.alert !== false && process.env.DOCTOR_CHANGE_ALERTS_ENABLED === 'true') {
      await alertDesks(input, by, actor.id);
    }
  } catch (err) {
    console.error(`[doctor-change-log] ${input.action} for doctor ${input.doctorId} failed:`, err);
  }
}

async function alertDesks(input: DoctorChangeInput, by: string, actorId: number | null): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: {
      isActive: true,
      subAdminType: { in: DESK_SUB_ADMIN_TYPES },
      ...(actorId != null ? { id: { not: actorId } } : {}),
    },
    select: { id: true, subAdminType: true },
  });
  if (recipients.length === 0) return;

  const bookings = input.affectedBookings ?? 0;
  const message = `${input.summary}${bookings > 0 ? ` — ${bookings} booked patient${bookings === 1 ? '' : 's'} affected` : ''} · by ${by}`;
  const isCritical = CRITICAL_ACTIONS.includes(input.action) && (input.action !== 'LEAVE_ADDED' || bookings > 0);
  const type = `doctor_${input.action.toLowerCase()}`;
  const title = `Doctor update · ${input.doctorName}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const r of recipients) {
    const row = await prisma.notification.create({
      data: {
        type, title, message, isCritical,
        status: 'unread',
        userId: r.id,
        targetRole: r.subAdminType,
        entityType: 'Doctor',
        entityId: input.doctorId,
        sentAt: now,
        expiresAt,
      },
    });
    // Live toast + bell refresh on open web sessions (each filters to its own userId).
    notifyPendingAppointments(row);
  }
}

// ── helpers for the controllers ────────────────────────────────────────────

const LIVE_STATUSES = ['pending', 'confirmed', 'rescheduled'] as const;

/** IST "YYYY-MM-DD" for a Date or date-ish string. */
export const istDay = (d: Date | string): string => moment(d).tz('Asia/Kolkata').format('YYYY-MM-DD');

/** "22 Nov" / "22 Nov – 24 Nov". */
export function dayRangeLabel(from: string, to: string): string {
  const f = moment.tz(from, 'YYYY-MM-DD', 'Asia/Kolkata').format('D MMM');
  const t = moment.tz(to, 'YYYY-MM-DD', 'Asia/Kolkata').format('D MMM');
  return f === t ? f : `${f} – ${t}`;
}

/** Live appointments for a doctor between two IST days (inclusive), optionally at given times. */
export async function countLiveAppointments(doctorId: number, fromDay: string, toDay: string, times?: string[]): Promise<number> {
  try {
    return await prisma.appointment.count({
      where: {
        doctorId,
        date: { gte: fromDay, lte: toDay },
        status: { in: [...LIVE_STATUSES] },
        ...(times && times.length ? { time: { in: times } } : {}),
      },
    });
  } catch (err) {
    console.warn('[doctor-change-log] appointment count failed:', (err as Error).message);
    return 0;
  }
}

/**
 * "Name (Job title)" for each login username, for screens that only have the
 * stored username (e.g. DoctorAttendance.markedBy). Unknown usernames — such as
 * "import:doctor-attendance.json" — come back as-is.
 */
export async function labelsForUsernames(usernames: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(usernames.filter((u): u is string => !!u)));
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  try {
    const users = await prisma.user.findMany({
      where: { username: { in: wanted } },
      orderBy: { id: 'desc' },
      select: { username: true, fullName: true, role: true, subAdminType: true },
    });
    for (const u of users) if (!out.has(u.username)) out.set(u.username, actorLabel(u));
  } catch (err) {
    console.warn('[doctor-change-log] username lookup failed:', (err as Error).message);
  }
  for (const u of wanted) if (!out.has(u)) out.set(u, u);
  return out;
}

export async function doctorName(doctorId: number): Promise<string> {
  const d = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { name: true } });
  return d?.name ?? `Doctor #${doctorId}`;
}

type AvailabilityRow = { day: string; availableFrom: string; slotDuration: number | null; updatedAt?: Date | null; createdAt?: Date | null };

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayIdx = (d: string) => {
  const i = DAY_ORDER.findIndex((x) => x.toLowerCase().startsWith(d.toLowerCase().slice(0, 3)));
  return i === -1 ? 99 : i;
};

/**
 * The weekly timetable currently in force: the most recently saved batch.
 * Availability is append-only (each edit inserts a fresh set of rows), so the
 * rows saved within a few seconds of the newest one are the current set.
 */
export async function currentTimetable(doctorId: number): Promise<Map<string, string>> {
  const rows = await prisma.doctorAvailability.findMany({
    where: { doctorId, isFuture: { not: true } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: { day: true, availableFrom: true, slotDuration: true, updatedAt: true, createdAt: true },
  });
  if (rows.length === 0) return new Map();
  const newest = (rows[0].updatedAt ?? rows[0].createdAt ?? new Date(0)).getTime();
  const batch = rows.filter((r) => newest - (r.updatedAt ?? r.createdAt ?? new Date(0)).getTime() <= 5000);
  return timetableOf(batch);
}

export function timetableOf(rows: AvailabilityRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r?.day || map.has(r.day)) continue;
    map.set(r.day, `${r.availableFrom}${r.slotDuration ? ` (${r.slotDuration} min)` : ''}`);
  }
  return map;
}

/** Field-level change for the timetable, or null when nothing changed. */
export function timetableChange(before: Map<string, string>, after: Map<string, string>): FieldChange | null {
  const days = Array.from(new Set([...before.keys(), ...after.keys()])).sort((a, b) => dayIdx(a) - dayIdx(b));
  const fmt = (m: Map<string, string>) => days.filter((d) => m.has(d)).map((d) => `${d.slice(0, 3)} ${m.get(d)}`).join(', ') || '—';
  const changed = days.some((d) => before.get(d) !== after.get(d));
  return changed ? { field: 'Timings', from: fmt(before), to: fmt(after) } : null;
}

// ── GET /api/doctors/change-log ─────────────────────────────────────────────

const VIEWER_ROLES = ['super_admin', 'admin'];

export const getDoctorChangeLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const me = typeof req.user?.id === 'number'
      ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, subAdminType: true } })
      : null;
    const allowed = !!me && (VIEWER_ROLES.includes(me.role) || DESK_SUB_ADMIN_TYPES.includes(me.subAdminType?.trim() ?? ''));
    if (!allowed) { res.status(403).json({ error: 'Only admins, Tele Callers and Front Desk can view doctor updates' }); return; }

    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = typeof req.query.from === 'string' && day.test(req.query.from) ? req.query.from : istDay(moment().subtract(6, 'days').toDate());
    const to = typeof req.query.to === 'string' && day.test(req.query.to) ? req.query.to : istDay(new Date());
    const doctorId = Number(req.query.doctorId);
    const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));

    const where = {
      module: 'doctor',
      entityType: 'Doctor',
      createdAt: {
        gte: moment.tz(from, 'YYYY-MM-DD', 'Asia/Kolkata').startOf('day').toDate(),
        lte: moment.tz(to, 'YYYY-MM-DD', 'Asia/Kolkata').endOf('day').toDate(),
      },
      ...(Number.isFinite(doctorId) && doctorId > 0 ? { entityId: String(doctorId) } : {}),
      ...(action ? { action } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.appAuditLog.count({ where }),
      prisma.appAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, action: true, entityId: true, payload: true, notes: true, actorName: true, actorRole: true, createdAt: true },
      }),
    ]);

    const data = rows.map((r) => {
      let p: any = {};
      try { p = r.payload ? JSON.parse(r.payload) : {}; } catch { p = {}; }
      return {
        id: r.id,
        at: r.createdAt,
        action: r.action,
        doctorId: Number(r.entityId),
        doctorName: p.doctorName ?? '',
        summary: p.summary ?? r.notes ?? '',
        changes: Array.isArray(p.changes) ? p.changes : [],
        details: p.details ?? {},
        affectedBookings: Number(p.affectedBookings) || 0,
        doneBy: actorLabel({ username: r.actorName, fullName: p.actorFullName, role: r.actorRole, subAdminType: p.actorSubAdminType }),
      };
    });

    res.status(200).json({ data, total, page, limit, from, to });
  } catch (error) {
    console.error('[doctor-change-log] list failed:', error);
    res.status(500).json({ error: 'Failed to load doctor updates' });
  }
};
