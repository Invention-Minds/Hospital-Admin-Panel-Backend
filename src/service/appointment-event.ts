import type { Request } from 'express';
import prisma from './prisma-client';

/**
 * Per-appointment lifecycle trail (model AppointmentEvent).
 *
 * Distinct from `auditLog` (service/app-audit.ts), which is the generic
 * cross-module audit table. This one answers appointment-specific questions
 * the front desk actually asks:
 *
 *   - who rescheduled this appointment, and how many times?
 *   - what was the old slot, what is the new one?
 *   - was it cancelled by a person or by the 3-hour no-show cron?
 *   - which staff member cancels/reschedules the most?
 *
 * Usage from a controller:
 *
 *   await recordAppointmentEvent(req, {
 *     appointmentId: updated.id,
 *     eventType: 'RESCHEDULED',
 *     from: existing,
 *     to: updated,
 *     source: 'admin-panel',
 *   });
 *
 * ...and from a cron / webhook with no `req`:
 *
 *   await recordAppointmentEventSystem({
 *     appointmentId: id,
 *     eventType: 'CANCELLED',
 *     from: appointment,
 *     source: 'cron:expired-3h',
 *     reason: 'Not checked in 3h after slot time',
 *   });
 *
 * Writing the event never throws — a logging failure must not roll back or
 * block a booking. Errors go to the console for ops. Same contract as
 * app-audit.ts.
 */

export type AppointmentEventType =
  | 'BOOKED'
  | 'CONFIRMED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'STATUS_CHANGE'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'COMPLETED'
  | 'OPD_CLOSED'
  | 'DELETED';

export type AppointmentActorType = 'user' | 'system' | 'bot' | 'patient' | 'unknown';

/** The slice of an appointment row that a reschedule/status change moves. */
export interface AppointmentSlotSnapshot {
  date?: string | null;
  time?: string | null;
  doctorId?: number | null;
  doctorName?: string | null;
  status?: string | null;
}

/** Patient identity snapshot — appointment rows get edited, events must not. */
export interface AppointmentSubject {
  patientId?: number | null;
  prnNumber?: number | null;
  patientName?: string | null;
}

export interface RecordAppointmentEventInput {
  appointmentId: number;
  eventType: AppointmentEventType | string;
  /** Values before the change. Pass the row you read before updating. */
  from?: AppointmentSlotSnapshot | null;
  /** Values after the change. Pass the updated row. */
  to?: AppointmentSlotSnapshot | null;
  subject?: AppointmentSubject | null;
  /** admin-panel | walk-in | whatsapp-bot | cron:expired-3h | ... */
  source?: string;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  /** Role is not in the JWT (see global.d.ts); pass it when the caller knows it. */
  actorRole?: string | null;
}

/**
 * Write one event, attributing it to the authenticated user on `req`.
 * Falls back to actorType 'unknown' when the route carries no token.
 */
export const recordAppointmentEvent = async (
  req: Request | null,
  data: RecordAppointmentEventInput
): Promise<void> => {
  const actorId = typeof req?.user?.id === 'number' ? req.user.id : null;
  await persist(data, {
    actorType: actorId != null ? 'user' : 'unknown',
    actorId,
    actorName: req?.user?.username ?? null,
    actorRole: data.actorRole ?? null,
    ipAddress: extractIp(req),
  });
};

/**
 * Write one event for a system-driven action (cron, automation, webhook).
 * `source` is what tells the two apart in reports, so always pass it.
 */
export const recordAppointmentEventSystem = async (
  data: RecordAppointmentEventInput & { actorType?: AppointmentActorType; actorName?: string }
): Promise<void> => {
  await persist(data, {
    actorType: data.actorType ?? 'system',
    actorId: null,
    actorName: data.actorName ?? data.source ?? 'system',
    actorRole: data.actorType === 'bot' ? 'bot' : 'system',
    ipAddress: null,
  });
};

interface ActorFields {
  actorType: AppointmentActorType;
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
  ipAddress: string | null;
}

