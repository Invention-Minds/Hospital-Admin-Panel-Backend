import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.3a — OT reports.
//
// Three aggregate views the reference HMIS exposes via the OT MGMT
// reports sub-menu:
//   * Surgery Register        — date-range list of all schedules
//   * Equipment Utilization   — sum of usedMinutes per equipment + freq
//   * OT Time Booked vs Actual — planned vs actual times per schedule
//
// All endpoints read-only; no audit logging.

// ─── Helpers ────────────────────────────────────────────────────────────

function parseRange(req: Request): { from: Date; to: Date } {
  const fromStr = (req.query.fromDate as string) || (req.query.from as string) || '';
  const toStr = (req.query.toDate as string) || (req.query.to as string) || '';
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30); // last 30 days default
  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : now;
  // Anchor to start/end of day to catch the full window
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// ─── Surgery Register ───────────────────────────────────────────────────

export const surgeryRegister = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = parseRange(req);
    const status = req.query.status as string | undefined;
    const otRoomId = req.query.otRoomId as string | undefined;
    const surgeonName = req.query.surgeonName as string | undefined;

    const rows = await prisma.otSchedule.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(status && { status }),
        ...(otRoomId && { otRoomId }),
        ...(surgeonName && { surgeonName: { contains: surgeonName } }),
      },
      include: {
        otRoom: { select: { name: true, code: true } },
        surgeries: { where: { isPrimary: true }, select: { surgeryName: true, departmentName: true, categoryCode: true } },
      },
      orderBy: { date: 'desc' },
      take: 1000,
    });

    const flat = rows.map((r) => {
      const primary = r.surgeries[0];
      return {
        id: r.id,
        date: r.date,
        otRoom: r.otRoom?.name || r.otRoom?.code || null,
        prn: r.prn,
        patientName: r.patientName,
        procedureName: primary?.surgeryName ?? r.procedureName,
        department: primary?.departmentName ?? null,
        category: primary?.categoryCode ?? null,
        surgeonName: r.surgeonName,
        anaesthesiologistName: r.anaesthesiologistName,
        urgency: r.urgency,
        status: r.status,
        plannedStart: r.plannedStart,
        plannedEnd: r.plannedEnd,
        actualStart: r.actualStart,
        actualEnd: r.actualEnd,
        otAdmissionAt: r.otAdmissionAt,
        otDischargeAt: r.otDischargeAt,
      };
    });

    res.status(200).json({
      data: flat,
      meta: { from, to, total: flat.length },
    });
  } catch (error) {
    console.error('[ot-reports] surgeryRegister failed:', error);
    res.status(500).json({ message: 'Failed to load surgery register' });
  }
};

// ─── Equipment Utilization ──────────────────────────────────────────────

export const equipmentUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = parseRange(req);

    // Pull all equipment-usage rows linked to schedules in range. We do
    // the aggregation in app-code (rather than groupBy) so we can include
    // the count of distinct schedules per equipment in one pass.
    const rows = await prisma.otEquipmentUsage.findMany({
      where: {
        schedule: { date: { gte: from, lte: to } },
      },
      select: {
        equipmentName: true,
        usedMinutes: true,
        scheduleId: true,
      },
    });

    const map = new Map<string, { equipmentName: string; totalMinutes: number; uses: number; scheduleIds: Set<string> }>();
    for (const r of rows) {
      const k = r.equipmentName;
      const cur = map.get(k) ?? { equipmentName: k, totalMinutes: 0, uses: 0, scheduleIds: new Set<string>() };
      cur.totalMinutes += r.usedMinutes || 0;
      cur.uses += 1;
      cur.scheduleIds.add(r.scheduleId);
      map.set(k, cur);
    }
    const data = Array.from(map.values())
      .map((v) => ({
        equipmentName: v.equipmentName,
        totalMinutes: v.totalMinutes,
        uses: v.uses,
        distinctSchedules: v.scheduleIds.size,
        avgMinutesPerUse: v.uses > 0 ? Math.round(v.totalMinutes / v.uses) : 0,
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);

    res.status(200).json({
      data,
      meta: { from, to, totalEntries: rows.length },
    });
  } catch (error) {
    console.error('[ot-reports] equipmentUtilization failed:', error);
    res.status(500).json({ message: 'Failed to load equipment utilization' });
  }
};

// ─── Operative notes by admission (Phase 9.3b — DS integration) ───────
//
// Returns every OtIntraOpNote attached to schedules linked to this
// admission, oldest first. Driven by the Discharge Summary UI which
// surfaces them as a numbered list of operative notes per admission.

