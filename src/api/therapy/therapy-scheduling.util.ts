/**
 * Shared therapy scheduling helpers.
 *
 * Extracted verbatim from the original inline logic in
 * `createTherapyAppointment` / `updateTherapyAppointment` so booking, multi-day
 * course materialisation, the availability endpoint, and the reschedule preview
 * all share one source of truth. Behaviour is intentionally unchanged.
 */

export const OPEN_MIN = 6 * 60; // 06:00
export const CLOSE_MIN = 18 * 60; // 18:00
export const BUFFER_MIN = 5; // post-session buffer (therapist/room free this long after each session)

/** "HH:mm" → minutes since midnight. */
export const toMinutes = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** minutes since midnight → "HH:mm". */
export const fromMinutes = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const dateStrToUTC = (s: string): number => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * Add a whole number of days to a "YYYY-MM-DD" string, returning the same
 * format. UTC-based so it's free of local-timezone / DST drift. Accepts
 * negative offsets.
 */
export const addDaysToDateStr = (dateStr: string, days: number): string => {
  const dt = new Date(dateStrToUTC(dateStr));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

/** Whole-day difference a − b between two "YYYY-MM-DD" strings (can be negative). */
export const diffDaysDateStr = (a: string, b: string): number =>
  Math.round((dateStrToUTC(a) - dateStrToUTC(b)) / 86_400_000);

/** Half-open interval overlap: [aStart,aEnd) ∩ [bStart,bEnd) ≠ ∅. */
export const overlaps = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean => aStart < bEnd && bStart < aEnd;

/** End minute of a slot, including the post-session buffer. */
export const slotEndMin = (startMin: number, durationMinutes: number): number =>
  startMin + durationMinutes + BUFFER_MIN;

/** True when the slot fits inside the 06:00–18:00 working window. */
export const isWithinWorkingHours = (startMin: number, endMin: number): boolean =>
  startMin >= OPEN_MIN && endMin <= CLOSE_MIN;

/** Same-day candidate appointment as selected for conflict checks. */
export interface SchedulingCandidate {
  time: string;
  roomNumber: string;
  totalDurationMinutes: number | null;
  therapists: { therapistId: number }[];
}

export interface SlotRequest {
  startMin: number;
  endMin: number;
  roomNumber: string;
  therapistIds: number[];
}

/**
 * True when the requested slot collides with any candidate on either the room
 * or a shared therapist (within the buffered time range). Mirrors the original
 * `candidates.some(...)` block exactly.
 */
export const hasSlotConflict = (
  candidates: SchedulingCandidate[],
  req: SlotRequest
): boolean =>
  candidates.some((appt) => {
    const aStart = toMinutes(appt.time);
    const aDur = Number(appt.totalDurationMinutes || 0);
    const aEnd = slotEndMin(aStart, aDur);

    if (!overlaps(req.startMin, req.endMin, aStart, aEnd)) return false;

    // Room conflict
    if (appt.roomNumber === req.roomNumber) return true;

    // Therapist conflict
    const booked = appt.therapists.map((t) => t.therapistId);
    return booked.some((id) => req.therapistIds.includes(id));
  });

/** A booked/blocked stretch of a therapist's day. */
export interface BusyInterval {
  startMin: number;
  endMin: number;
  startTime: string;
  endTime: string;
  appointmentId?: number;
}

export interface AppointmentLike {
  id?: number;
  time: string;
  totalDurationMinutes: number | null;
}

/**
 * Convert a therapist's same-day appointments into busy intervals. Each session
 * occupies its slot plus the post-session buffer (same span the conflict guard
 * uses), so adjacent bookings render correctly.
 */
export const appointmentsToBusy = (appts: AppointmentLike[]): BusyInterval[] =>
  appts.map((a) => {
    const startMin = toMinutes(a.time);
    const endMin = slotEndMin(startMin, Number(a.totalDurationMinutes || 0));
    return {
      startMin,
      endMin,
      startTime: fromMinutes(startMin),
      endTime: fromMinutes(endMin),
      appointmentId: a.id,
    };
  });

export interface FreeWindow {
  startMin: number;
  endMin: number;
  startTime: string;
  endTime: string;
}

/**
 * Free gaps inside the clinic window after removing busy intervals (overlaps
 * and out-of-window parts handled). Returns [] when fully booked.
 */
export const computeFreeWindows = (
  busy: BusyInterval[],
  openMin: number = OPEN_MIN,
  closeMin: number = CLOSE_MIN
): FreeWindow[] => {
  const sorted = [...busy].sort((a, b) => a.startMin - b.startMin);
  const free: FreeWindow[] = [];
  let cursor = openMin;

  for (const b of sorted) {
    const bStart = Math.max(b.startMin, openMin);
    const bEnd = Math.min(b.endMin, closeMin);
    if (bEnd <= openMin || bStart >= closeMin) continue; // outside window
    if (bStart > cursor) {
      free.push({
        startMin: cursor,
        endMin: bStart,
        startTime: fromMinutes(cursor),
        endTime: fromMinutes(bStart),
      });
    }
    cursor = Math.max(cursor, bEnd);
  }

  if (cursor < closeMin) {
    free.push({
      startMin: cursor,
      endMin: closeMin,
      startTime: fromMinutes(cursor),
      endTime: fromMinutes(closeMin),
    });
  }
  return free;
};

export interface DurationSplit {
  therapyMinutes: number;
  cleaningMinutes: number;
  bathingMinutes: number;
}

/**
 * Split a booked duration into therapy / cleaning / bathing minutes.
 * With bathing: 70 / 15 / 15. Without: 85 / 15 / 0.
 */
export const splitDuration = (
  totalDurationMinutes: number,
  hasBathing: boolean
): DurationSplit => {
  if (hasBathing) {
    return {
      therapyMinutes: Math.round(totalDurationMinutes * 0.7),
      cleaningMinutes: Math.round(totalDurationMinutes * 0.15),
      bathingMinutes: Math.round(totalDurationMinutes * 0.15),
    };
  }
  return {
    therapyMinutes: Math.round(totalDurationMinutes * 0.85),
    cleaningMinutes: Math.round(totalDurationMinutes * 0.15),
    bathingMinutes: 0,
  };
};
