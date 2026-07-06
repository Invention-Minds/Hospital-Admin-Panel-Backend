import { PrismaClient } from "@prisma/client";
import {
  sendWhatsAppTemplate,
  buildPlaceholders,
  TEMPLATE,
} from "../whatsapp/whatsapp.controller";
import {
  toMinutes,
  fromMinutes,
  slotEndMin,
  isWithinWorkingHours,
  overlaps,
  hasSlotConflict,
  splitDuration,
  addDaysToDateStr,
  diffDaysDateStr,
  BUFFER_MIN,
} from "./therapy-scheduling.util";

const prisma = new PrismaClient();

export type NotifyKind = "confirm" | "reschedule" | "cancel" | "none";

export type MaterializeFailure =
  | "not_found"
  | "already_materialized"
  | "course_inactive"
  | "outside_hours"
  | "conflict";

export interface MaterializeResult {
  ok: boolean;
  appointmentId?: number;
  reason?: MaterializeFailure;
}

/**
 * Send patient / doctor / therapist WhatsApp messages for a course-day
 * appointment — `confirm` on fresh materialisation, `reschedule` when a day was
 * moved, `none` to skip. Mirrors the standalone booking flow's message fan-out.
 */
async function sendCourseNotifications(
  appointmentId: number,
  kind: NotifyKind
): Promise<void> {
  if (kind === "none") return;

  const TPL_BY_KIND = {
    reschedule: {
      patient: TEMPLATE.PATIENT_RESCHEDULE,
      doctor: TEMPLATE.DOCTOR_RESCHEDULE,
      therapist: TEMPLATE.THERAPIST_RESCHEDULE,
      patientKey: "PATIENT_RESCHEDULE",
      doctorKey: "DOCTOR_RESCHEDULE",
      therapistKey: "THERAPIST_RESCHEDULE",
    },
    cancel: {
      patient: TEMPLATE.PATIENT_CANCEL,
      doctor: TEMPLATE.DOCTOR_CANCEL,
      therapist: TEMPLATE.THERAPIST_CANCEL,
      patientKey: "PATIENT_CANCEL",
      doctorKey: "DOCTOR_CANCEL",
      therapistKey: "THERAPIST_CANCEL",
    },
    confirm: {
      patient: TEMPLATE.PATIENT_CONFIRM,
      doctor: TEMPLATE.DOCTOR_CONFIRM,
      therapist: TEMPLATE.THERAPIST_CONFIRM,
      patientKey: "PATIENT_CONFIRM",
      doctorKey: "DOCTOR_CONFIRM",
      therapistKey: "THERAPIST_CONFIRM",
    },
  } as const;

  const tpl = TPL_BY_KIND[kind];

  const full = await prisma.therapyAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      therapy: true,
      doctor: true,
      therapies: { include: { therapy: true } },
      therapists: { include: { therapist: true } },
    },
  });
  if (!full) return;

  const doctor = full.doctor;
  const therapistList = full.therapists.map((t) => t.therapist);
  const combinedTherapistNames = therapistList.map((t) => t.name).join(", ");

  await sendWhatsAppTemplate(
    full.phone,
    tpl.patient,
    buildPlaceholders(tpl.patientKey, full, combinedTherapistNames, doctor?.name ?? ""),
    full.id
  );

  await sendWhatsAppTemplate(
    doctor?.phone_number ?? "",
    tpl.doctor,
    buildPlaceholders(tpl.doctorKey, full, combinedTherapistNames, doctor?.name ?? "")
  );

  for (const th of therapistList) {
    await sendWhatsAppTemplate(
      th.phoneNumber,
      tpl.therapist,
      buildPlaceholders(tpl.therapistKey, full, th.name, doctor?.name ?? "")
    );
  }
}

/**
 * Turn a planned course day into a real, slot-holding TherapyAppointment.
 *
 * Hybrid model: only one day is materialised at a time. Returns a failure
 * (without writing) when the slot can't be claimed — the caller decides whether
 * that's fatal (day-1 create) or a flag-for-reschedule (roll-forward).
 */
