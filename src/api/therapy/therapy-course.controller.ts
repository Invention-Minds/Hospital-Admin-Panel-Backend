import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  toMinutes,
  slotEndMin,
  isWithinWorkingHours,
  addDaysToDateStr,
} from "./therapy-scheduling.util";
import {
  materializeDay,
  computeReschedule,
  applyReschedule,
  cancelCourse,
  findCourseClashes,
} from "./therapy-course.service";

const prisma = new PrismaClient();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

interface PlanDayInput {
  time: string;
  roomNumber: string;
  totalDurationMinutes: number;
  therapistIds: number[];
  therapyIds: number[];
  hasBathing?: boolean;
  plannedDate?: string;
}

/** Validate one day's shape + working-hours. Returns an error string or null. */
const validateDay = (d: PlanDayInput, label: string): string | null => {
  if (!d || typeof d !== "object") return `${label}: missing plan`;
  if (!d.time || !TIME_RE.test(d.time)) return `${label}: time (HH:mm) is required`;
  if (!d.roomNumber) return `${label}: roomNumber is required`;
  if (!Array.isArray(d.therapistIds) || d.therapistIds.length === 0 || d.therapistIds.length > 2)
    return `${label}: select 1 or 2 therapists`;
  if (!Array.isArray(d.therapyIds) || d.therapyIds.length === 0)
    return `${label}: select at least 1 therapy`;
  const dur = Number(d.totalDurationMinutes);
  if (!dur || dur <= 0) return `${label}: totalDurationMinutes must be > 0`;
  if (d.plannedDate && !DATE_RE.test(d.plannedDate)) return `${label}: plannedDate must be YYYY-MM-DD`;
  const startMin = toMinutes(d.time);
  if (!isWithinWorkingHours(startMin, slotEndMin(startMin, dur)))
    return `${label}: must fall within 06:00–18:00 (incl. buffer)`;
  return null;
};

/**
 * Create a multi-day therapy course.
 *
 * Stores the full N-day plan upfront, then immediately materialises day 1 into
 * a slot-holding appointment (hybrid model). If day 1 can't claim its slot, the
 * whole course is rolled back so the operator can pick another time.
 *
 * POST /api/therapy-appt/courses
 * Body: {
 *   prn, prefix?, name, phone, email?, gender?, age?, doctorId?, remarks?,
 *   totalDays, startDate,
 *   days: [{ time, roomNumber, totalDurationMinutes, therapistIds[], therapyIds[], hasBathing?, plannedDate? }]
 * }
 * If `days` has one entry and totalDays > 1, that entry is repeated for every
 * day (plannedDate = startDate + dayOffset).
 */
