import prisma from '../../service/prisma-client';
import { createHmisAuditLog } from '../hmis-sync/hmis-audit';

/**
 * Follow-up Appointment Automation Service (Sprint 4a Phase 1c).
 *
 * Auto-creates an OPD Appointment when an IPD discharge is saved with
 * `followUpDate` populated. Covers the NABH.ACC.5 post-discharge continuity
 * requirement.
 *
 * Key design decisions (see docs/sprints/sprint-4a-phase-1c-audit.md):
 *   - Patient linkage via `prnNumber` only (going-forward rule). `patientId`
 *     stays null; the pre-fix code used `PatientDetails.id` where the column
 *     FK-points at `Patient.id` — a silent wrong-patient bug. See also the
 *     Sprint 4c backlog entry for legacy row cleanup if production DB lands
 *     with broken rows.
 *   - MRD attribution: the auto-created Appointment stamps `userId =
 *     discharge.createdById`, propagating the discharging clinician's
 *     identity as the follow-up's initiator. If `createdById` is null on a
 *     legacy discharge (pre-Phase-1b), we fail rather than create an orphan
 *     with `userId = null` — the manual scheduler flow can be used instead.
 *   - Audit log `module: 'follow-up'` (new module identifier this sprint),
 *     `action: 'appointment_auto_created' | 'appointment_auto_creation_skipped'
 *     | 'appointment_auto_creation_failed'` — three branches, always written.
 *   - Error-swallow: this helper returns a tagged status object; it does NOT
 *     throw on business-logic failures. Discharge must complete regardless.
 *     The throw path is reserved for unexpected infrastructure errors
 *     (DB connection loss, etc.) which the caller catches.
 */

// ---- Return shape ----------------------------------------------------------

export type FollowUpSkippedReason =
  | 'no-follow-up-date'
  | 'past-date'
  | 'duplicate';

export type FollowUpResult =
  | {
      status: 'created';
      appointmentId: number;
      appointmentDate: Date;
    }
  | {
      status: 'skipped';
      reason: FollowUpSkippedReason;
    }
  | {
      status: 'failed';
      reason: string;
    };

// ---- Rule table ------------------------------------------------------------

export interface FollowUpConfig {
  department: string;
  diagnosis: string;
  daysAfterDischarge: number;
  reason: string;
}

const DEFAULT_FOLLOWUP_CONFIGS: FollowUpConfig[] = [
  { department: 'Surgery',         diagnosis: 'Post-operative',            daysAfterDischarge: 7,  reason: 'Post-operative check-up' },
  { department: 'Cardiology',      diagnosis: 'Acute coronary syndrome',   daysAfterDischarge: 5,  reason: 'Cardiac follow-up and stress test' },
  { department: 'Cardiology',      diagnosis: 'Heart failure',             daysAfterDischarge: 7,  reason: 'Ejection fraction assessment' },
  { department: 'Orthopedics',     diagnosis: 'Fracture',                  daysAfterDischarge: 14, reason: 'Suture removal and X-ray' },
  { department: 'General Medicine', diagnosis: 'Diabetes',                 daysAfterDischarge: 7,  reason: 'Blood glucose monitoring' },
  { department: 'General Medicine', diagnosis: 'Hypertension',             daysAfterDischarge: 10, reason: 'Blood pressure review' },
  { department: 'General',         diagnosis: '',                          daysAfterDischarge: 7,  reason: 'Follow-up consultation' },
];

// ---- Primary entry point ---------------------------------------------------

/**
 * Auto-create follow-up appointment after IPD discharge.
 *
 * @param dischargeId            IpdDischarge.id (uuid).
 * @param admissionId            IpdAdmission.id (uuid).
 * @param followUpDate           Explicit follow-up date from discharge form.
 *                               null/undefined → skipped with reason 'no-follow-up-date'.
 * @param followUpDoctorId       Explicit doctor override. If null, `doctorId`
 *                               stays null and the denormalized `doctorName`
 *                               falls back to discharge.followUpDoctor or
 *                               admission.admittingDoctor.
 * @param customReason           Denormalized text shown on the appointment
 *                               (audit payload only; not stored on Appointment).
 * @param dischargeCreatedById   Phase 1b `createdById` of the discharge row.
 *                               Propagated to `Appointment.userId`. If null
 *                               (legacy discharge), we DO NOT create the
 *                               appointment — status 'failed' with reason
 *                               'no-responsible-doctor'.
 */
