import { Request, Response } from 'express';
import crypto from 'crypto';
import { getRecipientPhones } from '../../service/notification-recipients';
import AppointmentResolver from './appointment.resolver';
import DoctorRepository from '../doctor/doctor.repository';
import { withSlotLock } from '../doctor/doctor.controller';
import AppointmentRepository from './appointment.repository';
import { PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
import axios from 'axios';
import { sendConfirmedWhatsApp, sendGoBuzzMessage, formatGoBuzzNumber } from '../whatsapp/whatsapp.controller';
import { sendConfirmedSMS } from '../sms/sms.controller';
import { saveBufferToStorage } from '../../service/local-file-store';
import { uploadMediaToGoBuzz, sendDocumentTemplate, formatGoBuzzPhone } from '../../service/gobuzz-document';
import { notifyAppointmentConfirmed, notifyAppointmentCancelled } from '../../service/whatsapp-notify.service';
import {
  recordAppointmentEvent,
  classifyAppointmentChange,
  slotSnapshot,
  subjectSnapshot,
} from '../../service/appointment-event';
import { auditLog } from '../../service/app-audit';
import { getNurseAllowedDepartments } from '../_shared/nursing-roles';

const prisma = new PrismaClient();
const templateLang = "en";

/**
 * Budget for the appointment transactions.
 *
 * Prisma's default interactive-transaction timeout is 5s. These transactions do
 * five or six sequential queries and the database is remote (cross-region), so
 * at a few hundred ms per round-trip the default sits right on the edge — a
 * reschedule would intermittently fail with "Transaction already closed:
 * Could not perform operation", rolling the whole update back while the
 * WhatsApp/SMS sends (which run outside the transaction) still went out.
 *
 * maxWait is how long to wait for a connection from the pool before starting.
 */
const APPOINTMENT_TX_OPTIONS = { timeout: 20000, maxWait: 10000 } as const;

// Why a check-in is being reversed. A closed list, not free text: the reason
// decides what else happens (a cancellation is carried out here rather than
// left to the operator), and it keeps the trail countable so a pattern of
// "wrongly marked" hiding real cancellations is visible in the report.
const UNDO_CHECKIN_REASONS = {
  wrongly_marked: 'Checked in the wrong patient',
  cancel: 'Appointment to be cancelled',
  reschedule: 'Patient needs a different slot or doctor',
} as const;
type UndoCheckInReason = keyof typeof UNDO_CHECKIN_REASONS;

// OPD vitals captured by the nursing station. Used to detect a correction to
// already-recorded readings so the lifecycle trail can log who changed what.
const VITAL_FIELDS = [
  'BPs', 'BPd', 'pulse', 'RR', 'temp', 'spo2', 'height', 'weight', 'bloodGroup',
] as const;

let clients: Response[] = [];
const resolver = new AppointmentResolver();
const doctorRepository = new DoctorRepository();
const appointmentRepository = new AppointmentRepository();


export const registerForUpdates = (req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);

  // Remove the client if it closes the connection
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
};