export const createTherapyCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      prn, prefix, name, phone, email, gender, age, doctorId, remarks,
      totalDays, startDate, days, intervalDays,
    } = req.body;

    // Gap between sessions: 1 = consecutive days, 2 = alternate, etc.
    const interval = Number(intervalDays) || 1;

    if (!prn || !name || !phone) {
      res.status(400).json({ message: "prn, name and phone are required" });
      return;
    }
    const nDays = Number(totalDays);
    if (!nDays || nDays <= 0) {
      res.status(400).json({ message: "totalDays must be > 0" });
      return;
    }
    if (!startDate || !DATE_RE.test(startDate)) {
      res.status(400).json({ message: "startDate (YYYY-MM-DD) is required" });
      return;
    }
    if (interval < 1) {
      res.status(400).json({ message: "intervalDays must be >= 1" });
      return;
    }
    if (!Array.isArray(days) || days.length === 0) {
      res.status(400).json({ message: "days[] is required" });
      return;
    }

    // Expand: a single day template repeats across the whole course.
    let expanded: PlanDayInput[];
    if (days.length === 1 && nDays > 1) {
      expanded = Array.from({ length: nDays }, () => ({ ...days[0] }));
    } else if (days.length === nDays) {
      expanded = days;
    } else {
      res.status(400).json({ message: `days[] must have 1 or ${nDays} entries` });
      return;
    }

    for (let i = 0; i < expanded.length; i++) {
      const err = validateDay(expanded[i], `Day ${i + 1}`);
      if (err) {
        res.status(400).json({ message: err });
        return;
      }
    }

    // Concrete planned-day rows, computed up front so we can clash-check before any write.
    const plannedDays = expanded.map((d, i) => ({
      dayNumber: i + 1,
      plannedDate: d.plannedDate || addDaysToDateStr(startDate, i * interval),
      time: d.time,
      roomNumber: d.roomNumber,
      totalDurationMinutes: Number(d.totalDurationMinutes),
      hasBathing: !!d.hasBathing,
      therapistIds: d.therapistIds.map((x) => Number(x)),
      therapyIds: d.therapyIds.map((x) => Number(x)),
    }));

    // Hard block: any planned day clashing with an existing booking OR another
    // course's planned day (same room/therapist + overlapping time) rejects the
    // whole course.
    const clashes = await findCourseClashes(plannedDays);
    const realClashes = clashes.filter((c) => c.type === "real");
    const plannedClashes = clashes.filter((c) => c.type === "planned");

    // Real bookings can't be double-booked → hard block (no override).
    if (realClashes.length) {
      const detail = realClashes.map((c) => `Day ${c.dayNumber} (${c.plannedDate})`).join(", ");
      res.status(409).json({
        blocked: true,
        message: `Schedule clash — the therapist or room is already booked on: ${detail}. Change the start date, interval, time, room or therapist.`,
        clashes: realClashes,
      });
      return;
    }

    // Tentative (planned) course days → warn, allow proceed with force.
    if (plannedClashes.length && req.body.force !== true) {
      const detail = plannedClashes.map((c) => `Day ${c.dayNumber} (${c.plannedDate})`).join(", ");
      res.status(409).json({
        warning: true,
        message: `A tentative course session is already planned for the same therapist/room on: ${detail}. Proceed anyway?`,
        clashes: plannedClashes,
      });
      return;
    }

    const course = await prisma.therapyCourse.create({
      data: {
        prn: Number(prn), prefix: prefix || null, name, phone, email: email || null,
        gender: gender || null, age: age ?? null,
        doctorId: doctorId ? Number(doctorId) : null,
        totalDays: nDays, startDate, status: "active", remarks: remarks || null,
      },
    });

    await prisma.therapyCoursePlanDay.createMany({
      data: plannedDays.map((d) => ({
        courseId: course.id,
        dayNumber: d.dayNumber,
        status: "planned",
        plannedDate: d.plannedDate,
        time: d.time,
        roomNumber: d.roomNumber,
        hasBathing: d.hasBathing,
        totalDurationMinutes: d.totalDurationMinutes,
        plannedTherapistIds: d.therapistIds,
        plannedTherapyIds: d.therapyIds,
      })),
    });

    // Materialise day 1 — must claim its slot or the course is invalid.
    const result = await materializeDay(course.id, 1);
    if (!result.ok) {
      await prisma.therapyCoursePlanDay.deleteMany({ where: { courseId: course.id } });
      await prisma.therapyCourse.delete({ where: { id: course.id } });
      res.status(400).json({
        message: "Day 1 slot is unavailable — pick another time/room/therapist.",
        reason: result.reason,
      });
      return;
    }

    const full = await loadCourse(course.id);
    res.status(201).json({ message: "Therapy course created", course: full });
  } catch (err) {
    console.error("Error creating therapy course:", err);
    res.status(500).json({ message: "Failed to create therapy course" });
  }
};

/**
 * Tentative (planned, not-yet-materialised) course days on a date — for the
 * booking form's per-day availability hints. Shaped like the schedule endpoint.
 * GET /api/therapy-appt/planned-days?date=YYYY-MM-DD
 */
export const getPlannedDaysByDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const date = req.query.date as string;
    if (!date || !DATE_RE.test(date)) {
      res.status(400).json({ message: "date (YYYY-MM-DD) is required" });
      return;
    }
    const rows = await prisma.therapyCoursePlanDay.findMany({
      where: { plannedDate: date, status: "planned" },
      select: { time: true, roomNumber: true, totalDurationMinutes: true, plannedTherapistIds: true },
    });
    res.json(
      rows.map((r) => ({
        time: r.time,
        roomNumber: r.roomNumber,
        totalDurationMinutes: r.totalDurationMinutes,
        therapists: ((r.plannedTherapistIds as number[]) || []).map((id) => ({ therapistId: Number(id) })),
      }))
    );
  } catch (err) {
    console.error("Error fetching planned days:", err);
    res.status(500).json({ message: "Failed to fetch planned days" });
  }
};

/**
 * List therapy courses with progress counts.
 * GET /api/therapy-appt/courses?status=&prn=&doctorId=
 */
export const getTherapyCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, prn, doctorId } = req.query;
    const where: Record<string, unknown> = {};
    if (status) where.status = String(status);
    if (prn) where.prn = Number(prn);
    if (doctorId) where.doctorId = Number(doctorId);

    const courses = await prisma.therapyCourse.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        doctor: { select: { id: true, name: true } },
        planDays: { select: { status: true } },
      },
    });

    const formatted = courses.map((c) => {
      const completed = c.planDays.filter((d) => d.status === "completed").length;
      const cancelled = c.planDays.filter((d) => d.status === "cancelled").length;
      const { planDays, ...rest } = c;
      return {
        ...rest,
        progress: { total: planDays.length, completed, cancelled },
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("Error listing therapy courses:", err);
    res.status(500).json({ message: "Failed to list therapy courses" });
  }
};

/**
 * Cancel a course (completed days kept as history; active appointment cancelled).
 * PATCH /api/therapy-appt/courses/:id/cancel  { cancelledBy? }
 */
export const cancelTherapyCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ message: "Invalid course id" });
      return;
    }

    const result = await cancelCourse(id, req.body?.cancelledBy);
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 400).json({
        message: "Cannot cancel course", reason: result.reason,
      });
      return;
    }

    const course = await loadCourse(id);
    res.json({ message: "Course cancelled", cancelledDays: result.cancelledDays, course });
  } catch (err) {
    console.error("Error cancelling therapy course:", err);
    res.status(500).json({ message: "Failed to cancel therapy course" });
  }
};