export const createFollowUpAppointment = async (
  dischargeId: string,
  admissionId: string,
  followUpDate: Date | null,
  followUpDoctorId?: number | null,
  customReason?: string,
  dischargeCreatedById?: number | null
): Promise<FollowUpResult> => {
  try {
    // --- Early skip: no follow-up date requested --------------------------
    if (!followUpDate) {
      await writeAudit('appointment_auto_creation_skipped', 'success', {
        dischargeId,
        admissionId,
        reason: 'no-follow-up-date',
      });
      return { status: 'skipped', reason: 'no-follow-up-date' };
    }

    // --- Early skip: past date --------------------------------------------
    // Compare against start-of-day so "today" passes through as valid.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const normalizedFollowUpDate = new Date(followUpDate);
    normalizedFollowUpDate.setHours(0, 0, 0, 0);
    if (normalizedFollowUpDate < startOfToday) {
      await writeAudit('appointment_auto_creation_skipped', 'success', {
        dischargeId,
        admissionId,
        followUpDate: normalizedFollowUpDate.toISOString(),
        reason: 'past-date',
      });
      return { status: 'skipped', reason: 'past-date' };
    }

    // --- Fetch source records ---------------------------------------------
    const discharge = await prisma.ipdDischarge.findUnique({
      where: { id: dischargeId },
    });
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
    });

    if (!discharge || !admission) {
      return await failAudit(
        dischargeId,
        admissionId,
        'discharge-or-admission-not-found'
      );
    }

    // --- MRD attribution: refuse to create without a responsible clinician
    const responsibleUserId = dischargeCreatedById ?? discharge.createdById ?? null;
    if (responsibleUserId == null) {
      return await failAudit(
        dischargeId,
        admissionId,
        'no-responsible-doctor'
      );
    }

    // --- Patient lookup via PRN -------------------------------------------
    const prnInt = parseInt(admission.prn);
    if (Number.isNaN(prnInt)) {
      return await failAudit(
        dischargeId,
        admissionId,
        `invalid-prn:${admission.prn}`
      );
    }
    const patient = await prisma.patientDetails.findFirst({
      where: { prn: prnInt },
    });
    if (!patient) {
      return await failAudit(
        dischargeId,
        admissionId,
        `patient-not-found:prn=${prnInt}`
      );
    }

    // --- Duplicate detection (same PRN, same date; any appointment) -------
    const dateString = normalizedFollowUpDate.toISOString().split('T')[0];
    const existing = await prisma.appointment.findFirst({
      where: { prnNumber: prnInt, date: dateString },
    });
    if (existing) {
      await writeAudit('appointment_auto_creation_skipped', 'success', {
        dischargeId,
        admissionId,
        prn: prnInt,
        followUpDate: dateString,
        reason: 'duplicate',
        conflictingAppointmentId: existing.id,
      });
      return { status: 'skipped', reason: 'duplicate' };
    }

    // --- Doctor resolution (no arbitrary doctorId=1 fallback) -------------
    let doctorId: number | null = null;
    let doctorName = discharge.followUpDoctor || admission.admittingDoctor || 'Follow-up Doctor';
    let department = admission.department;

    if (followUpDoctorId != null) {
      const doctor = await prisma.doctor.findUnique({ where: { id: followUpDoctorId } });
      if (doctor) {
        doctorId = doctor.id;
        doctorName = doctor.name;
        department = doctor.departmentName || department;
      }
      // Explicit override that doesn't resolve: leave doctorId null but keep
      // the fallback name. Don't fail the auto-creation — the scheduling UI
      // can reassign later.
    }

    // --- Create appointment -----------------------------------------------
    const appointment = await prisma.appointment.create({
      data: {
        prnNumber: prnInt,                          // Single source of truth for patient linkage.
        patientId: null,                            // Going-forward rule: don't populate this FK.
        patientName: patient.name,
        phoneNumber: patient.mobileNo || patient.contactNo || '',
        email: patient.email || '',
        doctorId,
        doctorName,
        department,
        date: dateString,
        time: '10:00',                              // Default follow-up slot (conflict-resolution = 4b).
        status: 'pending',
        isfollowup: true,
        userId: responsibleUserId,                  // MRD attribution — propagated from discharge.
      },
    });

    await writeAudit('appointment_auto_created', 'success', {
      appointmentId: appointment.id,
      dischargeId,
      admissionId,
      prn: prnInt,
      followUpDate: dateString,
      reason:
        customReason ||
        getFollowUpReason(admission.department, discharge.finalDiagnosis),
      userId: responsibleUserId,
    });

    return {
      status: 'created',
      appointmentId: appointment.id,
      appointmentDate: normalizedFollowUpDate,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await writeAudit('appointment_auto_creation_failed', 'failed', {
      dischargeId,
      admissionId,
      error: message,
    });
    return { status: 'failed', reason: message };
  }
};