// Notify all connected clients of a new appointment with 'pending' status
export const notifyPendingAppointments = (newNotification: any): void => {
  console.log('Notifying clients of new appointment:', newNotification);
  clients.forEach(client => {
    client.write(`event: appointment\n`);
    client.write(`data: ${JSON.stringify(newNotification)}\n\n`);
  });
  // console.log('Clients notified',clients);
};
export const notifyRemoveChannels = (removedId: any): void => {
  console.log('Notifying clients of remove doctor:', removedId);
  clients.forEach(client => {
    client.write(`event: channelRemoval\n`);
    client.write(`data: ${JSON.stringify(removedId)}\n\n`);
  });
};
export const notifyDoctor = (doctorId: any): void => {
  console.log('Notifying clients of checkin appt doctor:', doctorId);
  clients.forEach(client => {
    client.write(`event: loadDoctor\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
};
export const loadTv = (type: any): void => {
  console.log('Notifying clients of ad loading:', type);
  clients.forEach(client => {
    client.write(`event: loadTv\n`);
    client.write(`data: ${JSON.stringify(type)}\n\n`);
  });
};

export const messageSent = (doctorId: any): void => {
  console.log('Notifying clients of message doctor:', doctorId);
  clients.forEach(client => {
    client.write(`event: messageSent\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
}
export const adminAlertSent = (doctorId: any): void => {
  console.log('Notifying clients of message doctor:', doctorId);
  clients.forEach(client => {
    client.write(`event: adminAlertSent\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
}

// Broadcast when a doctor is marked/unmarked as "came" today so TVs re-fetch.
export const notifyDoctorAttendance = (payload: {
  doctorId: number;
  present: boolean;
  date: string;
}): void => {
  console.log('Notifying clients of doctor attendance:', payload);
  clients.forEach(client => {
    client.write(`event: doctorAttendance\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
}

// Priority feature — broadcast nurse-flagged patient priority to all SSE clients
export const notifyPriorityUpdate = (payload: {
  appointmentId: number;
  priority: string;
  reason?: string;
  setBy?: string;
  setAt?: string;
}): void => {
  console.log('Notifying clients of priority update:', payload);
  clients.forEach(client => {
    client.write(`event: priorityUpdate\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
}

// Cross-browser consultation-start broadcast — so TVs on separate devices announce next patient
export const notifyConsultationStarted = (payload: {
  doctorId: number;
  appointmentId: number;
  channelId?: number;
  patientName?: string;
  doctorName?: string;
}): void => {
  console.log('Notifying clients of consultation started:', payload);
  clients.forEach(client => {
    client.write(`event: consultationStarted\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
}

// HTTP endpoint to trigger consultation-start broadcast (called by doctor's frontend)
export const broadcastConsultationStart = (req: Request, res: Response): void => {
  const { doctorId, appointmentId, channelId, patientName, doctorName } = req.body || {};
  if (!doctorId || !appointmentId) {
    res.status(400).json({ error: 'doctorId and appointmentId required' });
    return;
  }
  notifyConsultationStarted({ doctorId, appointmentId, channelId, patientName, doctorName });
  res.json({ success: true });
}

export const loadOtTV = (doctorId: any): void => {
  console.log('Notifying clients of load ot tv:', doctorId);
  clients.forEach(client => {
    client.write(`event: loadOtTv\n`);
    client.write(`data: ${JSON.stringify(doctorId)}\n\n`);
  });
}

export const loadTherapyTv = (type: any): void => {
  console.log('Notifying clients of therapy tv  loading:', type);
  clients.forEach(client => {
    client.write(`event: loadTherapyTv\n`);
    client.write(`data: ${JSON.stringify(type)}\n\n`);
  });
}

export const loadTherapyTvForTherapist = (therapistId: number): void => {
  console.log("Notify therapist:", therapistId);

  clients.forEach(client => {
      client.write(`event: therapistUpdate\n`);
      client.write(`data: ${JSON.stringify( therapistId )}\n\n`);
  });
};


export const createAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    req.body.status = req.body.status === 'Confirm' ? 'confirmed' :
      req.body.status === 'Cancel' ? 'cancelled' : req.body.status;
    const {
      patientName,
      phoneNumber,
      doctorName,
      doctorId,
      department,
      time,
      status,
      email,
      requestVia,
      smsSent,
      emailSent,
      messageSent,
      prnNumber,
      doctorType,
      age,
      gender,
      serviceId,
      patientType,
      prefix,
      userId
    } = req.body;
    console.log(req.body, 'request');

    // Convert the date to "YYYY-MM-DD" format
    let date = new Date(req.body.date).toISOString().split('T')[0];
    console.log(date, 'selected slot is not available')

    // Doctor availability — pure read, no contention, OK outside the transaction.
    const day = new Date(req.body.date).toLocaleString('en-us', { weekday: 'short' }).toLowerCase();
    console.log(day, 'selected slot is not available request')
    if (doctorType === 'Visiting Consultant') {
      console.log('Skipping availability check for Visiting Consultant.');
    } else {
      const doctorAvailability = await doctorRepository.getDoctorAvailability(doctorId, day, date);
      console.log(doctorAvailability, 'selected slot is not available request');
      if (!doctorAvailability) {
        res.status(400).json({ error: 'Doctor is not available on the selected day.' });
        return;
      }
      const slotDuration = doctorAvailability.slotDuration;
      const availableFrom = doctorAvailability.availableFrom.split('-');
      const availableStartTime = availableFrom[0];
      const availableEndTime = availableFrom[1];
      console.log(availableStartTime, availableEndTime, 'selected slot is not available request')
    }

    // Sprint 4b.2 — attribution from JWT, not body. Route stays public (anonymous
    // website booking allowed); when there's no JWT, userId is null — same
    // behaviour as before, just body.userId is ignored.

    // Atomic: slot check + appointment create + BookedSlot create live inside one
    // transaction so a concurrent create/update cannot slip a duplicate past the check.
    // (Race-free fix still needs @@unique([doctorId,date,time]) on BookedSlot — DB
    // change deferred per ops constraint; this narrows the window to near-zero.)
    let newAppointment: any;
    try {
      // withSlotLock serializes same-slot create/reschedule across this whole controller
      // AND the standalone POST /doctors/booked-slots. Inside the lock, the tx still
      // enforces atomicity of the multi-row writes. See doctor.controller.ts withSlotLock.
      newAppointment = await withSlotLock(`${doctorId}|${date}|${time}`, async () => await prisma.$transaction(async (tx) => {
        const conflictingSlot = await tx.bookedSlot.findFirst({
          where: { doctorId, date, time, complete: false }
        });
        if (conflictingSlot) {
          throw new Error('SLOT_TAKEN');
        }
        const conflictingAppt = await tx.appointment.findFirst({
          where: { doctorId, date, time, status: 'confirmed' }
        });
        if (conflictingAppt) {
          throw new Error('SLOT_TAKEN');
        }

        const created = await tx.appointment.create({
          data: {
            patientName,
            phoneNumber,
            doctorName,
            doctorId,
            department,
            date,
            time,
            status,
            email,
            requestVia,
            smsSent,
            emailSent,
            messageSent,
            userId,
            prnNumber,
            age,
            gender,
            serviceId,
            patientType,
            prefix
          }
        });

        if (created.status === 'confirmed') {
          await tx.bookedSlot.create({
            data: {
              doctorId,
              date,
              time,
              complete: false,
              createdBy: String(userId ?? ''),
              appointmentId: created.id,
            }
          });
        }

        return created;
      }, APPOINTMENT_TX_OPTIONS));
    } catch (txErr) {
      const msg = txErr instanceof Error ? txErr.message : 'An error occurred';
      if (msg === 'SLOT_TAKEN') {
        res.status(409).json({ error: 'Selected slot is already booked' });
        return;
      }
      throw txErr;
    }

    console.log("New Appointment:", newAppointment);

    // Lifecycle trail — first row for this appointment. The route is public
    // (anonymous website booking) but carries optionalAuth, so req.user is
    // present for staff bookings and absent for anonymous ones.
    // A front-desk booking is created straight as 'confirmed'; only an online
    // request lands as 'pending'. Label the row for what actually happened —
    // it's row 1 either way, so "this was the creation" isn't lost.
    await recordAppointmentEvent(req, {
      appointmentId: newAppointment.id,
      eventType: newAppointment.status === 'confirmed' ? 'CONFIRMED' : 'REQUESTED',
      to: slotSnapshot(newAppointment),
      subject: subjectSnapshot(newAppointment),
      source: requestVia ? String(requestVia) : 'admin-panel',
    });

    if (newAppointment.status === 'pending') {
      const newNotification = await prisma.notification.create({
        data: {
          type: 'appointment_request',
          title: 'New Appointment Request',
          message: `Appointment received for ${newAppointment.doctorName} on ${newAppointment.date} at ${newAppointment.time}.`,
          entityId: newAppointment.id,
          entityType: 'appointment',
          isCritical: false,
          targetRole: 'sub_admin',
        },
      });
      console.log("New Notification:", newNotification);
      notifyPendingAppointments(newNotification);
      res.status(201).json(newAppointment);
      return;
    }

    if (newAppointment.status === 'confirmed') {
      try {
        const doctor = await doctorRepository.getDoctorById(doctorId);
        // Walk-in confirmations use the dedicated GoBuzz "walkin" template
        // (normalise so 'Walk-In' / 'walkin' / 'Walk In' all match); every other
        // request-via keeps the standard confirmed WhatsApp template.
        const isWalkin = String(requestVia || '').toLowerCase().replace(/[^a-z]/g, '') === 'walkin';
        if (isWalkin) {
          const name = `${prefix} ${patientName}`;
          // Patient — dedicated "walkin" template.
          const patientPayload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: formatGoBuzzNumber(phoneNumber),
            type: "template",
            template: {
              name: "walkin",
              language: { code: "en" },
              components: [{ type: "body", parameters: [
                { type: "text", text: String(name) },
                { type: "text", text: String(doctorName) },
                { type: "text", text: String(status) },
                { type: "text", text: formatDateYear(new Date(date)) },
                { type: "text", text: String(time) },
              ] }],
            },
          };
          await sendGoBuzzMessage(patientPayload);

          // Doctor still gets notified on walk-ins (same message as the normal
          // confirmed path — sendConfirmedWhatsApp's doctor_appts_status half).
          if (doctor?.phone_number) {
            await sendGoBuzzMessage({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: formatGoBuzzNumber(doctor.phone_number),
              type: "template",
              template: {
                name: "doctor_appts_status",
                language: { code: "en" },
                components: [{ type: "body", parameters: [
                  { type: "text", text: String(doctorName) },
                  { type: "text", text: "confirmed" },
                  { type: "text", text: String(name) },
                  { type: "text", text: String(time) },
                  { type: "text", text: formatDateYear(new Date(date)) },
                ] }],
              },
            });
          }
        } else {
          await sendConfirmedWhatsApp({
            patientName,
            doctorName,
            date,
            time,
            patientPhoneNumber: phoneNumber,
            doctorPhoneNumber: doctor?.phone_number,
            prefix
          });
        }
        await sendConfirmedSMS({
          patientName,
          doctorName,
          date,
          time,
          patientPhoneNumber: phoneNumber,
          doctorPhoneNumber: doctor?.phone_number,
          prefix
        });
      } catch (err) {
        console.error('WhatsApp/SMS failed but appointment created', err);
        // ❗ DO NOT break flow
      }
      res.status(201).json(newAppointment);
      return;
    }

    // Fallback for any other terminal status (e.g. cancelled passed through).
    res.status(201).json(newAppointment);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
function formatDateYear(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
  return `${day}-${month}-${year}`;
}
export const createNewAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if request contains an array of appointments
    const appointments = Array.isArray(req.body) ? req.body : [req.body];
    console.log(appointments)

    // Process each appointment individually
    const newAppointments = await Promise.all(
      appointments.map(async (appointment) => {
        const {
          patientName,
          phoneNumber,
          doctorName,
          doctorId,
          department,
          date,
          time,
          status,
          email,
          requestVia,
          smsSent,
          emailSent,
          messageSent,
          prnNumber,
          doctorType,
          age,
          gender,
          serviceId,
          type,
          prefix,
          patientType,
          userId
        } = appointment;



        // Atomic: slot availability check + BookedSlot insert + Appointment create.
        // Same SLOT_TAKEN guard as createAppointment so the walk-in path can't double-book either.
        // withSlotLock serializes same-slot concurrent walk-in creates with each other and
        // with the reschedule/booked-slots path. See doctor.controller.ts withSlotLock.
        const created = await withSlotLock(`${doctorId}|${date}|${time}`, async () => await prisma.$transaction(async (tx) => {
          const conflictingSlot = await tx.bookedSlot.findFirst({
            where: { doctorId, date, time, complete: false }
          });
          if (conflictingSlot) {
            throw new Error('SLOT_TAKEN');
          }
          const conflictingAppt = await tx.appointment.findFirst({
            where: { doctorId, date, time, status: 'confirmed' }
          });
          if (conflictingAppt) {
            throw new Error('SLOT_TAKEN');
          }

          // Appointment first so the slot can record which one owns it; both
          // writes are in the same transaction, so the ordering is invisible
          // to anyone else and the SLOT_TAKEN guards above still apply.
          const createdAppointment = await tx.appointment.create({
            data: {
              patientName,
              phoneNumber,
              doctorName,
              doctorId,
              department,
              date,
              time,
              status,
              email,
              messageSent,
              emailSent,
              smsSent: true,
              userId: appointment.userId || null,
              prnNumber,
              age,
              gender,
              serviceId,
              type,
              requestVia: 'Walk-In',
              prefix,
              patientType
            }
          });

          await tx.bookedSlot.create({
            data: {
              doctorId,
              date,
              time,
              complete: false,
              createdBy: String(userId ?? ''),
              appointmentId: createdAppointment.id,
            }
          });

          return createdAppointment;
        }, APPOINTMENT_TX_OPTIONS));

        await recordAppointmentEvent(req, {
          appointmentId: created.id,
          eventType: created.status === 'confirmed' ? 'CONFIRMED' : 'REQUESTED',
          to: slotSnapshot(created),
          subject: subjectSnapshot(created),
          source: 'walk-in',
        });

        // WhatsApp fired AFTER the transaction commits — never inside a transaction.
        // Failure here doesn't roll the appointment back (matches prior behaviour).
        const name = `${prefix} ${patientName}`;
        try {
          const url = process.env.WHATSAPP_API_URL;
          const headers = {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN,
          };
          const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
          // ===== Pinnacle (commented out — migrated to GoBuzz) =====
          // const patientPayload = {
          //   from: fromPhoneNumber,
          //   to: phoneNumber,
          //   type: "template",
          //   message: { templateid: "750561", placeholders: [name, doctorName, status, formatDateYear(new Date(date)), time] },
          // };
          // await axios.post(url!, patientPayload, { headers });
          // ===== GoBuzz (walkin) =====
          const patientPayload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: formatGoBuzzNumber(phoneNumber),
            type: "template",
            template: {
              name: "walkin",
              language: { code: "en" },
              components: [{ type: "body", parameters: [
                { type: "text", text: String(name) },
                { type: "text", text: String(doctorName) },
                { type: "text", text: String(status) },
                { type: "text", text: formatDateYear(new Date(date)) },
                { type: "text", text: String(time) },
              ] }],
            },
          };
          await sendGoBuzzMessage(patientPayload);
        } catch (waErr) {
          console.error('WhatsApp send failed in createNewAppointment (appointment already created):', waErr);
          // Don't break the flow — appointment is already in DB.
        }

        return created;
      })

    );

    res.status(201).json(newAppointments);


  } catch (error) {
    const msg = error instanceof Error ? error.message : 'An error occurred';
    if (msg === 'SLOT_TAKEN') {
      res.status(409).json({ error: 'Selected slot is already booked' });
      return;
    }
    res.status(500).json({ error: msg });
  }
};

export const getAllNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany();
    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while fetching notifications' });
  }
}
// Delete a notification by ID
export const deleteNotification = async (req: Request, res: Response): Promise<void> => {
  const notificationId = parseInt(req.params.id, 10);

  try {
    await prisma.notification.delete({
      where: {
        id: notificationId,
      },
    });
    res.status(200).json({ message: 'Notification deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while deleting the notification' });
  }
};
export const getNotificationsByRole = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.query.userId); // Get user ID from query params
    const isReceptionist = req.query.isReceptionist === 'true'; // Check if the user is a receptionist

    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        OR: [
          { type: 'appointment_request' }, // Everyone gets appointment requests
          ...(isReceptionist
            ? [{ type: 'appointment_remainder' }] // Receptionists also get remainders
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' }, // Sort by most recent
    });

    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};


export const getAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointments = await resolver.getAppointments();
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const updateAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    // Sprint 4b.2 — attribution from JWT, not body. authenticateToken guarantees req.user.
    const userId = req.user?.id ?? null;
    // Destructure and remove unnecessary nested objects before updating.
    // `userId` is also destructured off so the body value cannot leak in via ...updateData.
    // checkedInTime / checkedInBy are ONLY set by the dedicated /checkin endpoint;
    // strip them here so a generic PUT (which sends the whole appointment, with these
    // still null pre-check-in) can never overwrite the check-in stamp.
    // rescheduleCount / cancelled* / cancelReason are owned by the lifecycle
    // trail (service/appointment-event.ts). The UI PUTs the whole appointment
    // back, so strip them here or a stale echo would clobber the real values.
    const {
      id, doctor, user, userId: _bodyUserId,
      checkedInTime: _checkedInTime, checkedInBy: _checkedInBy,
      rescheduleCount: _rescheduleCount, cancelledBy: _cancelledBy,
      cancelledById: _cancelledById, cancelledAt: _cancelledAt,
      cancelReason: _cancelReason, events: _events,
      // Vitals attribution is stamped from the JWT below, never from the body —
      // the nursing screen used to send a typed-in employee id that nothing
      // verified.
      arrivedBy: _arrivedBy, arrivedTime: _arrivedTime,
      ...updateData
    } = req.body;
    // Free-text reason the UI may send alongside a cancel/reschedule. Recorded
    // on the event, not on the appointment row.
    const changeReason: string | null = req.body.changeReason ?? req.body.cancelReason ?? null;
    delete updateData.changeReason;
    console.log("updateDatsa", updateData)

    // Include userId if present (from JWT).
    if (userId) {
      updateData.userId = userId;
    }

    const appointmentId = Number(req.params.id);

    // Whole flow is transactional so the slot check + appointment write + BookedSlot
    // move/create cannot interleave with another concurrent update or create.
    // (Race-free fix still needs @@unique([doctorId,date,time]) on BookedSlot — DB change
    // deferred per ops constraint; this transaction narrows the window to near-zero.)
    // Set inside the transaction when this PUT is the one that captured vitals.
    let vitalsRecorded = false;

    // The transaction hands back BOTH rows: assigning `existing` to an outer
    // variable instead would have TypeScript narrow it to `null`, since it
    // can't see an assignment made inside the callback.
    const txResult = await prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!existing) {
        throw new Error('APPT_NOT_FOUND');
      }

      const newDoctorId = updateData.doctorId ?? existing.doctorId;
      const newDate = updateData.date ?? existing.date;
      const newTime = updateData.time ?? existing.time;
      const finalStatus = updateData.status ?? existing.status;

      const slotChanged = (
        newDoctorId !== existing.doctorId ||
        newDate !== existing.date ||
        newTime !== existing.time
      );

      // Pre-check: only reject if ANOTHER confirmed Appointment already occupies the
      // new slot. Do NOT also reject on BookedSlot existence — the frontend reschedule
      // flow pre-creates the BookedSlot at the new time via a separate POST
      // /doctors/booked-slots BEFORE this PUT runs, so a BookedSlot at the new slot is
      // expected and belongs to this same reschedule. A genuine double-book is caught by
      // the standalone addBookedSlot controller at step 1; if that succeeded, the slot
      // was free at the time the frontend reserved it.
      if (slotChanged && finalStatus === 'confirmed' && newDoctorId && newDate && newTime) {
        const conflictingAppt = await tx.appointment.findFirst({
          where: {
            doctorId: newDoctorId,
            date: newDate,
            time: newTime,
            status: 'confirmed',
            NOT: { id: appointmentId },
          }
        });
        if (conflictingAppt) {
          throw new Error('SLOT_TAKEN');
        }
      }

      // Vitals capture (nursing screen) stamps who recorded them, from the JWT.
      // Only on the TRANSITION to arrived: the UI PUTs the whole appointment on
      // every edit, so without this guard a later save would re-attribute the
      // vitals to whoever edited last.
      vitalsRecorded = updateData.arrived === true && existing.arrived !== true;
      if (vitalsRecorded) {
        updateData.arrivedBy = req.user?.username ?? null;
        updateData.arrivedTime = new Date();
      }

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: updateData,
      });

      // Maintain BookedSlot in sync with the appointment's confirmed slot.
      // Slot moved: drop any BookedSlot at the old (doctorId,date,time) regardless of
      // the prior status. If no row exists there, this is a harmless no-op; if one does
      // (created e.g. by a separate booked-slots POST from the UI), we want it gone so
      // the old time becomes available again.
      if (slotChanged && existing.doctorId && existing.date && existing.time) {
        // Release only THIS appointment's hold on the old slot. Matching on
        // (doctorId, date, time) alone used to delete every row at that time,
        // so rescheduling one patient freed another patient's confirmed slot.
        // `appointmentId: null` covers rows written before the column existed
        // and reservations the UI made before the appointment claimed them.
        const cleared = await tx.bookedSlot.deleteMany({
          where: {
            doctorId: existing.doctorId,
            date: existing.date,
            time: existing.time,
            OR: [{ appointmentId: appointmentId }, { appointmentId: null }],
          }
        });
        console.log(`Booked slot deleteMany on reschedule: Doctor ${existing.doctorId}, ${existing.date} ${existing.time} — cleared ${cleared.count} row(s)`);
      }
      if (finalStatus === 'confirmed' && updated.doctorId && updated.date && updated.time) {
        // Ensure a BookedSlot exists at the new (or unchanged) slot, in two
        // queries rather than three — this runs inside the transaction, and on
        // a remote database every round-trip counts against the timeout.
        //
        // The updateMany both CLAIMS an ownerless reservation (the reschedule
        // UI creates one via POST /doctors/booked-slots before this PUT) and
        // no-ops harmlessly when this appointment already owns the row. A row
        // owned by a DIFFERENT appointment is left alone and reports 0, but the
        // conflicting-appointment check above has already rejected that case.
        const claimed = await tx.bookedSlot.updateMany({
          where: {
            doctorId: updated.doctorId, date: updated.date, time: updated.time,
            OR: [{ appointmentId: updated.id }, { appointmentId: null }],
          },
          data: { appointmentId: updated.id },
        });
        if (claimed.count === 0) {
          await tx.bookedSlot.create({
            data: {
              doctorId: updated.doctorId,
              date: updated.date,
              time: updated.time,
              complete: false,
              createdBy: String(userId ?? ''),
              appointmentId: updated.id,
            }
          });
          console.log(`Booked slot created on confirmation: Doctor ${updated.doctorId}, ${updated.date} ${updated.time}`);
        } else {
          console.log(`Booked slot held by appointment ${updated.id}: Doctor ${updated.doctorId}, ${updated.date} ${updated.time} (${claimed.count} row(s))`);
        }
      }

      return { updated, existing };
    }, APPOINTMENT_TX_OPTIONS);

    const result = txResult.updated;
    const before = txResult.existing;

    // A correction to already-captured vitals. arrivedBy/arrivedTime keep
    // pointing at the ORIGINAL capture (they're stripped from the body and only
    // stamped on the transition), so this event is the only record of who
    // changed what — without it a mis-keyed reading could be rewritten silently.
    if (!vitalsRecorded && before && result && before.arrived === true) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of VITAL_FIELDS) {
        const from = (before as Record<string, any>)[field];
        const to = (result as Record<string, any>)[field];
        if (from !== to) changes[field] = { from, to };
      }
      if (Object.keys(changes).length > 0) {
        await recordAppointmentEvent(req, {
          appointmentId: result.id,
          eventType: 'VITALS_UPDATED',
          to: slotSnapshot(result),
          subject: subjectSnapshot(result),
          source: 'nursing-station',
          payload: {
            changes,
            originallyRecordedBy: before.arrivedBy,
            originallyRecordedAt: before.arrivedTime,
          },
        });
      }
    }

    // Vitals capture gets its own row so the history answers "who took the
    // vitals and when" — the readings go in the payload rather than the
    // slot columns, which describe scheduling moves.
    if (vitalsRecorded && result) {
      await recordAppointmentEvent(req, {
        appointmentId: result.id,
        eventType: 'VITALS_RECORDED',
        to: slotSnapshot(result),
        subject: subjectSnapshot(result),
        source: 'nursing-station',
        payload: {
          BPs: result.BPs, BPd: result.BPd, pulse: result.pulse, RR: result.RR,
          temp: result.temp, spo2: result.spo2,
          height: result.height, weight: result.weight,
          bloodGroup: result.bloodGroup,
          blockId: result.blockId,
        },
      });
    }

    // Lifecycle trail. A generic PUT carries every field the popup holds, so
    // only slot/status moves are recorded — vitals, waiting time and payment
    // edits would otherwise bury the reschedule history.
    if (before && result) {
      const eventType = classifyAppointmentChange(slotSnapshot(before), slotSnapshot(result));
      if (eventType) {
        await recordAppointmentEvent(req, {
          appointmentId: result.id,
          eventType,
          from: slotSnapshot(before),
          to: slotSnapshot(result),
          subject: subjectSnapshot(result),
          source: 'admin-panel',
          reason: changeReason,
        });
      }
    }

    // WhatsApp: confirm / cancel the appointment for the patient (de-duped, and
    // a no-op while WHATSAPP_PUSH_ENABLED is off). Never blocks the response.
    if (result?.status === 'confirmed') {
      notifyAppointmentConfirmed(
        result.prnNumber ?? null, result.phoneNumber, result.patientName,
        result.doctorName, result.date, result.time, `${result.id}:confirmed`,
      ).catch((e: unknown) => console.warn('[appointment] whatsapp confirm push failed:', (e as Error).message));
    } else if (result?.status === 'cancelled') {
      notifyAppointmentCancelled(
        result.prnNumber ?? null, result.phoneNumber, result.patientName,
        result.doctorName, result.date, `${result.id}:cancelled`,
      ).catch((e: unknown) => console.warn('[appointment] whatsapp cancel push failed:', (e as Error).message));
    }

    res.status(200).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'An error occurred';
    if (msg === 'SLOT_TAKEN') {
      res.status(409).json({ error: 'Selected slot is already booked' });
      return;
    }
    if (msg === 'APPT_NOT_FOUND') {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    res.status(500).json({ error: msg });
  }
};