export async function materializeDay(
  courseId: number,
  dayNumber: number,
  notify: NotifyKind = "confirm"
): Promise<MaterializeResult> {
  const planDay = await prisma.therapyCoursePlanDay.findUnique({
    where: { courseId_dayNumber: { courseId, dayNumber } },
  });
  if (!planDay) return { ok: false, reason: "not_found" };
  if (planDay.appointmentId) {
    return { ok: true, appointmentId: planDay.appointmentId, reason: "already_materialized" };
  }

  const course = await prisma.therapyCourse.findUnique({ where: { id: courseId } });
  if (!course || course.status !== "active") {
    return { ok: false, reason: "course_inactive" };
  }

  const therapistIds = (planDay.plannedTherapistIds as number[]).map(Number);
  const therapyIds = (planDay.plannedTherapyIds as number[]).map(Number);

  const startMin = toMinutes(planDay.time);
  const endMin = slotEndMin(startMin, planDay.totalDurationMinutes);
  if (!isWithinWorkingHours(startMin, endMin)) {
    return { ok: false, reason: "outside_hours" };
  }

  const candidates = await prisma.therapyAppointment.findMany({
    where: {
      date: planDay.plannedDate,
      status: { in: ["confirmed", "completed"] },
      OR: [
        { roomNumber: planDay.roomNumber },
        { therapists: { some: { therapistId: { in: therapistIds } } } },
      ],
    },
    select: {
      id: true,
      time: true,
      roomNumber: true,
      totalDurationMinutes: true,
      therapists: { select: { therapistId: true } },
    },
  });

  if (hasSlotConflict(candidates, { startMin, endMin, roomNumber: planDay.roomNumber, therapistIds })) {
    return { ok: false, reason: "conflict" };
  }

  const split = splitDuration(planDay.totalDurationMinutes, planDay.hasBathing);

  const appointment = await prisma.therapyAppointment.create({
    data: {
      prn: course.prn,
      prefix: course.prefix,
      name: course.name,
      phone: course.phone,
      email: course.email,
      gender: course.gender,
      age: course.age,
      doctorId: course.doctorId,
      roomNumber: planDay.roomNumber,
      date: planDay.plannedDate,
      time: planDay.time,
      therapyId: therapyIds[0], // legacy single-therapy mirror
      hasBathing: planDay.hasBathing,
      totalDurationMinutes: planDay.totalDurationMinutes,
      therapyDurationMinutes: split.therapyMinutes,
      cleaningDurationMinutes: split.cleaningMinutes,
      bathingDurationMinutes: split.bathingMinutes,
      status: "confirmed",
      courseId: course.id,
      dayNumber: planDay.dayNumber,
    },
  });

  await prisma.therapyAppointmentTherapist.createMany({
    data: therapistIds.map((tid) => ({ appointmentId: appointment.id, therapistId: tid })),
    skipDuplicates: true,
  });
  await prisma.therapyAppointmentTherapy.createMany({
    data: therapyIds.map((th) => ({ appointmentId: appointment.id, therapyId: th })),
    skipDuplicates: true,
  });

  await prisma.therapyCoursePlanDay.update({
    where: { id: planDay.id },
    data: { status: "confirmed", appointmentId: appointment.id },
  });

  await sendCourseNotifications(appointment.id, notify);

  return { ok: true, appointmentId: appointment.id };
}

export interface RollForwardResult {
  dayNumber: number;
  materialized: boolean;
  reason?: MaterializeFailure;
}

/**
 * After a course-day appointment is checked in, claim the next planned day's
 * slot. Best-effort: a conflict / out-of-hours next day is left `planned` and
 * surfaced (not created), to be resolved via reschedule. Returns null when the
 * appointment isn't part of a course or there's no next day.
 */