const persist = async (data: RecordAppointmentEventInput, actor: ActorFields): Promise<void> => {
  try {
    await prisma.appointmentEvent.create({
      data: {
        appointmentId: data.appointmentId,
        eventType: data.eventType,
        fromDate: data.from?.date ?? null,
        fromTime: data.from?.time ?? null,
        fromDoctorId: data.from?.doctorId ?? null,
        fromDoctorName: data.from?.doctorName ?? null,
        fromStatus: data.from?.status ?? null,
        toDate: data.to?.date ?? null,
        toTime: data.to?.time ?? null,
        toDoctorId: data.to?.doctorId ?? null,
        toDoctorName: data.to?.doctorName ?? null,
        toStatus: data.to?.status ?? null,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        ipAddress: actor.ipAddress,
        patientId: data.subject?.patientId ?? null,
        prnNumber: data.subject?.prnNumber ?? null,
        patientName: data.subject?.patientName ?? null,
        source: data.source ?? null,
        reason: data.reason ?? null,
        payload: data.payload ? JSON.stringify(data.payload) : null,
      },
    });

    // Denormalised fields on the appointment so list/report screens don't have
    // to aggregate the event table. Both are derivable from the events, so a
    // failure here is recoverable — never let it throw.
    if (data.eventType === 'RESCHEDULED') {
      await prisma.appointment.update({
        where: { id: data.appointmentId },
        data: { rescheduleCount: { increment: 1 } },
      });
    } else if (data.eventType === 'CANCELLED') {
      await prisma.appointment.update({
        where: { id: data.appointmentId },
        data: {
          cancelledBy: actor.actorName ?? actor.actorType,
          cancelledById: actor.actorId,
          cancelledAt: new Date(),
          cancelReason: data.reason ?? null,
        },
      });
    }
  } catch (error) {
    console.error('[appointment-event] failed to persist event:', {
      appointmentId: data.appointmentId,
      eventType: data.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Classify what a generic PUT /appointments/:id actually did, so the trail
 * records "RESCHEDULED 10:00 → 11:30" rather than a row per field edit.
 *
 * Returns null when nothing trail-worthy changed (vitals, waiting time, type,
 * payment fields, …) — those edits stay out of the history to keep it readable.
 *
 * Precedence: a cancel is a cancel even if the slot moved in the same call.
 */
export const classifyAppointmentChange = (
  before: AppointmentSlotSnapshot,
  after: AppointmentSlotSnapshot
): AppointmentEventType | null => {
  const slotChanged =
    (after.doctorId ?? null) !== (before.doctorId ?? null) ||
    (after.date ?? null) !== (before.date ?? null) ||
    (after.time ?? null) !== (before.time ?? null);
  const statusChanged = (after.status ?? null) !== (before.status ?? null);

  if (statusChanged && after.status === 'cancelled') return 'CANCELLED';
  if (slotChanged) return 'RESCHEDULED';
  if (statusChanged) {
    if (after.status === 'confirmed') return 'CONFIRMED';
    if (after.status === 'completed') return 'COMPLETED';
    return 'STATUS_CHANGE';
  }
  return null;
};

/** Narrow a full appointment row to the columns the trail cares about. */
export const slotSnapshot = (appt: {
  date?: string | null;
  time?: string | null;
  doctorId?: number | null;
  doctorName?: string | null;
  status?: string | null;
}): AppointmentSlotSnapshot => ({
  date: appt.date ?? null,
  time: appt.time ?? null,
  doctorId: appt.doctorId ?? null,
  doctorName: appt.doctorName ?? null,
  status: appt.status ?? null,
});

/** Narrow a full appointment row to the patient-identity snapshot. */
export const subjectSnapshot = (appt: {
  patientId?: number | null;
  prnNumber?: number | null;
  patientName?: string | null;
}): AppointmentSubject => ({
  patientId: appt.patientId ?? null,
  prnNumber: appt.prnNumber ?? null,
  patientName: appt.patientName ?? null,
});

const extractIp = (req: Request | null): string | null => {
  if (!req) return null;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
};