export const updateExtraWaitingTime = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { waitingTime } = req.body;
  console.log(waitingTime)
  try {
    // Update the checkedIn status for the specified appointment
    const updatedAppointment = await prisma.appointment.update({
      where: {
        id: Number(id),
      },
      data: {
        extraWaitingTime: waitingTime
      },
    });

    res.status(200).json({ message: 'Appointment checked in successfully', updatedAppointment });
  } catch (error) {
    console.error('Error updating check-in status:', error);
    res.status(500).json({ error: 'An error occurred while updating the check-in status' });
  }
}


export const deleteAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);
    // AppointmentEvent rows cascade away with the appointment, so the tombstone
    // goes to the generic audit table instead of the lifecycle trail.
    const doomed = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    await resolver.deleteAppointment(appointmentId);
    await auditLog(req, {
      module: 'appointment',
      action: 'DELETE',
      entityType: 'Appointment',
      entityId: appointmentId,
      payload: doomed
        ? {
            patientName: doomed.patientName,
            prnNumber: doomed.prnNumber,
            doctorName: doomed.doctorName,
            date: doomed.date,
            time: doomed.time,
            status: doomed.status,
            rescheduleCount: doomed.rescheduleCount,
          }
        : null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// Endpoint to get total appointments for today
export const getTotalAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query; // Get today's date from query parameters
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const count = await appointmentRepository.getAppointmentsCountForDate(date as string);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
export const getCheckinAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query; // Get today's date from query parameters
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }
    const count = await appointmentRepository.getCheckinAppointments(date as string);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
// Endpoint to get pending requests for today
export const getPendingAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query;
    const count = await appointmentRepository.getPendingAppointmentsCountForDate(date as string);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
export const getAppointmentsByUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, status } = req.query;

    // Find appointments filtered by userId and optionally by status
    const appointments = await appointmentRepository.findAppointmentsByUser(
      Number(userId),
      status ? status.toString() : undefined
    );

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
export const getDoctorReport = async (req: Request, res: Response): Promise<void> => {
  console.log("userId", req.query);
  try {
    const userId = req.query.userId ? Number(req.query.userId) : null;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    const report = await resolver.getDoctorReport(userId);
    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const getDoctorTodayReport = async (req: Request, res: Response): Promise<void> => {
  console.log("userId", req.query);
  try {
    const userId = req.query.userId ? Number(req.query.userId) : null;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    const report = await resolver.getDoctorTodayReport(userId);
    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const lockAppointment = async (req: Request, res: Response): Promise<void> => {
  console.log(req.body)
  try {
    const appointmentId = Number(req.params.id);
    // Sprint 4b.2 — lock attribution from JWT, not body. authenticateToken guarantees req.user.
    const userIdNum = req.user?.id ?? NaN;
    if (!Number.isFinite(userIdNum) || userIdNum <= 0) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    console.log(appointmentId, userIdNum)
    const appointment = await appointmentRepository.getAppointmentById(appointmentId);
    if (!appointment) {
      res.status(404).json({ message: 'Appointment not found' });
      return;
    }
    console.log(appointment.lockedBy);
    // if (appointment.lockedBy && appointment.lockedBy !== userId) {
    //   res.status(423).json({ message: 'Appointment is currently locked by another user.' });
    //   return;
    // }
    const lockResult = await resolver.lockAppointment(appointmentId, userIdNum);

    if (lockResult.locked) {
      res.status(409).json({
        message: `Appointment is currently locked by ${lockResult.lockedByUsername}.`,
        lockedByUserId: lockResult.lockedByUserId,
        lockedByUsername: lockResult.lockedByUsername,
      });
      return;
    }

    // If not locked by someone else
    res.status(200).json(lockResult.data);

  } catch (error) {
    console.error('Error locking appointment:', error);
    res.status(500).json({ error: 'Failed to lock appointment' });
  }
};
export const scheduleCompletion = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);
    const delayMinutes = req.body.delayMinutes;

    if (!delayMinutes || isNaN(delayMinutes)) {
      res.status(400).json({ message: 'Invalid delay minutes' });
      return;
    }
    console.log(appointmentId, delayMinutes)
    await resolver.scheduleAppointmentCompletion(appointmentId, delayMinutes);
    res.status(200).json({ message: 'Appointment completion scheduled successfully' });
  } catch (error) {
    console.error('Error scheduling appointment completion:', error);
    res.status(500).json({ error: 'Failed to schedule appointment completion' });
  }
};
// Controller function to handle the check-in action
export const checkInAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, prnNumber: rawPrn } = req.body;

  // PRN entered in the check-in popup because the appointment was booked
  // without one. Only sent in that case — see appointment-confirm.component.
  let capturedPrn: number | null = null;
  if (rawPrn !== undefined && rawPrn !== null && String(rawPrn).trim() !== '') {
    const parsed = Number(String(rawPrn).trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      res.status(400).json({ error: 'prnNumber must be a positive whole number' });
      return;
    }
    capturedPrn = parsed;
  }

  const usEasternTime = moment.tz("America/New_York");

  console.log(id, username)

  // Convert US Eastern Time to Indian Standard Time (IST)
  const indianTime = usEasternTime.clone().tz("Asia/Kolkata").toDate();
  console.log(indianTime, 'indianTime')
  const appointment = await prisma.appointment.findUnique({
    where: { id: Number(id) },
    include: { doctor: true }, // Fetch doctor details
  });

  if (!appointment) {
    res.status(404).json({ error: "Appointment not found" });
    return
  }

  try {
    // Phase 2.5 (WF-1) — when the appointment.type is 'paid', also stamp the
    // payment fields so the revenue rollup picks it up. Reception only sees a
    // single "Check-in" button; the type=paid|free|concession is set just
    // before this endpoint fires by the updateAppointment call from the popup.
    const isPaidType = (appointment.type ?? '').toLowerCase() === 'paid';

    // PRN captured at check-in → correct the booking's name/age/gender from
    // the registered patient record. Done here rather than in the popup
    // because the UI PUTs the whole appointment object just before calling
    // /checkin; an earlier sync would be overwritten by that stale copy.
    // Blank values on the patient record never replace booking data. An
    // unknown PRN is still saved, and check-in proceeds unchanged.
    const demographics: { patientName?: string; age?: string; gender?: string } = {};
    let patientRecordFound = false;
    if (capturedPrn !== null) {
      const patient = await prisma.patientDetails.findUnique({
        where: { prn: capturedPrn },
        select: { name: true, age: true, gender: true },
      });
      if (patient) {
        patientRecordFound = true;
        const nonBlank = (value: string | null) => (value && value.trim() ? value.trim() : undefined);
        const name = nonBlank(patient.name);
        const age = nonBlank(patient.age);
        const gender = nonBlank(patient.gender);
        if (name) demographics.patientName = name;
        if (age) demographics.age = age;
        if (gender) demographics.gender = gender;
      }
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: Number(id) },
      data: {
        checkedIn: true,
        checkedInTime: new Date(),
        checkedInBy: username,
        ...(capturedPrn !== null && { prnNumber: capturedPrn }),
        ...demographics,
        ...(isPaidType && !appointment.paidAt && {
          paymentStatus: 'paid',
          paidAt: new Date(),
          paymentSource: 'cash-counter',
        }),
      },
    });
    await recordAppointmentEvent(req, {
      appointmentId: updatedAppointment.id,
      eventType: 'CHECKED_IN',
      to: slotSnapshot(updatedAppointment),
      subject: subjectSnapshot(updatedAppointment),
      source: 'admin-panel',
      // `username` comes from the body on this endpoint (front-desk operator),
      // which can differ from the JWT holder — keep it.
      payload: {
        checkedInBy: username,
        paymentStamped: isPaidType && !appointment.paidAt,
        // The visit type is picked in the check-in popup and saved by the PUT
        // that runs just before this endpoint, so the row already carries it
        // here. Recorded so undo-checkin can clear what this flow entered.
        typeAtCheckin: appointment.type,
        ...(capturedPrn !== null && {
          prnCapturedAtCheckin: capturedPrn,
          patientRecordFound,
          demographicsBefore: {
            patientName: appointment.patientName,
            age: appointment.age,
            gender: appointment.gender,
          },
          demographicsApplied: demographics,
        }),
      },
    });
    notifyDoctor(appointment.doctorId);
    res.status(200).json({ message: 'Appointment checked in successfully', updatedAppointment });
  } catch (error) {
    console.error('Error updating check-in status:', error);
    res.status(500).json({ error: 'An error occurred while updating the check-in status' });
  }
};