export async function rollForwardAfterCheckIn(appointment: {
  courseId: number | null;
  dayNumber: number | null;
}): Promise<RollForwardResult | null> {
  if (!appointment.courseId || appointment.dayNumber == null) return null;

  const next = appointment.dayNumber + 1;
  const planDay = await prisma.therapyCoursePlanDay.findUnique({
    where: { courseId_dayNumber: { courseId: appointment.courseId, dayNumber: next } },
  });
  if (!planDay) return null; // last day reached
  if (planDay.appointmentId) {
    return { dayNumber: next, materialized: true };
  }

  const result = await materializeDay(appointment.courseId, next);
  return { dayNumber: next, materialized: result.ok, reason: result.ok ? undefined : result.reason };
}

// ── Creation-time clash detection ────────────────────────────────────────

export interface PlannedDayProbe {
  dayNumber: number;
  plannedDate: string;
  time: string;
  roomNumber: string;
  totalDurationMinutes: number;
  therapistIds: number[];
}

export interface DayClash {
  dayNumber: number;
  plannedDate: string;
  type: "real" | "planned";
}

/**
 * Soft clash against tentative (status='planned') course days for a single slot.
 * Used by the single-appointment booking flow to warn (not hard-block).
 */
export async function hasPlannedDayClash(
  date: string,
  startMin: number,
  endMin: number,
  roomNumber: string,
  therapistIds: number[]
): Promise<boolean> {
  const planDays = await prisma.therapyCoursePlanDay.findMany({
    where: { plannedDate: date, status: "planned" },
    select: { time: true, roomNumber: true, totalDurationMinutes: true, plannedTherapistIds: true },
  });
  const candidates = planDays.map((p) => ({
    time: p.time,
    roomNumber: p.roomNumber,
    totalDurationMinutes: p.totalDurationMinutes,
    therapists: ((p.plannedTherapistIds as number[]) || []).map((id) => ({ therapistId: Number(id) })),
  }));
  return hasSlotConflict(candidates, { startMin, endMin, roomNumber, therapistIds });
}

/**
 * For each planned day, check the room/therapist slot against BOTH real
 * bookings (confirmed/completed appointments) AND other courses' active plan
 * days (planned/confirmed) on the same date. Returns every clashing day.
 *
 * `excludeCourseId` skips a course's own plan rows (used when re-validating an
 * existing course); omit it at creation since the course doesn't exist yet.
 */
export async function findCourseClashes(
  days: PlannedDayProbe[],
  excludeCourseId?: number
): Promise<DayClash[]> {
  const clashes: DayClash[] = [];

  for (const d of days) {
    const startMin = toMinutes(d.time);
    const endMin = slotEndMin(startMin, d.totalDurationMinutes);
    const slot = { startMin, endMin, roomNumber: d.roomNumber, therapistIds: d.therapistIds };

    // 1) Real slot-holding appointments on that date.
    const appts = await prisma.therapyAppointment.findMany({
      where: {
        date: d.plannedDate,
        status: { in: ["confirmed", "completed"] },
        OR: [
          { roomNumber: d.roomNumber },
          { therapists: { some: { therapistId: { in: d.therapistIds } } } },
        ],
      },
      select: {
        time: true,
        roomNumber: true,
        totalDurationMinutes: true,
        therapists: { select: { therapistId: true } },
      },
    });

    const realConflict = hasSlotConflict(appts, slot);

    // 2) Other courses' tentative plan days on that date (not yet materialised).
    let plannedConflict = false;
    if (!realConflict) {
      const planDays = await prisma.therapyCoursePlanDay.findMany({
        where: {
          plannedDate: d.plannedDate,
          status: "planned",
          ...(excludeCourseId ? { courseId: { not: excludeCourseId } } : {}),
        },
        select: {
          time: true,
          roomNumber: true,
          totalDurationMinutes: true,
          plannedTherapistIds: true,
        },
      });

      const candidates = planDays.map((p) => ({
        time: p.time,
        roomNumber: p.roomNumber,
        totalDurationMinutes: p.totalDurationMinutes,
        therapists: ((p.plannedTherapistIds as number[]) || []).map((id) => ({
          therapistId: Number(id),
        })),
      }));

      plannedConflict = hasSlotConflict(candidates, slot);
    }

    if (realConflict) {
      clashes.push({ dayNumber: d.dayNumber, plannedDate: d.plannedDate, type: "real" });
    } else if (plannedConflict) {
      clashes.push({ dayNumber: d.dayNumber, plannedDate: d.plannedDate, type: "planned" });
    }
  }

  return clashes;
}