// ---- Audit helpers --------------------------------------------------------

const writeAudit = async (
  action: string,
  status: 'success' | 'failed',
  payload: unknown
): Promise<void> => {
  await createHmisAuditLog({
    direction: 'push',
    module: 'follow-up',
    action,
    payload: JSON.stringify(payload),
    status,
  });
};

const failAudit = async (
  dischargeId: string,
  admissionId: string,
  reason: string
): Promise<FollowUpResult> => {
  await writeAudit('appointment_auto_creation_failed', 'failed', {
    dischargeId,
    admissionId,
    reason,
  });
  return { status: 'failed', reason };
};

// ---- Rule-table helpers ---------------------------------------------------

function getFollowUpConfig(department: string, diagnosis: string): FollowUpConfig {
  let config = DEFAULT_FOLLOWUP_CONFIGS.find(
    (c) =>
      c.department === department &&
      c.diagnosis &&
      diagnosis.toLowerCase().includes(c.diagnosis.toLowerCase())
  );
  if (!config) {
    config = DEFAULT_FOLLOWUP_CONFIGS.find(
      (c) => c.department === department && !c.diagnosis
    );
  }
  if (!config) {
    config = DEFAULT_FOLLOWUP_CONFIGS.find((c) => c.department === 'General');
  }
  return config || DEFAULT_FOLLOWUP_CONFIGS[DEFAULT_FOLLOWUP_CONFIGS.length - 1];
}

function getFollowUpReason(department: string, diagnosis: string): string {
  return getFollowUpConfig(department, diagnosis).reason;
}

// ---- Cron + reminder subsystem (unchanged from pre-4a) --------------------

export const getPendingFollowUps = async (
  daysWindow: number = 3
): Promise<Array<{
  id: number;
  patientName: string;
  date: string;
  doctor: { name: string } | null;
}>> => {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysWindow);

  const followUps = await prisma.appointment.findMany({
    where: {
      isfollowup: true,
      status: 'pending',
      date: {
        gte: startDate.toISOString().split('T')[0],
        lte: endDate.toISOString().split('T')[0],
      },
    },
    include: { doctor: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  return followUps.map((a) => ({
    id: a.id,
    patientName: a.patientName,
    date: a.date,
    doctor: a.doctor ? { name: a.doctor.name } : null,
  }));
};

/**
 * Reminder dispatch — log-only stub (TODO: SMS/email integration). Flips
 * `remainder1Sent = true` to avoid re-notifying.
 */
export const sendFollowUpReminders = async (): Promise<number> => {
  const followUps = await getPendingFollowUps(3);
  let reminderCount = 0;
  for (const appointment of followUps) {
    try {
      console.log(
        `📬 Reminder: ${appointment.patientName} has follow-up on ${appointment.date}`
      );
      reminderCount += 1;
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { remainder1Sent: true },
      });
    } catch (error) {
      console.error(`Error sending reminder for appointment ${appointment.id}:`, error);
    }
  }
  console.log(`✅ Follow-up reminders sent: ${reminderCount}`);
  return reminderCount;
};

/**
 * Cron job to send follow-up reminders daily at 8 AM.
 * Registered at server startup via src/index.ts.
 */
export const initializeFollowUpReminders = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  cron.schedule('0 8 * * *', async () => {
    console.log(`[${new Date().toISOString()}] 📨 Sending follow-up reminders...`);
    try {
      await sendFollowUpReminders();
    } catch (error) {
      console.error('Error in follow-up reminder cron job:', error);
    }
  });
  console.log('✅ Follow-up reminder cron job initialized (runs daily at 8 AM)');
};
