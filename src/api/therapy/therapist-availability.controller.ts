import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  OPEN_MIN,
  CLOSE_MIN,
  fromMinutes,
  appointmentsToBusy,
  computeFreeWindows,
} from "./therapy-scheduling.util";

const prisma = new PrismaClient();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Therapist availability for a single date.
 *
 * Blocks-only model: availability = clinic hours (06:00–18:00) − existing
 * confirmed/completed bookings − leave day − blocked slots. There is no
 * recurring weekly schedule; a therapist is bookable in clinic hours unless
 * explicitly blocked.
 *
 * GET /api/therapy-appt/availability?therapistId=&date=YYYY-MM-DD
 */
export const getTherapistAvailability = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const therapistId = Number(req.query.therapistId);
    const date = req.query.date as string;

    if (!therapistId || isNaN(therapistId)) {
      res.status(400).json({ message: "therapistId is required" });
      return;
    }
    if (!date || !DATE_RE.test(date)) {
      res.status(400).json({ message: "date (YYYY-MM-DD) is required" });
      return;
    }

    const therapist = await prisma.therapist.findUnique({
      where: { id: therapistId },
      select: { id: true, name: true, isActive: true },
    });
    if (!therapist) {
      res.status(404).json({ message: "Therapist not found" });
      return;
    }

    const [appts, dayOff, blocked] = await Promise.all([
      prisma.therapyAppointment.findMany({
        where: {
          date,
          status: { in: ["confirmed", "completed"] },
          therapists: { some: { therapistId } },
        },
        select: { id: true, time: true, totalDurationMinutes: true },
      }),
      prisma.therapistUnavailableDates.findFirst({
        where: { therapistId, date },
      }),
      prisma.therapistUnavailableSlot.findMany({
        where: { therapistId, date },
        select: { time: true },
        orderBy: { time: "asc" },
      }),
    ]);

    const isDayOff = !!dayOff;
    const busy = appointmentsToBusy(appts);
    const blockedSlots = blocked.map((b) => b.time);
    const free = isDayOff ? [] : computeFreeWindows(busy);

    res.json({
      therapistId,
      therapistName: therapist.name,
      date,
      isDayOff,
      workingWindow: { start: fromMinutes(OPEN_MIN), end: fromMinutes(CLOSE_MIN) },
      busy,
      blockedSlots,
      free,
    });
  } catch (error) {
    console.error("Error fetching therapist availability:", error);
    res.status(500).json({ message: "Failed to fetch therapist availability" });
  }
};

/**
 * Block one or more whole days for a therapist (leave / day off).
 * POST /api/therapy-appt/unavailable-dates  { therapistId, dates: string[], createdBy? }
 */
export const addTherapistUnavailableDates = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { therapistId, dates, createdBy } = req.body;

    if (!therapistId || !Array.isArray(dates) || dates.length === 0) {
      res
        .status(400)
        .json({ message: "therapistId and a non-empty dates[] are required" });
      return;
    }
    if (!dates.every((d: string) => DATE_RE.test(d))) {
      res.status(400).json({ message: "All dates must be YYYY-MM-DD" });
      return;
    }

    await prisma.therapistUnavailableDates.createMany({
      data: dates.map((date: string) => ({
        therapistId: Number(therapistId),
        date,
        createdBy: createdBy || null,
      })),
      skipDuplicates: true,
    });

    res.status(201).json({ message: "Unavailable dates added" });
  } catch (error) {
    console.error("Error adding therapist unavailable dates:", error);
    res.status(500).json({ message: "Failed to add unavailable dates" });
  }
};

/**
 * List a therapist's blocked days.
 * GET /api/therapy-appt/unavailable-dates?therapistId=
 */
export const getTherapistUnavailableDates = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const therapistId = Number(req.query.therapistId);
    if (!therapistId || isNaN(therapistId)) {
      res.status(400).json({ message: "therapistId is required" });
      return;
    }

    const rows = await prisma.therapistUnavailableDates.findMany({
      where: { therapistId },
      select: { date: true },
      orderBy: { date: "asc" },
    });

    res.json(rows.map((r) => r.date));
  } catch (error) {
    console.error("Error fetching therapist unavailable dates:", error);
    res.status(500).json({ message: "Failed to fetch unavailable dates" });
  }
};

/**
 * Re-open previously blocked days.
 * PATCH /api/therapy-appt/therapist/:therapistId/mark-available  { dates: string[] }
 */
export const markTherapistDatesAvailable = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const therapistId = Number(req.params.therapistId);
    const { dates } = req.body;

    if (!therapistId || isNaN(therapistId)) {
      res.status(400).json({ message: "Invalid therapistId" });
      return;
    }
    if (!Array.isArray(dates) || dates.length === 0) {
      res.status(400).json({ message: "A non-empty dates[] is required" });
      return;
    }

    await prisma.therapistUnavailableDates.deleteMany({
      where: { therapistId, date: { in: dates } },
    });

    res.json({ message: "Dates marked available" });
  } catch (error) {
    console.error("Error marking therapist dates available:", error);
    res.status(500).json({ message: "Failed to mark dates available" });
  }
};

/**
 * Replace the blocked time slots for a therapist on a given date.
 * POST /api/therapy-appt/unavailable-slots  { therapistId, date, times: string[], createdBy? }
 */
export const addTherapistUnavailableSlots = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { therapistId, date, times, createdBy } = req.body;

    if (!therapistId || !date || !Array.isArray(times)) {
      res
        .status(400)
        .json({ message: "therapistId, date and times[] are required" });
      return;
    }
    if (!DATE_RE.test(date)) {
      res.status(400).json({ message: "date must be YYYY-MM-DD" });
      return;
    }

    // Delete-then-recreate this date's blocks (mirrors the doctor handler).
    await prisma.therapistUnavailableSlot.deleteMany({
      where: { therapistId: Number(therapistId), date },
    });

    if (times.length > 0) {
      await prisma.therapistUnavailableSlot.createMany({
        data: times.map((time: string) => ({
          therapistId: Number(therapistId),
          date,
          time,
          createdBy: createdBy || null,
        })),
        skipDuplicates: true,
      });
    }

    res.status(201).json({ message: "Unavailable slots updated" });
  } catch (error) {
    console.error("Error adding therapist unavailable slots:", error);
    res.status(500).json({ message: "Failed to update unavailable slots" });
  }
};

/**
 * List a therapist's blocked slots, grouped by date.
 * GET /api/therapy-appt/therapist/:therapistId/unavailable-slots
 */
export const getTherapistUnavailableSlots = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const therapistId = Number(req.params.therapistId);
    if (!therapistId || isNaN(therapistId)) {
      res.status(400).json({ message: "Invalid therapistId" });
      return;
    }

    const slots = await prisma.therapistUnavailableSlot.findMany({
      where: { therapistId },
      select: { date: true, time: true },
    });

    const grouped = slots.reduce((acc: Record<string, string[]>, slot) => {
      (acc[slot.date] ||= []).push(slot.time);
      return acc;
    }, {});

    res.json(grouped);
  } catch (error) {
    console.error("Error fetching therapist unavailable slots:", error);
    res.status(500).json({ message: "Failed to fetch unavailable slots" });
  }
};