export const operativeNotesByAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!admissionId) {
      res.status(400).json({ message: 'admissionId is required' });
      return;
    }
    const schedules = await prisma.otSchedule.findMany({
      where: { admissionId },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        procedureName: true,
        surgeonName: true,
        anaesthesiologistName: true,
        otRoom: { select: { name: true, code: true } },
        intraOpNotes: {
          orderBy: { noteNumber: 'asc' },
          select: {
            id: true,
            noteNumber: true,
            startAt: true,
            endAt: true,
            anaesthesiaType: true,
            surgeons: true,
            assistants: true,
            preOpDiagnosis: true,
            postOpDiagnosis: true,
            postOpDiagnosisSame: true,
            findings: true,
            procedureDone: true,
            procedureSteps: true,
            position: true,
            incision: true,
            bloodLossMl: true,
            fluidsMl: true,
            complications: true,
            significantIntraOpEvent: true,
            drains: true,
            implants: true,
            prosthesisLabel: true,
            disposition: true,
            signedAt: true,
            signedBy: true,
          },
        },
      },
    });

    // Flatten — one record per operative note with the parent schedule
    // header. Empty-schedule rows (no operative note yet) are skipped.
    const flat: Array<Record<string, unknown>> = [];
    for (const s of schedules) {
      for (const n of s.intraOpNotes) {
        flat.push({
          scheduleId: s.id,
          scheduleDate: s.date,
          procedureName: s.procedureName,
          otRoom: s.otRoom?.name ?? s.otRoom?.code ?? null,
          scheduleSurgeon: s.surgeonName,
          scheduleAnaesthesiologist: s.anaesthesiologistName,
          ...n,
        });
      }
    }
    res.status(200).json({ data: flat, schedules: schedules.length, notes: flat.length });
  } catch (error) {
    console.error('[ot-reports] operativeNotesByAdmission failed:', error);
    res.status(500).json({ message: 'Failed to load operative notes for admission' });
  }
};

// ─── OT Time Booked vs Actual ──────────────────────────────────────────

export const timeBookedVsActual = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = parseRange(req);

    const rows = await prisma.otSchedule.findMany({
      where: {
        date: { gte: from, lte: to },
        // Only schedules that actually started — otherwise actual==null
        actualStart: { not: null },
      },
      select: {
        id: true,
        date: true,
        prn: true,
        patientName: true,
        procedureName: true,
        surgeonName: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        otAdmissionAt: true,
        otDischargeAt: true,
        status: true,
      },
      orderBy: { date: 'desc' },
      take: 1000,
    });

    const data = rows.map((r) => {
      const plannedMinutes = (new Date(r.plannedEnd).getTime() - new Date(r.plannedStart).getTime()) / 60000;
      const actualMinutes = r.actualEnd && r.actualStart
        ? (new Date(r.actualEnd).getTime() - new Date(r.actualStart).getTime()) / 60000
        : null;
      const startDeltaMinutes = r.actualStart
        ? (new Date(r.actualStart).getTime() - new Date(r.plannedStart).getTime()) / 60000
        : null;
      const otOccupancyMinutes = r.otAdmissionAt && r.otDischargeAt
        ? (new Date(r.otDischargeAt).getTime() - new Date(r.otAdmissionAt).getTime()) / 60000
        : null;
      return {
        id: r.id,
        date: r.date,
        prn: r.prn,
        patientName: r.patientName,
        procedureName: r.procedureName,
        surgeonName: r.surgeonName,
        status: r.status,
        plannedStart: r.plannedStart,
        plannedEnd: r.plannedEnd,
        actualStart: r.actualStart,
        actualEnd: r.actualEnd,
        otAdmissionAt: r.otAdmissionAt,
        otDischargeAt: r.otDischargeAt,
        plannedMinutes: Math.round(plannedMinutes),
        actualMinutes: actualMinutes === null ? null : Math.round(actualMinutes),
        startDeltaMinutes: startDeltaMinutes === null ? null : Math.round(startDeltaMinutes),
        durationDeltaMinutes: actualMinutes === null ? null : Math.round(actualMinutes - plannedMinutes),
        otOccupancyMinutes: otOccupancyMinutes === null ? null : Math.round(otOccupancyMinutes),
      };
    });

    // Roll-up: averages for the page header
    const finished = data.filter((d) => d.actualMinutes !== null);
    const totals = {
      schedules: data.length,
      avgPlannedMins: data.length ? Math.round(data.reduce((a, b) => a + b.plannedMinutes, 0) / data.length) : 0,
      avgActualMins: finished.length ? Math.round(finished.reduce((a, b) => a + (b.actualMinutes ?? 0), 0) / finished.length) : 0,
      avgStartDelayMins: data.filter((d) => d.startDeltaMinutes !== null).length
        ? Math.round(
            data.filter((d) => d.startDeltaMinutes !== null)
              .reduce((a, b) => a + (b.startDeltaMinutes ?? 0), 0)
            / data.filter((d) => d.startDeltaMinutes !== null).length
          )
        : 0,
    };

    res.status(200).json({ data, meta: { from, to, ...totals } });
  } catch (error) {
    console.error('[ot-reports] timeBookedVsActual failed:', error);
    res.status(500).json({ message: 'Failed to load time-booked-vs-actual report' });
  }
};