/** GET /api/therapy-appt/courses/:id */
export const getTherapyCourseById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ message: "Invalid course id" });
      return;
    }
    const course = await loadCourse(id);
    if (!course) {
      res.status(404).json({ message: "Course not found" });
      return;
    }
    res.json(course);
  } catch (err) {
    console.error("Error fetching therapy course:", err);
    res.status(500).json({ message: "Failed to fetch therapy course" });
  }
};

const RESCHEDULE_NOT_FOUND = new Set(["not_found", "day_not_found"]);

/**
 * Preview a cascade reschedule — no writes. Returns the shifted plan with a
 * clash flag per day so the operator can review before confirming.
 *
 * POST /api/therapy-appt/courses/:id/reschedule-preview  { dayNumber, newDate }
 */
export const previewCourseReschedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { dayNumber, newDate } = req.body;
    if (!id || isNaN(id)) {
      res.status(400).json({ message: "Invalid course id" });
      return;
    }
    if (!dayNumber || isNaN(Number(dayNumber))) {
      res.status(400).json({ message: "dayNumber is required" });
      return;
    }
    if (!newDate || !DATE_RE.test(newDate)) {
      res.status(400).json({ message: "newDate (YYYY-MM-DD) is required" });
      return;
    }

    const plan = await computeReschedule(id, Number(dayNumber), newDate);
    if (plan.error) {
      res.status(RESCHEDULE_NOT_FOUND.has(plan.error) ? 404 : 400).json({
        message: "Cannot reschedule", reason: plan.error,
      });
      return;
    }
    res.json(plan);
  } catch (err) {
    console.error("Error previewing course reschedule:", err);
    res.status(500).json({ message: "Failed to preview reschedule" });
  }
};

/**
 * Apply a cascade reschedule (operator-confirmed). Requires `confirm: true`.
 *
 * POST /api/therapy-appt/courses/:id/reschedule  { dayNumber, newDate, confirm, rescheduledBy? }
 */
export const applyCourseReschedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { dayNumber, newDate, confirm, rescheduledBy, force } = req.body;
    if (!id || isNaN(id)) {
      res.status(400).json({ message: "Invalid course id" });
      return;
    }
    if (!dayNumber || isNaN(Number(dayNumber))) {
      res.status(400).json({ message: "dayNumber is required" });
      return;
    }
    if (!newDate || !DATE_RE.test(newDate)) {
      res.status(400).json({ message: "newDate (YYYY-MM-DD) is required" });
      return;
    }
    if (confirm !== true) {
      res.status(400).json({ message: "confirm: true is required to apply the reschedule" });
      return;
    }

    const result = await applyReschedule(id, Number(dayNumber), newDate, rescheduledBy, force === true);
    if (!result.ok) {
      const days = (result.clashes || []).map((c) => `Day ${c.dayNumber} (${c.newDate})`).join(", ");
      // Real clash → hard block; planned clash → warn (proceed with force).
      if (result.blocked) {
        res.status(409).json({
          blocked: true,
          message: `Schedule clash — the therapist or room is already booked on: ${days}. Pick another date.`,
          clashes: result.clashes,
          plan: result.plan,
        });
        return;
      }
      if (result.warning) {
        res.status(409).json({
          warning: true,
          message: `A tentative course session is already planned for the same therapist/room on: ${days}. Proceed anyway?`,
          clashes: result.clashes,
          plan: result.plan,
        });
        return;
      }
      const status = result.reason && RESCHEDULE_NOT_FOUND.has(result.reason) ? 404 : 400;
      res.status(status).json({ message: "Reschedule failed", reason: result.reason, plan: result.plan });
      return;
    }

    const course = await loadCourse(id);
    res.json({ message: "Course rescheduled", plan: result.plan, course });
  } catch (err) {
    console.error("Error applying course reschedule:", err);
    res.status(500).json({ message: "Failed to reschedule course" });
  }
};

/** Course + ordered plan days, each with its materialised appointment summary. */
async function loadCourse(id: number) {
  return prisma.therapyCourse.findUnique({
    where: { id },
    include: {
      doctor: { select: { id: true, name: true } },
      planDays: {
        orderBy: { dayNumber: "asc" },
        include: {
          appointment: {
            select: {
              id: true, date: true, time: true, status: true, roomNumber: true,
              checkedIn: true, therapyFinished: true,
            },
          },
        },
      },
    },
  });
}