// AppAuditLog key for a confirmed visit-summary WhatsApp send. The rows are the
// send history: their count per appointment picks the initial vs "updated"
// template, and they persist across redeploys with no migration.
const VISIT_SUMMARY_SEND_AUDIT = {
  module: 'opd-visit-summary',
  action: 'WHATSAPP_SENT',
  entityType: 'Appointment',
} as const;

// Send an OPD visit-summary PDF (built on the frontend with pdfmake) to the
// patient over WhatsApp — mirrors the estimation flow: save the PDF bytes to
// local storage, upload them to GoBuzz to get a media id, then send a template
// message with a document header. The frontend passes the finished PDF as base64.
//
// The caller only chooses WHICH visit. The recipient's number and name come
// from the appointment and the registered patient record, so a clinical
// document can't be pointed at an arbitrary phone.
export const sendVisitSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { appointmentId: rawAppointmentId, pdfBase64 } = req.body;
    const appointmentId = Number(rawAppointmentId);
    if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0 || !pdfBase64) {
      res.status(400).json({ error: 'appointmentId and pdfBase64 are required' });
      return;
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, prnNumber: true, patientName: true, phoneNumber: true, date: true, doctorName: true },
    });
    if (!appointment) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    if (!appointment.prnNumber) {
      res.status(400).json({ error: 'This appointment has no PRN — capture it before sending the visit summary' });
      return;
    }

    const patient = await prisma.patientDetails.findUnique({
      where: { prn: appointment.prnNumber },
      select: { name: true, mobileNo: true },
    });
    const nonBlank = (value: string | null | undefined) => (value && value.trim() ? value.trim() : undefined);
    // Registered number first — the booking number may be whoever phoned in.
    const patientPhoneNumber = nonBlank(patient?.mobileNo) ?? nonBlank(appointment.phoneNumber);
    const patientName = nonBlank(patient?.name) ?? nonBlank(appointment.patientName) ?? 'Patient';
    if (!patientPhoneNumber) {
      res.status(400).json({ error: 'No phone number on record for this patient' });
      return;
    }

    // "…consultation note from {{Doctor_Name}}" — the doctor who wrote this
    // visit's note, else the booked consultant. Sent exactly as stored: the
    // template carries no "Dr." of its own.
    const assessment = await prisma.oPDAssessment.findFirst({
      where: { appointmentId: appointment.id },
      orderBy: { id: 'desc' },
      select: { doctorName: true, consultant: true },
    });
    const doctorName =
      nonBlank(assessment?.doctorName) ?? nonBlank(assessment?.consultant) ?? nonBlank(appointment.doctorName);
    if (!doctorName) {
      res.status(400).json({ error: 'No doctor name on record for this visit' });
      return;
    }

    // Accept a raw base64 string or a data: URI.
    const base64 = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      res.status(400).json({ error: 'pdfBase64 is not a PDF document' });
      return;
    }

    // First send for this visit uses the initial template; any later send
    // (updated notes) uses the "updated" template.
    const previousSends = await prisma.appAuditLog.count({
      where: { ...VISIT_SUMMARY_SEND_AUDIT, entityId: String(appointment.id) },
    });
    const alreadySent = previousSends > 0;

    const firstTemplate = process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME;
    const updateTemplate = process.env.GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_NAME;
    // Fall back to the first template if the "updated" one isn't configured yet.
    const templateName = alreadySent ? (updateTemplate || firstTemplate) : firstTemplate;
    if (!templateName) {
      res.status(500).json({
        error: `OPD summary WhatsApp template not configured (set ${alreadySent ? 'GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_NAME' : 'GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME'})`,
      });
      return;
    }
    const templateLang = alreadySent
      ? (process.env.GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_LANG || process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_LANG || 'en')
      : (process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_LANG || 'en');

    // /files is served publicly (express.static + nginx alias), so the stored
    // copy gets an unguessable name — `VisitSummary_<prn>_<date>.pdf` would let
    // anyone enumerate patients' clinical notes. The patient sees the plain name.
    const displayName = `VisitSummary_${appointment.date}.pdf`;
    const storedName = `VisitSummary_${appointment.prnNumber}_${appointment.date}_${crypto.randomUUID()}.pdf`;
    const stored = saveBufferToStorage(buffer, 'opd-summaries', storedName);
    const mediaId = await uploadMediaToGoBuzz(stored.filePath);

    // Body variables in template order: patient name, doctor name. Sent
    // positionally unless GOBUZZ_OPD_SUMMARY_PARAM_NAMES lists the template's
    // named variables (e.g. "Patient_Name,Doctor_Name").
    const bodyParamNames = (process.env.GOBUZZ_OPD_SUMMARY_PARAM_NAMES || '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const response = await sendDocumentTemplate({
      to: formatGoBuzzPhone(patientPhoneNumber),
      templateName,
      templateLang,
      mediaId,
      filename: displayName,
      bodyParams: [patientName, doctorName],
      ...(bodyParamNames.length ? { bodyParamNames } : {}),
    });

    const messageId = response.data?.messages?.[0]?.id;
    if (messageId) {
      const sentTo = `******${patientPhoneNumber.replace(/\D/g, '').slice(-4)}`;
      // Only recorded on a confirmed send, so a failed first attempt still
      // counts as "first". auditLog never throws; if the row can't be written
      // the next send simply reuses the initial template.
      await auditLog(req, {
        ...VISIT_SUMMARY_SEND_AUDIT,
        entityId: appointment.id,
        payload: {
          prn: appointment.prnNumber,
          date: appointment.date,
          template: alreadySent ? 'updated' : 'initial',
          templateName,
          sentTo,
          messageId,
          storedFile: stored.relativeUrl,
        },
      });
      res.status(200).json({
        success: true,
        template: alreadySent ? 'updated' : 'initial',
        sentTo,
        url: stored.relativeUrl,
        whatsapp: response.data,
      });
    } else {
      console.error('GoBuzz send-visit-summary unexpected response:', response.data);
      res.status(502).json({ success: false, error: 'GoBuzz WhatsApp send failed', whatsapp: response.data });
    }
  } catch (error) {
    // GoBuzz rejections arrive as axios errors whose useful part (e.g. a
    // template-variable mismatch) is in the response body, not the message.
    const gobuzz = (error as any)?.response?.data;
    if (gobuzz) {
      console.error('send-visit-summary GoBuzz rejection:', JSON.stringify(gobuzz));
      const reason =
        gobuzz?.error?.error_data?.details || gobuzz?.error?.message || gobuzz?.message || JSON.stringify(gobuzz);
      res.status(502).json({ error: `WhatsApp send rejected: ${String(reason).slice(0, 300)}`, whatsapp: gobuzz });
      return;
    }
    console.error('send-visit-summary error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

export const unlockAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);

    const unlockedAppointment = await resolver.unlockAppointment(appointmentId);
    res.status(200).json(unlockedAppointment);
  } catch (error) {
    console.error('Error unlocking appointment:', error);
    res.status(500).json({ error: 'Failed to unlock appointment' });
  }
};
export const getAppointmentsBySlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date, time } = req.query;

    if (!doctorId || !date || !time) {
      res.status(400).json({ error: 'Doctor ID, date, and time are required' });
      return;
    }

    const appointments = await appointmentRepository.getAppointmentsBySlot(
      Number(doctorId),
      date as string,
      time as string
    );

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const bulkUpdateAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentsToUpdate = req.body; // The array of appointments to update
    console.log(appointmentsToUpdate, 'appointments')
    if (appointmentsToUpdate.length === 0) {
      res.status(400).json({ error: 'No appointments selected for update.' });
      return;
    }
    const doctorName = appointmentsToUpdate[0].doctorName
    const doctorId = appointmentsToUpdate[0].doctorId
    const doctor = await prisma.doctor.findFirst({ where: { id: doctorId } });
    const updatePromises = appointmentsToUpdate.map((appointment: { id: number }) =>
      prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          isCloseOPD: true,
          isCloseOPDTime: new Date(), // Set current time
        }
      })

    );

    // Wait for all update promises to resolve
    const closedAppointments = await Promise.all(updatePromises)

    for (const closed of closedAppointments) {
      await recordAppointmentEvent(req, {
        appointmentId: closed.id,
        eventType: 'OPD_CLOSED',
        to: slotSnapshot(closed),
        subject: subjectSnapshot(closed),
        source: 'admin-panel',
      });
    }

    // ===== Pinnacle (commented out — migrated to GoBuzz) =====
    // const url = process.env.WHATSAPP_API_URL_BULK;
    // const headers = {
    //   "Content-Type": "application/json",
    //   apikey: process.env.WHATSAPP_AUTH_TOKEN,
    // };
    // const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

    // ===== Pinnacle (commented out — migrated to GoBuzz) =====
    // const whatsappPayload = {
    //   from: fromPhoneNumber,
    //   to: ['919880544866', '916364833988'],
    //   type: "template",
    //   message: { templateid: "738055", placeholders: [doctorName, appointmentsToUpdate.length, doctor?.roomNo] },
    // };
    // await axios.post(url!, whatsappPayload, { headers });
    // ===== GoBuzz (close_opd) — single-recipient, loop over DB recipients =====
    const closeOpdRecipients = await getRecipientPhones('appointment_confirm');
    for (const recipient of closeOpdRecipients) {
      const whatsappPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formatGoBuzzNumber(recipient),
        type: "template",
        template: {
          name: "close_opd",
          language: { code: "en" },
          components: [{ type: "body", parameters: [
            { type: "text", text: String(doctorName) },
            { type: "text", text: String(appointmentsToUpdate.length) },
            { type: "text", text: String(doctor?.roomNo ?? "") },
          ] }],
        },
      };
      try {
        await sendGoBuzzMessage(whatsappPayload);
      } catch (error) {
        console.error("Error sending WhatsApp message:", error);
      }
    }
    res.status(200).json({ message: 'Appointments updated successfully', updatePromises });

  } catch (error) {
    console.error('Error updating appointments:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// export const bulkUpdateAccepted = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const appointmentsToUpdate = req.body; // The array of appointments to update
//     console.log(appointmentsToUpdate,'appointments of accept')
//     if (appointmentsToUpdate.length === 0) {
//        res.status(400).json({ error: 'No appointments selected for update.' });
//        return;
//     }
//     const timeGap = app
//     const updatePromises = appointmentsToUpdate.map((appointment: { id: number }) => 
//       prisma.appointment.update({
//         where: { id: appointment.id },
//         data: {
//           isAccepted: true,
//           isAcceptedCloseTime: new Date(), // Set current time
//           status: 'pending'
//         }
//       })
//     );

//     // Wait for all update promises to resolve
//     await Promise.all(updatePromises)

//     res.status(200).json({ message: 'Appointments updated successfully', updatePromises });
//   } catch (error) {
//     console.error('Error updating appointments:', error);
//     res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
//   }
// };

export const bulkUpdateAccepted = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentsToUpdate = req.body; // The array of appointments to update
    console.log(appointmentsToUpdate, 'appointments of accept');

    if (appointmentsToUpdate.length === 0) {
      res.status(400).json({ error: 'No appointments selected for update.' });
      return;
    }

    const updatePromises = appointmentsToUpdate.map(async (appointment: { id: number }) => {
      // Fetch the current appointment data to get `isCloseOPDTime`
      const existingAppointment = await prisma.appointment.findUnique({
        where: { id: appointment.id },
        select: { isCloseOPDTime: true }, // Fetch only the required field
      });

      if (!existingAppointment || !existingAppointment.isCloseOPDTime) {
        console.warn(`Appointment ID ${appointment.id} has no isCloseOPDTime`);
        return null; // Skip update if isCloseOPDTime is missing
      }

      const isAcceptedCloseTime = new Date();
      const timeGap = isAcceptedCloseTime.getTime() - new Date(existingAppointment.isCloseOPDTime).getTime();

      return prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          isAccepted: true,
          isAcceptedCloseTime,
          timeGap: timeGap.toString(), // Store the time difference
        },
      });
    });

    // Wait for all update promises to resolve
    const results = await Promise.all(updatePromises);

    res.status(200).json({ message: 'Appointments updated successfully', results });
  } catch (error) {
    console.error('Error updating appointments:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
// export const bulkUpdateCancel = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const appointmentsToUpdate = req.body; // The array of appointments to update
//     console.log(appointmentsToUpdate, 'appointments of accept');

//     if (appointmentsToUpdate.length === 0) {
//       res.status(400).json({ error: 'No appointments selected for update.' });
//       return;
//     }

//     const updatePromises = appointmentsToUpdate.map(async (appointment: { id: number }) => {
//       // Fetch the current appointment data to get `isCloseOPDTime`
//       const existingAppointment = await prisma.appointment.findUnique({
//         where: { id: appointment.id },
//       });

//       if (!existingAppointment) {
//         console.warn(`Appointment ID ${appointment.id} has no cancelled`);
//         return null; // Skip update if isCloseOPDTime is missing
//       }


//       return prisma.appointment.update({
//         where: { id: appointment.id },
//         data: {
//           status: 'cancelled'
//         },
//       });
//     });

//     // Wait for all update promises to resolve
//     const results = await Promise.all(updatePromises);

//     res.status(200).json({ message: 'Appointments updated successfully', results });
//   } catch (error) {
//     console.error('Error updating appointments:', error);
//     res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
//   }
// };

export const bulkUpdateCancel = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentsToUpdate = req.body; // Array of appointments to update
    console.log(appointmentsToUpdate, 'appointments for cancellation');

    if (appointmentsToUpdate.length === 0) {
      res.status(400).json({ error: 'No appointments selected for update.' });
      return;
    }

    const url = process.env.WHATSAPP_API_URL;
    const headers = {
      "Content-Type": "application/json",
      apikey: process.env.WHATSAPP_AUTH_TOKEN,
    };
    const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;

    const updatePromises = appointmentsToUpdate.map(async (appointment: { id: number, doctorId: number, date: string, time: string, cancelReason?: string }) => {
      // Fetch appointment details to get the patient and doctor info
      const existingAppointment = await prisma.appointment.findUnique({
        where: { id: appointment.id },
        include: { doctor: true }, // Fetch doctor details
      });

      if (!existingAppointment) {
        console.warn(`Appointment ID ${appointment.id} not found`);
        return null;
      }

      const { doctorId, date, time, phoneNumber, patientName, doctor, prefix } = existingAppointment;

      // **Cancel the booked slot** — this appointment's hold only, so a bulk
      // cancel can't free a slot another patient still holds.
      await prisma.bookedSlot.deleteMany({
        where: {
          doctorId, date, time,
          OR: [{ appointmentId: appointment.id }, { appointmentId: null }],
        },
      });

      console.log(`Slot cancelled for Doctor ID: ${doctorId}, Date: ${date}, Time: ${time}`);

      // **Update appointment status to "cancelled"**
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "cancelled" },
      });

      console.log(`Updated appointment status to cancelled for Appointment ID: ${appointment.id}`);

      await recordAppointmentEvent(req, {
        appointmentId: appointment.id,
        eventType: 'CANCELLED',
        from: slotSnapshot(existingAppointment),
        to: { ...slotSnapshot(existingAppointment), status: 'cancelled' },
        subject: subjectSnapshot(existingAppointment),
        source: 'admin-panel',
        reason: appointment.cancelReason ?? 'Bulk cancellation (doctor unavailable)',
      });

      const name = prefix + ' ' + existingAppointment.patientName;
      // **Send WhatsApp message to patient**
      // ===== Pinnacle (commented out — migrated to GoBuzz) =====
      // const patientMessagePayload = {
      //   from: fromPhoneNumber,
      //   to: phoneNumber,
      //   type: "template",
      //   message: { templateid: "790519", placeholders: [name, doctor?.name, time, formatDateYear(new Date(date))] },
      // };
      // await axios.post(url!, patientMessagePayload, { headers });
      // ===== GoBuzz (patient_cancel_message) =====
      const patientMessagePayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formatGoBuzzNumber(phoneNumber),
        type: "template",
        template: {
          name: "patient_cancel_message",
          language: { code: "en" },
          components: [{ type: "body", parameters: [
            { type: "text", text: String(name) },
            { type: "text", text: String(doctor?.name ?? "") },
            { type: "text", text: String(time) },
            { type: "text", text: formatDateYear(new Date(date)) },
          ] }],
        },
      };
      try {
        await sendGoBuzzMessage(patientMessagePayload);
        console.log(`WhatsApp message sent to Patient: ${phoneNumber}`);
      } catch (error) {
        console.error("Error sending WhatsApp message to Patient:", error);
      }

      // **Send WhatsApp message to doctor**
      if (doctor?.phone_number) {
        // ===== Pinnacle (commented out — migrated to GoBuzz) =====
        // const doctorMessagePayload = {
        //   from: fromPhoneNumber,
        //   to: doctor.phone_number,
        //   type: "template",
        //   message: { templateid: "774273", placeholders: [doctor.name, "cancelled", name, time, date] },
        // };
        // await axios.post(url!, doctorMessagePayload, { headers });
        // ===== GoBuzz (doctor_appts_status) =====
        const doctorMessagePayload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: formatGoBuzzNumber(doctor.phone_number),
          type: "template",
          template: {
            name: "doctor_appts_status",
            language: { code: "en" },
            components: [{ type: "body", parameters: [
              { type: "text", text: String(doctor.name) },
              { type: "text", text: "cancelled" },
              { type: "text", text: String(name) },
              { type: "text", text: String(time) },
              { type: "text", text: String(date) },
            ] }],
          },
        };
        try {
          await sendGoBuzzMessage(doctorMessagePayload);
          console.log(`WhatsApp message sent to Doctor: ${doctor.phone_number}`);
        } catch (error) {
          console.error("Error sending WhatsApp message to Doctor:", error);
        }
      }

      // **Insert slot into unavailableSlot table**
      await prisma.unavailableSlot.create({
        data: {
          doctorId: Number(doctorId),
          date: date,
          time: time,
        },
      });

      console.log(`Slot added to unavailableSlot for Doctor ID: ${doctorId}, Date: ${date}, Time: ${time}`);

      return appointment.id; // Return the appointment ID after processing
    });

    // Wait for all update promises to resolve
    await Promise.all(updatePromises);

    res.status(200).json({ message: 'Appointments cancelled successfully' });

  } catch (error) {
    console.error('Error cancelling appointments:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }


};
export const getAppointmentByServiceId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serviceId, date } = req.query
    const queryDate: string = typeof date === "string" ? date : moment().tz("Asia/Kolkata").format("YYYY-MM-DD"); // Format: "2025-02-13"

    console.log(`📌 Fetching Appointments for Service ID: ${serviceId} on ${queryDate}`);

    // Fetch today's appointments based on serviceId
    const appointments = await prisma.appointment.findMany({
      where: {
        serviceId: Number(serviceId), // Match service ID
        date: queryDate, // Match today's date in YYYY-MM-DD format
      },
    });

    console.log("✅ Appointments Retrieved:", appointments);

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const getAppointmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { appointmentId } = req.params


    // Fetch today's appointments based on serviceId
    const appointments = await prisma.appointment.findUnique({
      where: {
        id: Number(appointmentId), // Match service ID
      },
      include:{
        user: true,
        doctor:{
          select:{
            name: true, id: true, kmcNumber: true
          }
        }
      }
    });

    console.log("✅ Appointments Retrieved:", appointments);

    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const todayCheckedInAppointments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query; // Get today's date from query parameters
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }

    // OPD vitals scoping. This is the enforcement point, not the UI: the
    // /nursing/:blockId route carries no authGuard, so a client-side filter
    // would be decorative. null → caller sees everything (super_admin,
    // superintendent, non-nurse, or a station with no department links).
    const allowedDepartments = await getNurseAllowedDepartments(req.user?.id);

    const appointments = await prisma.appointment.findMany({
      where: {
        date: date as string,
        checkedIn: true,
        ...(allowedDepartments && { department: { in: allowedDepartments } }),
      },
    });
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

