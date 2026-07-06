import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

/**
 * Phase 11 — OT KPI controller.
 *
 * GET /api/ot/kpis?fromDate=&toDate=
 *
 * Returns the four KPIs the OT module is required to surface (NABH PSQ.3 + KPI #6/#7/#16):
 *   1. Utilisation %       — minutes-in-OT / total-room-minutes-available
 *   2. On-time start %     — schedules where actualStart <= plannedStart + 15 min
 *   3. Turnover time avg   — minutes between consecutive cases in same room
 *   4. Reschedule rate     — RESCHEDULED / total bookings in range
 *   5. Unplanned return %  — outcomes flagged unplannedReturn / total CLOSED schedules
 *   6. SSI rate            — outcomes flagged SSI / total CLOSED schedules
 *   7. Checklist adherence % — CLOSED schedules with all 3 WHO signatures (sign-in / time-out / sign-out)
 */

export const getOtKpis = async (req: Request, res: Response): Promise<void> => {
  try {
    const fromQ = req.query.fromDate as string | undefined;
    const toQ = req.query.toDate as string | undefined;

    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - 30);

    const fromDate = fromQ ? new Date(fromQ) : start;
    const toDate = toQ ? new Date(toQ) : today;
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      res.status(400).json({ error: 'fromDate / toDate must be valid ISO dates' });
      return;
    }
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // Pull all schedules in the range, eager-load the children we need.
    const schedules = await prisma.otSchedule.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      include: {
        otRoom: { select: { id: true, name: true, code: true } },
        safetyChecklist: {
          select: {
            signInSignatureId: true,
            timeOutSignatureId: true,
            signOutSignatureId: true,
          },
        },
        outcome: { select: { unplannedReturn: true, surgicalSiteInfection: true } },
      },
    });

    const total = schedules.length;
    if (total === 0) {
      res.status(200).json({
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        totalSchedules: 0,
        utilisation: { totalRoomMinutes: 0, usedMinutes: 0, percentage: 0 },
        onTimeStart: { onTime: 0, total: 0, percentage: 0 },
        turnoverTime: { averageMinutes: 0, samples: 0 },
        rescheduleRate: { rescheduled: 0, total: 0, percentage: 0 },
        unplannedReturnRate: { returned: 0, total: 0, percentage: 0 },
        ssiRate: { withSsi: 0, total: 0, percentage: 0 },
        checklistAdherence: { adherent: 0, total: 0, percentage: 0 },
      });
      return;
    }

    // 1. Utilisation %
    // Total room-minutes available: 12h/day × number of rooms × number of days in range.
    const totalDays = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)));
    const totalRooms = await prisma.otRoom.count();
    const totalRoomMinutes = totalRooms * totalDays * 12 * 60;
    const usedMinutes = schedules.reduce((acc, s) => {
      if (s.actualStart && s.actualEnd) {
        const mins = Math.round((s.actualEnd.getTime() - s.actualStart.getTime()) / 60000);
        return acc + Math.max(0, mins);
      }
      return acc;
    }, 0);
    const utilisationPct = totalRoomMinutes === 0 ? 0 : Math.round((usedMinutes / totalRoomMinutes) * 1000) / 10;

    // 2. On-time start % — actualStart within 15 min of plannedStart.
    const ON_TIME_GRACE_MS = 15 * 60 * 1000;
    let onTime = 0;
    let onTimeScope = 0;
    for (const s of schedules) {
      if (!s.actualStart) continue;
      onTimeScope += 1;
      if (s.actualStart.getTime() <= s.plannedStart.getTime() + ON_TIME_GRACE_MS) onTime += 1;
    }
    const onTimePct = onTimeScope === 0 ? 0 : Math.round((onTime / onTimeScope) * 1000) / 10;

    // 3. Turnover time avg — minutes between consecutive CLOSED cases in same room.
    const closedByRoom = new Map<string, typeof schedules>();
    for (const s of schedules) {
      if (s.status !== 'CLOSED' || !s.actualStart || !s.actualEnd) continue;
      const arr = closedByRoom.get(s.otRoomId) ?? [];
      arr.push(s);
      closedByRoom.set(s.otRoomId, arr);
    }
    let turnoverTotal = 0;
    let turnoverSamples = 0;
    for (const arr of closedByRoom.values()) {
      arr.sort((a, b) => a.actualStart!.getTime() - b.actualStart!.getTime());
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1];
        const curr = arr[i];
        if (prev.actualEnd && curr.actualStart) {
          // Only count turnover between two cases on the SAME calendar day. An
          // overnight / multi-day gap (last case Mon → first case Wed) is not
          // room turnover and would massively inflate the average.
          const sameDay =
            prev.actualEnd.getFullYear() === curr.actualStart.getFullYear() &&
            prev.actualEnd.getMonth() === curr.actualStart.getMonth() &&
            prev.actualEnd.getDate() === curr.actualStart.getDate();
          const gapMs = curr.actualStart.getTime() - prev.actualEnd.getTime();
          if (sameDay && gapMs > 0) {
            turnoverTotal += gapMs / 60000;
            turnoverSamples += 1;
          }
        }
      }
    }
    const avgTurnover = turnoverSamples === 0 ? 0 : Math.round(turnoverTotal / turnoverSamples);

    // 4. Reschedule rate
    const rescheduled = schedules.filter((s) => s.status === 'RESCHEDULED').length;
    const reschedulePct = Math.round((rescheduled / total) * 1000) / 10;

    // 5/6. Unplanned return + SSI from outcomes.
    const closedSchedules = schedules.filter((s) => s.status === 'CLOSED');
    const closedWithOutcome = closedSchedules.filter((s) => s.outcome != null);
    const returnedCount = closedWithOutcome.filter((s) => s.outcome!.unplannedReturn).length;
    const ssiCount = closedWithOutcome.filter((s) => s.outcome!.surgicalSiteInfection).length;
    const closedTotal = closedSchedules.length;
    const returnPct = closedTotal === 0 ? 0 : Math.round((returnedCount / closedTotal) * 1000) / 10;
    const ssiPct = closedTotal === 0 ? 0 : Math.round((ssiCount / closedTotal) * 1000) / 10;

    // 7. Checklist adherence — all 3 WHO signatures present on CLOSED schedules.
    const adherent = closedSchedules.filter((s) =>
      !!s.safetyChecklist?.signInSignatureId &&
      !!s.safetyChecklist?.timeOutSignatureId &&
      !!s.safetyChecklist?.signOutSignatureId,
    ).length;
    const checklistPct = closedTotal === 0 ? 0 : Math.round((adherent / closedTotal) * 1000) / 10;

    res.status(200).json({
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      totalSchedules: total,
      utilisation: { totalRoomMinutes, usedMinutes, percentage: utilisationPct },
      onTimeStart: { onTime, total: onTimeScope, percentage: onTimePct },
      turnoverTime: { averageMinutes: avgTurnover, samples: turnoverSamples },
      rescheduleRate: { rescheduled, total, percentage: reschedulePct },
      unplannedReturnRate: { returned: returnedCount, total: closedTotal, percentage: returnPct },
      ssiRate: { withSsi: ssiCount, total: closedTotal, percentage: ssiPct },
      checklistAdherence: { adherent, total: closedTotal, percentage: checklistPct },
    });
  } catch (error) {
    console.error('[ot-kpi] getOtKpis failed:', error);
    res.status(500).json({ error: 'Failed to compute OT KPIs' });
  }
};