// ── Reschedule (cascade by offset) ───────────────────────────────────────

export interface ConflictDetail {
  what: string; // therapist name or room number
  when: string; // "HH:mm–HH:mm"
  type: "Confirmed" | "Tentative";
}

export interface AffectedDay {
  dayNumber: number;
  oldDate: string;
  newDate: string;
  time: string;
  roomNumber: string;
  therapistNames: string[];
  hadAppointment: boolean;
  realConflict: boolean;   // clash with a confirmed/completed appointment (hard block)
  plannedConflict: boolean; // clash with another course's tentative planned day (warn)
  outsideHours: boolean;
  conflicts: ConflictDetail[]; // who/when/source for the clash
}

export type RescheduleError =
  | "not_found"
  | "inactive"
  | "day_not_found"
  | "completed"
  | "same_date";

export interface ReschedulePlan {
  courseId: number;
  targetDayNumber: number;
  offset: number;
  affected: AffectedDay[];
  error?: RescheduleError;
}

/**
 * Probe a candidate slot for a reschedule. Mirrors the create-flow check:
 * real confirmed/completed appointments (standalone + OTHER courses) are a hard
 * clash; other courses' tentative `planned` days are a soft clash. This course's
 * OWN rows are ignored (they're the ones being moved).
 */
type SlotCandidate = {
  time: string;
  roomNumber: string;
  totalDurationMinutes: number | null;
  therapists: { therapistId: number }[];
};

/** Build who/when/source detail rows for the candidates that overlap a slot. */
function conflictDetails(
  candidates: SlotCandidate[],
  startMin: number,
  endMin: number,
  roomNumber: string,
  therapistIds: number[],
  type: "Confirmed" | "Tentative",
  nameById: Map<number, string>
): ConflictDetail[] {
  const out: ConflictDetail[] = [];
  candidates.forEach((a) => {
    const aStart = toMinutes(a.time);
    const adur = Number(a.totalDurationMinutes || 0);
    if (!overlaps(startMin, endMin, aStart, aStart + adur + BUFFER_MIN)) return;
    const when = adur > 0 ? `${a.time}–${fromMinutes(aStart + adur)}` : a.time;
    if (a.roomNumber === roomNumber) out.push({ what: a.roomNumber, when, type });
    a.therapists
      .map((t) => Number(t.therapistId))
      .filter((id) => therapistIds.includes(id))
      .forEach((id) => out.push({ what: nameById.get(id) || `Therapist #${id}`, when, type }));
  });
  return out;
}