// Per-doctor consultation activity for a given day, for the admin analytics
// drill-down. "Started" and "Finished" aren't separate records — they're flags
// on the Appointment (checkedOut / endConsultation), so we pull today's
// checked-in rows and roll them up by doctor. Returns one entry per doctor that
// has any started or finished consultation today, with the patient breakdown.
export const consultationSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, fromDate, toDate } = req.query as {
      date?: string; fromDate?: string; toDate?: string;
    };

    // `date` is the single-day form the dashboard tile uses; fromDate/toDate is the range form.
    const from = fromDate || date;
    const to = toDate || fromDate || date;
    if (!from || !to) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        date: { gte: from, lte: to },
        checkedIn: true,
      },
      include: { doctor: true },
    });

    // Roll up by doctorId.
    const byDoctor = new Map<number, any>();
    for (const a of appointments) {
      const started = a.checkedOut === true;
      const finished = a.endConsultation === true;
      // Skip rows the doctor never acted on (only checked-in, not started).
      if (!started && !finished) continue;

      const key = a.doctorId ?? -1;
      if (!byDoctor.has(key)) {
        byDoctor.set(key, {
          doctorId: a.doctorId ?? null,
          doctorName: a.doctor?.name || a.doctorName || 'Unknown',
          department: a.department || '',
          started: 0,
          finished: 0,
          patients: [] as any[],
        });
      }
      const entry = byDoctor.get(key);
      if (started) entry.started += 1;
      if (finished) entry.finished += 1;
      entry.patients.push({
        patientName: a.patientName,
        prnNumber: a.prnNumber ?? null,
        time: a.time,
        startedAt: a.checkedOutTime,
        finishedAt: a.endConsultationTime,
        state: finished ? 'Finished' : (started ? 'Ongoing' : 'Waiting'),
        // Appointment detail — carried for the Excel export / range view.
        date: a.date,
        department: a.department || '',
        doctorName: a.doctor?.name || a.doctorName || 'Unknown',
        phoneNumber: a.phoneNumber || '',
        age: a.age ?? '',
        gender: a.gender ?? '',
        type: a.type ?? '',
        requestVia: a.requestVia ?? '',
        checkedInTime: a.checkedInTime,
        waitingTime: a.waitingTime ?? '',
      });
    }

    // Within a doctor, keep the appointments in chronological order for the export.
    for (const entry of byDoctor.values()) {
      entry.patients.sort((p: any, q: any) =>
        p.date === q.date ? String(p.time).localeCompare(String(q.time)) : String(p.date).localeCompare(String(q.date))
      );
    }

    const summary = Array.from(byDoctor.values())
      .sort((x, y) => (y.started + y.finished) - (x.started + x.finished));

    res.status(200).json(summary);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const confirmedAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const where: any = { status: 'confirmed' };

    if (fromDate || toDate) {
      // User specified a date range — apply it
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate)   where.date.lte = toDate;
    } else {
      // Default: today + future only (avoids loading 80k+ historical records)
      where.date = { gte: today };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include:{
        user: true,
        doctor:true
      },
      orderBy: { date: 'asc' }
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const cancelledAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const last7 = new Date();
    last7.setDate(last7.getDate() - 7);
    const last7Str = last7.toISOString().split('T')[0];

    const where: any = { status: 'cancelled' };
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate)   where.date.lte = toDate;
    } else {
      // Default: last 7 days + today + future (recent cancellations + upcoming cancelled slots)
      where.date = { gte: last7Str };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include:{
        user: true,
        doctor:true
      },
      orderBy: { date: 'desc' }   // Latest dates first (future > today > recent past)
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const completedAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const today = new Date().toISOString().split('T')[0];

    const where: any = { status: 'completed' };
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate)   where.date.lte = toDate;
    } else {
      // Default: today's completed appointments only
      where.date = today;
    }

    const appointments = await prisma.appointment.findMany({
      where,
      select: {
        // `id` is required so the UI can join the lifecycle trail
        // (POST /appointments/event-summary) onto these rows for the export.
        id: true,
        patientName: true,
        phoneNumber: true,
        email: true,
        doctorName: true,
        department: true,
        date: true,
        time: true,
        created_at: true,
        requestVia: true,
        smsSent: true,
        emailSent: true,
        messageSent: true,
        status: true,
        patientType: true,
        checkedInBy: true,
        checkedInTime: true,
        rescheduleCount: true,
        arrivedBy: true,
        arrivedTime: true,
        user: {
          select: {
            username: true,
          },
        },
      },
      orderBy: { date: 'desc' }
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
export const PendingAppointments = async (req: Request, res: Response):Promise<void> => {
  try{
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const today = new Date().toISOString().split('T')[0];

    const where: any = { status: 'pending' };
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate)   where.date.lte = toDate;
    } else {
      // Default: today + future pending appointments
      where.date = { gte: today };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include:{
        user: true,
        doctor:true
      },
      orderBy: { date: 'asc' }
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const getTransferAppointments = async(req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        status: 'confirmed',
        isTransfer: true
      }
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}
 
export const getReferredAppointments = async(req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        status: 'completed',
        isReferred: true
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const getFollowUpAppointments = async(req: Request, res: Response):Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        isfollowup: true
      },
      include:{
        user: true,
        doctor:true
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const pastConsultations = async(req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD" format
    const appointments = await prisma.appointment.findMany({
      where: {
        date: {
          lt: today, // Past dates
        },
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const futureConsultations = async(req: Request, res: Response):Promise<void> => {
  try{
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD" format
    const appointments = await prisma.appointment.findMany({
      where: {
        date: {
          gt: today, // Future dates
        },
        status:'confirmed'
      },
    });
    res.status(200).json(appointments)
  }
  catch(error){
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
}

export const confirmedMhc = async(req: Request, res: Response): Promise<void> => {
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        serviceId: {
          not:null
        },
        status: 'confirmed'
      }
    })
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const mhcReportAppointment = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        serviceId:{
          not: null
        }
      },
      select:{
        serviceId: true,
        id:true,
        waitingTime:true,
        department:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}
export const opdRequestWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      select:{
        id:true,
        requestVia:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const opdTimeWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      select:{
        id:true,
        time:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const opdTypeWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        type: {
          not: null
        }
      },
      select:{
        id:true,
        type:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}
export const opdStatusWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      select:{
        id:true,
        status:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true,
        checkedIn: true,
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const prnWiseAppointment = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where:{
        prnNumber:{
          not: null
        }
      },
      select:{
        id:true,
        prnNumber: true,
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const opdGenderWise = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        gender: {
          not: null
        }
      },
      select:{
        id:true,
        gender:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const checkedOutAppointments = async(req: Request, res: Response): Promise<void> =>{
  try{
    const appointments = await prisma.appointment.findMany({
      where: {
        checkedOut: {
          not: null
        }
      },
      select:{
        id:true,
        department:true,
        doctorId: true,
        doctorName: true,
        date:true
      }
    })
    res.status(200).json(appointments);
  }
  catch(error){
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
}

export const getCheckedInAppointmentsByDateRange = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      res.status(400).json({ error: 'fromDate and toDate are required' });
      return;
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        checkedIn: true,
        date: {
          gte: String(fromDate),
          lte: String(toDate),
        },
      },
      select: {
        id: true,
        patientName: true,
        phoneNumber: true,
        email: true,
        date: true,
        time: true,
        requestVia: true,
        type: true,
        created_at: true,
        checkedInTime: true,
        checkedInBy: true,
        doctor: {
          select: {
            id: true,
            name: true,
            department: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    res.status(200).json(appointments);
  } catch (error) {
    console.error('Error fetching checked-in appointments:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An error occurred',
    });
  }
};
const sendFollowUpWhatsApp = async (appointment: any) => {
  try {
    const patientName = `${appointment.prefix || ""} ${appointment.firstName} ${appointment.lastName}`.trim();

    // ===== Pinnacle (commented out — migrated to GoBuzz) =====
    // const payload = {
    //   from: process.env.WHATSAPP_FROM_PHONE_NUMBER,
    //   to: appointment.phoneNumber,
    //   type: "template",
    //   message: { templateid: process.env.WHATSAPP_FOLLOWUP_TEMPLATE_ID, placeholders: [patientName, appointment.doctorName] },
    // };
    // await axios.post(process.env.WHATSAPP_API_URL!, payload, { headers });
    // ===== GoBuzz (followup_appt_remainder) =====
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formatGoBuzzNumber(appointment.phoneNumber),
      type: "template",
      template: {
        name: "followup_appt_remainder",
        language: { code: "en" },
        components: [{ type: "body", parameters: [
          { type: "text", text: String(patientName) },
          { type: "text", text: String(appointment.doctorName) },
        ] }],
      },
    };
    await sendGoBuzzMessage(payload);

    console.log("Follow-up WhatsApp sent to:", appointment.phoneNumber);
  } catch (error) {
    console.error("WhatsApp follow-up failed:", error);
  }
};

// ---------------------------------------------------------------------------
// Appointment lifecycle trail (AppointmentEvent) — read side.
// Write side lives in service/appointment-event.ts.
// ---------------------------------------------------------------------------

/**
 * GET /appointments/:id/history
 * Full ordered timeline for one appointment: who did what, when, from which
 * slot to which. Actor role is joined from User at read time (the JWT only
 * carries id + username, so it isn't snapshotted on the event).
 */
export const getAppointmentHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);
    if (Number.isNaN(appointmentId)) {
      res.status(400).json({ error: 'Invalid appointment id' });
      return;
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true, patientName: true, prnNumber: true, phoneNumber: true,
        doctorId: true, doctorName: true, department: true,
        date: true, time: true, status: true, requestVia: true,
        rescheduleCount: true, cancelledBy: true, cancelledById: true,
        cancelledAt: true, cancelReason: true,
        created_at: true, updated_at: true,
      },
    });
    if (!appointment) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const events = await prisma.appointmentEvent.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'asc' },
    });

    // Join roles for the user-actors in one query rather than per event.
    const actorIds = [...new Set(events.map((e) => e.actorId).filter((v): v is number => v != null))];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, role: true },
        })
      : [];
    const roleById = new Map(actors.map((a) => [a.id, a.role]));

    res.status(200).json({
      appointment,
      summary: {
        totalEvents: events.length,
        rescheduleCount: appointment.rescheduleCount,
        cancelled: appointment.status === 'cancelled',
        cancelledBy: appointment.cancelledBy,
        cancelledAt: appointment.cancelledAt,
        cancelReason: appointment.cancelReason,
      },
      events: events.map((e) => ({
        ...e,
        actorRole: e.actorRole ?? (e.actorId != null ? roleById.get(e.actorId) ?? null : null),
        payload: e.payload ? safeJsonParse(e.payload) : null,
      })),
    });
  } catch (error) {
    console.error('[appointment-history] fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

/**
 * GET /appointments/reschedule-report?from=YYYY-MM-DD&to=YYYY-MM-DD&eventType=
 * Aggregate view for the front-desk dashboard: how many reschedules and
 * cancellations happened in a window, broken down by actor, by doctor, and by
 * source (staff vs the 3-hour no-show cron vs the WhatsApp bot).
 * Defaults to the last 30 days when no range is given.
 */
export const getAppointmentEventReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, eventType } = req.query;

    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      res.status(400).json({ error: 'Invalid from/to date' });
      return;
    }
    // `to` is a plain date from the UI — include the whole day.
    toDate.setHours(23, 59, 59, 999);

    const types = eventType
      ? String(eventType).split(',').map((t) => t.trim()).filter(Boolean)
      : ['RESCHEDULED', 'CANCELLED'];

    const events = await prisma.appointmentEvent.findMany({
      where: {
        createdAt: { gte: fromDate, lte: toDate },
        eventType: { in: types },
      },
      orderBy: { createdAt: 'desc' },
    });

    const tally = <T extends string | number>(
      keyOf: (e: (typeof events)[number]) => T | null,
      labelOf: (e: (typeof events)[number]) => string,
    ) => {
      const map = new Map<T, { key: T; label: string; rescheduled: number; cancelled: number; total: number }>();
      for (const e of events) {
        const key = keyOf(e);
        if (key == null) continue;
        const row = map.get(key) ?? { key, label: labelOf(e), rescheduled: 0, cancelled: 0, total: 0 };
        if (e.eventType === 'RESCHEDULED') row.rescheduled++;
        if (e.eventType === 'CANCELLED') row.cancelled++;
        row.total++;
        map.set(key, row);
      }
      return [...map.values()].sort((a, b) => b.total - a.total);
    };

    // Appointments rescheduled more than once in the window — the "this patient
    // keeps getting moved" list.
    const perAppointment = new Map<number, number>();
    for (const e of events) {
      if (e.eventType !== 'RESCHEDULED') continue;
      perAppointment.set(e.appointmentId, (perAppointment.get(e.appointmentId) ?? 0) + 1);
    }
    const repeatOffenders = [...perAppointment.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([appointmentId, count]) => {
        const latest = events.find((e) => e.appointmentId === appointmentId);
        return {
          appointmentId,
          rescheduleCount: count,
          patientName: latest?.patientName ?? null,
          prnNumber: latest?.prnNumber ?? null,
          doctorName: latest?.toDoctorName ?? latest?.fromDoctorName ?? null,
        };
      });

    res.status(200).json({
      range: { from: fromDate, to: toDate },
      eventTypes: types,
      totals: {
        rescheduled: events.filter((e) => e.eventType === 'RESCHEDULED').length,
        cancelled: events.filter((e) => e.eventType === 'CANCELLED').length,
        all: events.length,
      },
      byActor: tally(
        (e) => e.actorId ?? (e.actorName as unknown as number | null),
        (e) => e.actorName ?? e.actorType,
      ),
      byDoctor: tally(
        (e) => e.fromDoctorId ?? e.toDoctorId,
        (e) => e.fromDoctorName ?? e.toDoctorName ?? 'Unknown',
      ),
      bySource: tally((e) => e.source ?? 'unknown', (e) => e.source ?? 'unknown'),
      repeatOffenders,
    });
  } catch (error) {
    console.error('[appointment-event-report] fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * POST /appointments/event-summary
 * Body: { appointmentIds: number[] }
 *
 * Bulk companion to /:id/history — one row per appointment instead of a full
 * timeline, so the Excel exports can add "who booked / who rescheduled / who
 * cancelled and when" columns with a single request rather than one per row.
 *
 * POST rather than GET because an export can carry thousands of ids, which
 * would overflow a query string. The client chunks; this caps defensively.
 */
export const getAppointmentEventSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { appointmentIds } = req.body as { appointmentIds?: unknown };
    if (!Array.isArray(appointmentIds)) {
      res.status(400).json({ error: 'appointmentIds must be an array of appointment ids' });
      return;
    }

    const ids = appointmentIds
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0)
      .slice(0, 5000);

    if (ids.length === 0) {
      res.status(200).json({ summaries: {} });
      return;
    }

    const events = await prisma.appointmentEvent.findMany({
      where: { appointmentId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    });

    interface EventSummary {
      bookedBy: string | null;
      bookedByType: string | null;
      bookedAt: Date | null;
      rescheduleCount: number;
      lastRescheduledBy: string | null;
      lastRescheduledByType: string | null;
      lastRescheduledAt: Date | null;
      previousDate: string | null;
      previousTime: string | null;
      previousDoctorName: string | null;
      cancelledBy: string | null;
      cancelledByType: string | null;
      cancelledBySource: string | null;
      cancelledAt: Date | null;
      cancelReason: string | null;
    }

    const blank = (): EventSummary => ({
      bookedBy: null, bookedByType: null, bookedAt: null,
      rescheduleCount: 0,
      lastRescheduledBy: null, lastRescheduledByType: null, lastRescheduledAt: null,
      previousDate: null, previousTime: null, previousDoctorName: null,
      cancelledBy: null, cancelledByType: null, cancelledBySource: null,
      cancelledAt: null, cancelReason: null,
    });

    const summaries: Record<string, EventSummary> = {};

    // Events arrive oldest-first, so the creation event is the first one seen
    // and later reschedules/cancels overwrite earlier ones — leaving the most
    // recent of each in place.
    for (const e of events) {
      const key = String(e.appointmentId);
      const row = summaries[key] ?? (summaries[key] = blank());

      // 'BOOKED' is the pre-rename spelling, still present on older rows.
      if (
        (e.eventType === 'REQUESTED' || e.eventType === 'BOOKED' || e.eventType === 'CONFIRMED') &&
        row.bookedAt === null
      ) {
        row.bookedBy = e.actorName;
        row.bookedByType = e.actorType;
        row.bookedAt = e.createdAt;
      }

      if (e.eventType === 'RESCHEDULED') {
        row.rescheduleCount++;
        row.lastRescheduledBy = e.actorName;
        row.lastRescheduledByType = e.actorType;
        row.lastRescheduledAt = e.createdAt;
        row.previousDate = e.fromDate;
        row.previousTime = e.fromTime;
        row.previousDoctorName = e.fromDoctorName;
      }

      if (e.eventType === 'CANCELLED') {
        row.cancelledBy = e.actorName;
        row.cancelledByType = e.actorType;
        row.cancelledBySource = e.source;
        row.cancelledAt = e.createdAt;
        row.cancelReason = e.reason;
      }
    }

    res.status(200).json({ summaries });
  } catch (error) {
    console.error('[appointment-event-summary] fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};

/**
 * PUT /appointments/:id/undo-checkin
 * Body: { reason: string }
 *
 * Correction path for "reception checked in the wrong patient".
 *
 * Check-in is not just a flag — it also writes prnNumber and overwrites
 * patientName/age/gender from the PRN's patient record, and stamps the payment
 * fields for a 'paid' visit. Flipping `checkedIn` back on its own would leave
 * the wrong patient's demographics permanently on this appointment, so this
 * restores from the CHECKED_IN trail event instead of guessing.
 *
 * Deliberately does NOT check in the correct appointment as part of the same
 * call: the normal /checkin endpoint owns PRN capture and the demographics
 * sync, and duplicating half of it here would drift. Undo, then check in the
 * right row through the usual popup.
 */
export const undoCheckIn = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      res.status(400).json({ error: 'Invalid appointment id' });
      return;
    }

    // A fixed reason code rather than free text: the front desk was picking
    // whatever wording avoided the most work, which made the trail useless for
    // spotting a check-in being undone to dodge a cancellation.
    const { reasonCode, note } = req.body as { reasonCode?: string; note?: string };
    if (!reasonCode || !(reasonCode in UNDO_CHECKIN_REASONS)) {
      res.status(400).json({
        error: `reasonCode must be one of: ${Object.keys(UNDO_CHECKIN_REASONS).join(', ')}`,
      });
      return;
    }
    const reasonLabel = UNDO_CHECKIN_REASONS[reasonCode as UndoCheckInReason];
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    const trimmedReason = trimmedNote ? `${reasonLabel} — ${trimmedNote}` : reasonLabel;
    const alsoCancel = reasonCode === 'cancel';

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    if (!appointment.checkedIn) {
      res.status(409).json({ error: 'This appointment is not checked in' });
      return;
    }
    // Once the visit has moved on, a silent reversal is worse than none —
    // the front desk should cancel/close the consultation instead.
    if (appointment.checkedOut || appointment.endConsultation) {
      res.status(409).json({
        error: 'The consultation has already been completed for this appointment, so the check-in can no longer be undone.',
      });
      return;
    }

    const [assessmentCount, ophthalmologyCount] = await Promise.all([
      prisma.oPDAssessment.count({ where: { appointmentId } }),
      prisma.ophthalmologyPrescription.count({ where: { appointmentId } }),
    ]);
    if (assessmentCount > 0 || ophthalmologyCount > 0) {
      res.status(409).json({
        error: 'The doctor has already recorded clinical notes for this visit, so the check-in can no longer be undone.',
      });
      return;
    }

    // The check-in event holds what was overwritten. Absent (a check-in from
    // before the trail existed, or the HMIS payment webhook) we still clear the
    // flag, but we can't restore demographics — the response says so.
    const lastCheckIn = await prisma.appointmentEvent.findFirst({
      where: { appointmentId, eventType: 'CHECKED_IN' },
      orderBy: { createdAt: 'desc' },
    });

    let payload: Record<string, any> | null = null;
    if (lastCheckIn?.payload) {
      try {
        payload = JSON.parse(lastCheckIn.payload);
      } catch {
        payload = null;
      }
    }

    const restore: Record<string, unknown> = {
      checkedIn: false,
      checkedInTime: null,
      checkedInBy: null,
    };

    const demographicsBefore = payload?.demographicsBefore as
      | { patientName?: string | null; age?: string | null; gender?: string | null }
      | undefined;
    let demographicsRestored = false;
    if (demographicsBefore) {
      restore.patientName = demographicsBefore.patientName ?? appointment.patientName;
      restore.age = demographicsBefore.age ?? null;
      restore.gender = demographicsBefore.gender ?? null;
      demographicsRestored = true;
    }

    // The PRN and the visit type are both entered in the check-in popup and
    // saved by the PUT that runs immediately before /checkin, so the row
    // already carries them by the time check-in reads it — there is no real
    // "previous" value to put back. Reversing the check-in clears what that
    // flow entered. The old values live on in the reversal event below.
    //
    // The PRN popup only opens when the booking has none (see prnCheck in
    // appointment-confirm), so a captured PRN is always one typed at check-in.
    let prnCleared = false;
    if (payload?.prnCapturedAtCheckin != null && appointment.prnNumber === payload.prnCapturedAtCheckin) {
      restore.prnNumber = null;
      prnCleared = true;
    }

    // Older events predate typeAtCheckin; clearing is still the right call
    // because the popup sets the type on every check-in.
    let typeCleared = false;
    const typeAtCheckin = payload?.typeAtCheckin;
    if (appointment.type && (typeAtCheckin === undefined || typeAtCheckin === appointment.type)) {
      restore.type = null;
      typeCleared = true;
    }

    // Money is never silently reversed. Only unwind the automatic stamp, and
    // only while no receipt has been recorded against it.
    let paymentReverted = false;
    let paymentWarning: string | null = null;
    if (payload?.paymentStamped === true) {
      if (appointment.receiptNo) {
        paymentWarning =
          'Payment was left as paid because a receipt number is recorded against it. Please correct it in billing.';
      } else {
        restore.paymentStatus = 'unpaid';
        restore.paidAt = null;
        restore.paymentSource = null;
        paymentReverted = true;
      }
    }

    // Cancelling is carried out here, in the same transaction as the undo —
    // never left to a follow-up click. Otherwise an operator could reverse the
    // check-in, skip the cancellation, and leave a confirmed appointment
    // sitting in the queue with nobody expecting it.
    if (alsoCancel) {
      restore.status = 'cancelled';
      restore.cancelledBy = req.user?.username ?? 'unknown';
      restore.cancelledById = req.user?.id ?? null;
      restore.cancelledAt = new Date();
      restore.cancelReason = trimmedReason;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: restore,
      });
      if (alsoCancel) {
        // Free the slot so it can be re-booked, same as the cancel button does.
        // Scoped to this appointment's own hold — see updateAppointment.
        await tx.bookedSlot.deleteMany({
          where: {
            doctorId: appointment.doctorId, date: appointment.date, time: appointment.time,
            OR: [{ appointmentId: appointmentId }, { appointmentId: null }],
          },
        });
      }
      return row;
    }, APPOINTMENT_TX_OPTIONS);

    if (alsoCancel) {
      await recordAppointmentEvent(req, {
        appointmentId,
        eventType: 'CANCELLED',
        from: slotSnapshot(appointment),
        to: { ...slotSnapshot(updated), status: 'cancelled' },
        subject: subjectSnapshot(updated),
        source: 'undo-checkin',
        reason: trimmedReason,
      });
    }

    await recordAppointmentEvent(req, {
      appointmentId,
      eventType: 'CHECKIN_REVERSED',
      from: { ...slotSnapshot(appointment), status: appointment.status },
      to: slotSnapshot(updated),
      subject: subjectSnapshot(updated),
      source: 'admin-panel',
      reason: trimmedReason,
      payload: {
        reasonCode,
        note: trimmedNote || null,
        appointmentCancelled: alsoCancel,
        originalCheckedInBy: appointment.checkedInBy,
        originalCheckedInTime: appointment.checkedInTime,
        demographicsRestored,
        prnCleared,
        prnClearedValue: prnCleared ? appointment.prnNumber : null,
        typeCleared,
        typeClearedValue: typeCleared ? appointment.type : null,
        paymentReverted,
        paymentWarning,
      },
    });

    // Drop the patient off the doctor's queue / TV.
    notifyDoctor(appointment.doctorId);

    res.status(200).json({
      message: alsoCancel ? 'Check-in reversed and appointment cancelled' : 'Check-in reversed',
      updatedAppointment: updated,
      reasonCode,
      appointmentCancelled: alsoCancel,
      // The reschedule path still reverses the check-in — the operator is told
      // where to go next rather than being blocked here.
      guidance: reasonCode === 'reschedule'
        ? 'Check-in reversed. If the doctor has not started the consultation, reschedule this appointment from Confirmed Appointments. If the consultation has already started, ask the doctor to raise a transfer appointment.'
        : null,
      demographicsRestored,
      prnCleared,
      typeCleared,
      paymentReverted,
      // Only warn when there is genuinely no check-in event to restore from.
      // An event with no `demographicsBefore` is the normal case — check-in
      // only rewrites demographics when it captured a missing PRN, so there
      // was nothing to put back and the reversal is clean.
      warning: paymentWarning ?? (lastCheckIn ? null :
        'No check-in record was found for this appointment, so patient name, age and gender could not be restored. Please verify them.'),
    });
  } catch (error) {
    console.error('[undo-checkin] failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'An error occurred' });
  }
};
