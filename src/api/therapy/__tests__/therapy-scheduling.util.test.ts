/**
 * Phase 2 — therapist availability computation (pure helpers).
 */

import {
  appointmentsToBusy,
  computeFreeWindows,
  splitDuration,
  fromMinutes,
  toMinutes,
  addDaysToDateStr,
  diffDaysDateStr,
} from "../therapy-scheduling.util";

describe("diffDaysDateStr", () => {
  it("computes positive, zero, and negative offsets", () => {
    expect(diffDaysDateStr("2026-06-10", "2026-06-03")).toBe(7);
    expect(diffDaysDateStr("2026-06-03", "2026-06-03")).toBe(0);
    expect(diffDaysDateStr("2026-06-01", "2026-06-03")).toBe(-2);
  });
  it("is the inverse of addDaysToDateStr", () => {
    const base = "2026-06-03";
    const shifted = addDaysToDateStr(base, 9);
    expect(diffDaysDateStr(shifted, base)).toBe(9);
  });
});

describe("addDaysToDateStr", () => {
  it("returns the same date for offset 0", () => {
    expect(addDaysToDateStr("2026-06-03", 0)).toBe("2026-06-03");
  });
  it("adds days across month and year boundaries", () => {
    expect(addDaysToDateStr("2026-06-03", 1)).toBe("2026-06-04");
    expect(addDaysToDateStr("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysToDateStr("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("handles multi-day course spans", () => {
    expect(addDaysToDateStr("2026-06-03", 6)).toBe("2026-06-09");
  });
});

describe("therapy-scheduling.util — time helpers", () => {
  it("round-trips minutes <-> HH:mm", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(fromMinutes(570)).toBe("09:30");
    expect(fromMinutes(6 * 60)).toBe("06:00");
  });
});

describe("appointmentsToBusy", () => {
  it("spans session + 5-min buffer", () => {
    const [busy] = appointmentsToBusy([
      { id: 1, time: "09:00", totalDurationMinutes: 75 },
    ]);
    expect(busy.startTime).toBe("09:00");
    // 540 + 75 + 5 = 620 → 10:20
    expect(busy.endTime).toBe("10:20");
    expect(busy.appointmentId).toBe(1);
  });

  it("treats null duration as 0 (+ buffer only)", () => {
    const [busy] = appointmentsToBusy([
      { time: "12:00", totalDurationMinutes: null },
    ]);
    expect(busy.endTime).toBe("12:05");
  });
});

describe("computeFreeWindows", () => {
  it("returns the whole clinic window when nothing is booked", () => {
    const free = computeFreeWindows([]);
    expect(free).toHaveLength(1);
    expect(free[0].startTime).toBe("06:00");
    expect(free[0].endTime).toBe("18:00");
  });

  it("splits the day around a single booking", () => {
    const busy = appointmentsToBusy([
      { time: "09:00", totalDurationMinutes: 75 }, // 09:00–10:20 (incl. 5m buffer)
    ]);
    const free = computeFreeWindows(busy);
    expect(free.map((f) => [f.startTime, f.endTime])).toEqual([
      ["06:00", "09:00"],
      ["10:20", "18:00"],
    ]);
  });

  it("merges overlapping bookings into one busy gap", () => {
    const busy = appointmentsToBusy([
      { time: "09:00", totalDurationMinutes: 75 }, // 09:00–10:20
      { time: "10:00", totalDurationMinutes: 90 }, // 10:00–11:35
    ]);
    const free = computeFreeWindows(busy);
    expect(free.map((f) => [f.startTime, f.endTime])).toEqual([
      ["06:00", "09:00"],
      ["11:35", "18:00"],
    ]);
  });

  it("clips bookings to the clinic window", () => {
    // A booking ending after 18:00 should not produce a free window past close.
    const busy = appointmentsToBusy([
      { time: "17:30", totalDurationMinutes: 60 }, // 17:30–18:35 → clipped at 18:00
    ]);
    const free = computeFreeWindows(busy);
    expect(free).toEqual([
      expect.objectContaining({ startTime: "06:00", endTime: "17:30" }),
    ]);
  });
});

describe("splitDuration", () => {
  it("uses 70/15/15 with bathing", () => {
    expect(splitDuration(100, true)).toEqual({
      therapyMinutes: 70,
      cleaningMinutes: 15,
      bathingMinutes: 15,
    });
  });

  it("uses 85/15/0 without bathing", () => {
    expect(splitDuration(100, false)).toEqual({
      therapyMinutes: 85,
      cleaningMinutes: 15,
      bathingMinutes: 0,
    });
  });
});