async function probeSlot(
  date: string,
  time: string,
  roomNumber: string,
  totalDurationMinutes: number,
  therapistIds: number[],
  excludeCourseId: number,
  nameById: Map<number, string>
): Promise<{ realConflict: boolean; plannedConflict: boolean; outsideHours: boolean; conflicts: ConflictDetail[] }> {
  const startMin = toMinutes(time);
  const endMin = slotEndMin(startMin, totalDurationMinutes);
  const outsideHours = !isWithinWorkingHours(startMin, endMin);
  const slot = { startMin, endMin, roomNumber, therapistIds };

  // Real appointments: standalone (courseId null) + other courses; exclude THIS
  // course's own rows. Filtered in code so null courseIds are kept (a Prisma
  // `{ not: id }` filter would wrongly drop null rows).
  const appts = await prisma.therapyAppointment.findMany({
    where: {
      date,
      status: { in: ["confirmed", "completed"] },
      OR: [
        { roomNumber },
        { therapists: { some: { therapistId: { in: therapistIds } } } },
      ],
    },
    select: {
      courseId: true,
      time: true,
      roomNumber: true,
      totalDurationMinutes: true,
      therapists: { select: { therapistId: true } },
    },
  });
  const realCandidates: SlotCandidate[] = appts.filter((a) => a.courseId !== excludeCourseId);
  const realConflict = hasSlotConflict(realCandidates, slot);

  const planDays = await prisma.therapyCoursePlanDay.findMany({
    where: { plannedDate: date, status: "planned", courseId: { not: excludeCourseId } },
    select: { time: true, roomNumber: true, totalDurationMinutes: true, plannedTherapistIds: true },
  });
  const plannedCandidates: SlotCandidate[] = planDays.map((p) => ({
    time: p.time,
    roomNumber: p.roomNumber,
    totalDurationMinutes: p.totalDurationMinutes,
    therapists: ((p.plannedTherapistIds as number[]) || []).map((id) => ({ therapistId: Number(id) })),
  }));
  const plannedConflict = !realConflict && hasSlotConflict(plannedCandidates, slot);

  const conflicts = realConflict
    ? conflictDetails(realCandidates, startMin, endMin, roomNumber, therapistIds, "Confirmed", nameById)
    : conflictDetails(plannedCandidates, startMin, endMin, roomNumber, therapistIds, "Tentative", nameById);

  return { realConflict, plannedConflict, outsideHours, conflicts };
}

/**
 * Compute the cascade-by-offset reschedule plan WITHOUT writing. Shifts the
 * target day and every later non-terminal day by the same day-offset, and
 * flags each shifted day's clashes. Used by both preview and confirm.
 */
export async function computeReschedule(
  courseId: number,
  dayNumber: number,
  newDate: string
): Promise<ReschedulePlan> {
  const empty = { courseId, targetDayNumber: dayNumber, offset: 0, affected: [] as AffectedDay[] };

  const course = await prisma.therapyCourse.findUnique({
    where: { id: courseId },
    include: { planDays: { orderBy: { dayNumber: "asc" } } },
  });
  if (!course) return { ...empty, error: "not_found" };
  if (course.status !== "active") return { ...empty, error: "inactive" };

  const target = course.planDays.find((p) => p.dayNumber === dayNumber);
  if (!target) return { ...empty, error: "day_not_found" };
  if (target.status === "completed") return { ...empty, error: "completed" };

  const offset = diffDaysDateStr(newDate, target.plannedDate);
  if (offset === 0) return { ...empty, error: "same_date" };

  const rows = course.planDays.filter(
    (p) => p.dayNumber >= dayNumber && p.status !== "completed" && p.status !== "cancelled"
  );

  // Therapist id → name, for the affected-day therapists and the clash details.
  const therapistList = await prisma.therapist.findMany({ select: { id: true, name: true } });
  const nameById = new Map(therapistList.map((t) => [t.id, t.name]));

  const affected: AffectedDay[] = [];
  for (const p of rows) {
    const nd = addDaysToDateStr(p.plannedDate, offset);
    const therapistIds = (p.plannedTherapistIds as number[]).map(Number);
    const probe = await probeSlot(nd, p.time, p.roomNumber, p.totalDurationMinutes, therapistIds, courseId, nameById);
    affected.push({
      dayNumber: p.dayNumber,
      oldDate: p.plannedDate,
      newDate: nd,
      time: p.time,
      roomNumber: p.roomNumber,
      therapistNames: therapistIds.map((id) => nameById.get(id) || `#${id}`),
      hadAppointment: !!p.appointmentId,
      realConflict: probe.realConflict,
      plannedConflict: probe.plannedConflict,
      outsideHours: probe.outsideHours,
      conflicts: probe.conflicts,
    });
  }

  return { courseId, targetDayNumber: dayNumber, offset, affected };
}

export interface ApplyRescheduleResult {
  ok: boolean;
  reason?: string;
  blocked?: boolean;
  warning?: boolean;
  clashes?: { dayNumber: number; newDate: string }[];
  plan?: ReschedulePlan;
}

/**
 * Apply the cascade. Hard blocker: the active (materialised) target day must be
 * re-claimable at its new date — otherwise nothing is written. Future days are
 * shifted as `planned` and re-materialise on their turn (their clashes are
 * warnings, resolved later). The old no-show appointment(s) are cancelled.
 */
export async function applyReschedule(
  courseId: number,
  dayNumber: number,
  newDate: string,
  rescheduledBy?: string,
  force = false
): Promise<ApplyRescheduleResult> {
  const plan = await computeReschedule(courseId, dayNumber, newDate);
  if (plan.error) return { ok: false, reason: plan.error, plan };

  // Real clashes (any shifted day) can't be double-booked → hard block, no override.
  const realClashes = plan.affected.filter((a) => a.realConflict || a.outsideHours);
  if (realClashes.length) {
    return {
      ok: false,
      blocked: true,
      reason: "real_conflict",
      clashes: realClashes.map((a) => ({ dayNumber: a.dayNumber, newDate: a.newDate })),
      plan,
    };
  }

  // Tentative (planned) clashes → warn, allow proceed with force.
  const plannedClashes = plan.affected.filter((a) => a.plannedConflict);
  if (plannedClashes.length && !force) {
    return {
      ok: false,
      warning: true,
      reason: "planned_conflict",
      clashes: plannedClashes.map((a) => ({ dayNumber: a.dayNumber, newDate: a.newDate })),
      plan,
    };
  }

  const target = plan.affected.find((a) => a.dayNumber === dayNumber)!;

  // Cancel any existing appointment on each affected day and shift its date to
  // `planned` (only the target is re-materialised below).
  for (const a of plan.affected) {
    const pd = await prisma.therapyCoursePlanDay.findUnique({
      where: { courseId_dayNumber: { courseId, dayNumber: a.dayNumber } },
    });
    if (!pd) continue;
    if (pd.appointmentId) {
      await prisma.therapyAppointment.update({
        where: { id: pd.appointmentId },
        data: {
          status: "cancelled",
          cancelledBy: rescheduledBy || "reschedule",
          cancelledAt: new Date(),
        },
      });
    }
    await prisma.therapyCoursePlanDay.update({
      where: { id: pd.id },
      data: { plannedDate: a.newDate, status: "planned", appointmentId: null },
    });
  }

  // Re-claim the slot for the active day at its new date (reschedule message).
  if (target.hadAppointment) {
    const r = await materializeDay(courseId, dayNumber, "reschedule");
    if (!r.ok) return { ok: false, reason: `materialize_failed:${r.reason}`, plan };
  }

  return { ok: true, plan };
}

// ── Cancel course ────────────────────────────────────────────────────────

export interface CancelCourseResult {
  ok: boolean;
  reason?: "not_found";
  cancelledDays?: number;
}

/**
 * Cancel a whole course. Completed days are left as history; every other day is
 * marked `cancelled`, and any materialised (active) appointment is cancelled
 * with a cancel WhatsApp to patient / doctor / therapists.
 */
export async function cancelCourse(
  courseId: number,
  cancelledBy?: string
): Promise<CancelCourseResult> {
  const course = await prisma.therapyCourse.findUnique({
    where: { id: courseId },
    include: { planDays: true },
  });
  if (!course) return { ok: false, reason: "not_found" };

  let cancelledDays = 0;
  for (const pd of course.planDays) {
    if (pd.status === "completed" || pd.status === "cancelled") continue;

    if (pd.appointmentId) {
      await prisma.therapyAppointment.update({
        where: { id: pd.appointmentId },
        data: {
          status: "cancelled",
          cancelledBy: cancelledBy || "course-cancel",
          cancelledAt: new Date(),
        },
      });
      await sendCourseNotifications(pd.appointmentId, "cancel");
    }

    await prisma.therapyCoursePlanDay.update({
      where: { id: pd.id },
      data: { status: "cancelled" },
    });
    cancelledDays++;
  }

  await prisma.therapyCourse.update({
    where: { id: courseId },
    data: { status: "cancelled" },
  });

  return { ok: true, cancelledDays };
}
