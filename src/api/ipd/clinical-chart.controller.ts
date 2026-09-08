import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { computeAndStoreSnapshot } from '../treatment-dashboard/acuity-snapshot.service';

/**
 * Clinical Chart controller (Phase 2).
 *
 * Backs the printed Clinical / TPR chart used at partner hospitals. Three
 * data sources combined:
 *   • IpdVitalsReading      — per-slot vitals (multiple per day)
 *   • IpdIntakeOutputEntry  — per-event fluid in/out
 *   • IpdDailyChart         — per-day rollup (diet, bowels, antibiotics,
 *                              nurse shift signs, weight, post-op day)
 *
 * The `getChart(admissionId, from, to)` endpoint pulls all three across the
 * requested date range and groups by date so the UI can render the column-
 * per-day grid the printed chart uses.
 */

// ─── Helpers ────────────────────────────────────────────────────────

/** Derive the shift token (M/E/N) from a timestamp. Stored alongside the
 *  reading so DST or TZ corrections don't reshuffle existing rows. */
function shiftFor(d: Date): 'M' | 'E' | 'N' {
  const h = d.getHours();
  if (h >= 6 && h < 14) return 'M';
  if (h >= 14 && h < 22) return 'E';
  return 'N';
}

// Day bucketing runs on the *server-local* calendar, which is the hospital's
// calendar — the deployment pins TZ=Asia/Kolkata (see bed-census-snapshot.ts).
// That's the same basis shiftFor() above already uses, so a reading's shift
// token and its day column can no longer disagree.
//
// Two kinds of date live in this chart and they are keyed differently:
//   * vitals / intake-output — real instants (`recordedAt`). Bucketed by the
//     LOCAL calendar day, because 02:00 IST belongs to the nurse's today, not
//     to the previous UTC day.
//   * IpdDailyChart.chartDate — a date-only value stored at UTC midnight.
//     Keyed with toISOString().slice(0,10), which yields exactly the calendar
//     date it represents. Do NOT switch this to local: existing rows are
//     already persisted at UTC midnight and would stop matching.
// Both paths produce the same 'YYYY-MM-DD' string for the same calendar day,
// which is what lets them share one column.

function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** Local calendar-day key for an instant, e.g. '2026-09-02'. */
function localKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a 'YYYY-MM-DD' query param into local midnight. Component-wise so it
 *  is correct for both positive and negative UTC offsets — `new Date(s)` on a
 *  date-only string parses as UTC midnight, which lands on the wrong local day
 *  for western timezones. */
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function dayStart(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}

function dayEnd(d: Date): Date {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}

/** The UTC-midnight instant used as IpdDailyChart.chartDate for a day key. */
function chartDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Advance a local date by n calendar days (DST-safe — setDate, not +86400s). */
function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

// ─── Vitals readings ────────────────────────────────────────────────

interface CreateVitalsBody {
  recordedAt?: string;          // ISO — defaults to now
  temperatureC?: number | null;
  temperatureF?: number | null;
  pulse?: number | null;
  respiration?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  spo2?: number | null;
  painScore?: number | null;
  sputum?: string | null;
  notes?: string | null;
  // Phase 9.13 — NEWS2 inputs
  consciousnessAcvpu?: string | null;   // 'A' | 'C' | 'V' | 'P' | 'U'
  onSupplementalOxygen?: boolean | null;
}

export const createVitals = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as CreateVitalsBody;

    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId } });
    if (!admission) {
      res.status(404).json({ error: 'Admission not found' });
      return;
    }

    const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      res.status(400).json({ error: 'recordedAt must be a valid ISO timestamp' });
      return;
    }

    const row = await prisma.ipdVitalsReading.create({
      data: {
        admissionId,
        recordedAt,
        shift: shiftFor(recordedAt),
        temperatureC: body.temperatureC ?? null,
        temperatureF: body.temperatureF ?? null,
        pulse: body.pulse ?? null,
        respiration: body.respiration ?? null,
        bpSystolic: body.bpSystolic ?? null,
        bpDiastolic: body.bpDiastolic ?? null,
        spo2: body.spo2 ?? null,
        painScore: body.painScore ?? null,
        sputum: body.sputum ?? null,
        notes: body.notes ?? null,
        consciousnessAcvpu: body.consciousnessAcvpu ?? null,
        onSupplementalOxygen: body.onSupplementalOxygen ?? false,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    // Phase 9.13 — refresh the NEWS2 acuity snapshot for the Treatment
    // Dashboard. Fire-and-forget: a scoring failure must not fail the save.
    computeAndStoreSnapshot(admissionId).catch((e) =>
      console.warn('[clinical-chart] acuity snapshot failed:', (e as Error).message),
    );
    res.status(201).json(row);
  } catch (error) {
    console.error('[clinical-chart] createVitals failed:', error);
    res.status(500).json({ error: 'Failed to record vitals' });
  }
};

// ─── Intake / Output ────────────────────────────────────────────────

interface CreateIoBody {
  recordedAt?: string;
  entryType: 'INTAKE' | 'OUTPUT';
  category: string;
  amountMl: number;
  description?: string | null;
}

const VALID_INTAKE_CATEGORIES = ['oral', 'iv', 'ng', 'parenteral', 'blood-product', 'other'];
const VALID_OUTPUT_CATEGORIES = ['urine', 'stool', 'vomitus', 'drain', 'ng-aspirate', 'blood', 'other'];

export const createIntakeOutput = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as CreateIoBody;

    if (body.entryType !== 'INTAKE' && body.entryType !== 'OUTPUT') {
      res.status(400).json({ error: 'entryType must be INTAKE or OUTPUT' });
      return;
    }
    if (!body.category) {
      res.status(400).json({ error: 'category is required' });
      return;
    }
    const validCats = body.entryType === 'INTAKE' ? VALID_INTAKE_CATEGORIES : VALID_OUTPUT_CATEGORIES;
    if (!validCats.includes(body.category)) {
      res.status(400).json({ error: `category must be one of: ${validCats.join(', ')}` });
      return;
    }
    if (typeof body.amountMl !== 'number' || body.amountMl < 0) {
      res.status(400).json({ error: 'amountMl must be a non-negative number' });
      return;
    }

    const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      res.status(400).json({ error: 'recordedAt must be a valid ISO timestamp' });
      return;
    }

    const row = await prisma.ipdIntakeOutputEntry.create({
      data: {
        admissionId,
        recordedAt,
        entryType: body.entryType,
        category: body.category,
        amountMl: Math.round(body.amountMl),
        description: body.description ?? null,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[clinical-chart] createIntakeOutput failed:', error);
    res.status(500).json({ error: 'Failed to record intake/output' });
  }
};

// ─── Daily chart upsert ─────────────────────────────────────────────

interface UpsertDailyBody {
  chartDate: string;            // YYYY-MM-DD
  postOpDay?: number | null;
  postPartumDay?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  diet?: string | null;
  bowels?: string | null;
  urine?: string | null;
  bloodTransfusion?: string | null;
  bloodGroup?: string | null;
  noOfTransfusions?: number | null;
  antibiotics?: string | null;
  bath?: string | null;
  allergy?: string | null;
}

export const upsertDaily = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as UpsertDailyBody;
    if (!body.chartDate) {
      res.status(400).json({ error: 'chartDate is required' });
      return;
    }
    // chartDate is a date-only value, stored at UTC midnight so the calendar
    // date survives verbatim in toISOString().slice(0,10) — that is the key
    // getChart() matches against its day columns. Must NOT be parsed as local
    // midnight: every existing row is persisted on the UTC-midnight basis.
    const date = chartDateKey(body.chartDate);
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ error: 'chartDate must be YYYY-MM-DD' });
      return;
    }

    // Strip undefined so partial updates don't clear unrelated fields.
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === 'chartDate') continue;
      if (value !== undefined) data[key] = value;
    }

    const row = await prisma.ipdDailyChart.upsert({
      where: { admissionId_chartDate: { admissionId, chartDate: date } },
      update: {
        ...data,
        updatedBy: req.user?.username ?? null,
        updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      create: {
        admissionId,
        chartDate: date,
        ...data,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[clinical-chart] upsertDaily failed:', error);
    res.status(500).json({
      error: 'Failed to save daily chart',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Nurse shift sign ───────────────────────────────────────────────

interface SignShiftBody {
  chartDate: string;
  shift: 'M' | 'E' | 'N';
  signatureId: string;
  nurseName?: string;
}

export const signShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = req.body as SignShiftBody;
    if (!body.chartDate || !body.shift || !body.signatureId) {
      res.status(400).json({ error: 'chartDate, shift and signatureId are required' });
      return;
    }
    if (!['M', 'E', 'N'].includes(body.shift)) {
      res.status(400).json({ error: 'shift must be M, E or N' });
      return;
    }
    // chartDate is a date-only value, stored at UTC midnight so the calendar
    // date survives verbatim in toISOString().slice(0,10) — that is the key
    // getChart() matches against its day columns. Must NOT be parsed as local
    // midnight: every existing row is persisted on the UTC-midnight basis.
    const date = chartDateKey(body.chartDate);
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ error: 'chartDate must be YYYY-MM-DD' });
      return;
    }

    const now = new Date();
    const nurseName = body.nurseName ?? req.user?.username ?? null;
    const data: Record<string, unknown> =
      body.shift === 'M'
        ? { nurseSignMorningId: body.signatureId, nurseSignMorningName: nurseName, nurseSignMorningAt: now }
        : body.shift === 'E'
          ? { nurseSignEveningId: body.signatureId, nurseSignEveningName: nurseName, nurseSignEveningAt: now }
          : { nurseSignNightId: body.signatureId, nurseSignNightName: nurseName, nurseSignNightAt: now };

    const row = await prisma.ipdDailyChart.upsert({
      where: { admissionId_chartDate: { admissionId, chartDate: date } },
      update: {
        ...data,
        updatedBy: req.user?.username ?? null,
        updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      create: {
        admissionId,
        chartDate: date,
        ...data,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[clinical-chart] signShift failed:', error);
    res.status(500).json({ error: 'Failed to sign shift' });
  }
};

// ─── Chart data fetch (grid) ────────────────────────────────────────

interface DayBlock {
  date: string;                                            // YYYY-MM-DD
  vitals: Array<{
    id: string;
    recordedAt: string;
    shift: string | null;
    temperatureC: number | null;
    temperatureF: number | null;
    pulse: number | null;
    respiration: number | null;
    bpSystolic: number | null;
    bpDiastolic: number | null;
    spo2: number | null;
    painScore: number | null;
    sputum: string | null;
    notes: string | null;
    recordedBy: string | null;
  }>;
  intakeTotalMl: number;
  outputTotalMl: number;
  intakeBreakdown: Record<string, number>;                 // category → sum
  outputBreakdown: Record<string, number>;
  ioEntries: Array<{
    id: string;
    recordedAt: string;
    entryType: string;
    category: string;
    amountMl: number;
    description: string | null;
  }>;
  daily: unknown | null;                                   // full IpdDailyChart row or null
}

/**
 * GET /api/ipd/admission/:admissionId/clinical-chart?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns an array of DayBlock — one per calendar day in the requested range
 * (default: last 7 days). Each block has the vitals/IO/daily data the UI
 * needs to render a column-per-day grid.
 */
export const getChart = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;

    // Fetched up-front (not inside the Promise.all below) because the chart
    // window is anchored to admissionDate — no column may precede admission.
    const admissionRow = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: {
        admissionDate: true,
        vitalsMonitoringFrequency: true, vitalsMonitoringSetBy: true,
        vitalsMonitoringSetAt: true,
      },
    });

    const today = dayStart(new Date());
    // The chart cannot start before the patient was admitted. Without an
    // admission row fall back to the historical today-minus-6 default.
    const admittedOn = admissionRow?.admissionDate
      ? dayStart(admissionRow.admissionDate)
      : addDays(today, -6);

    let from = req.query.from ? dayStart(parseLocalDate(req.query.from as string)) : admittedOn;
    if (Number.isNaN(from.getTime())) {
      res.status(400).json({ error: 'from / to must be valid dates' });
      return;
    }
    // Clamp: a caller paging backwards can never go past the admission day.
    if (from < admittedOn) from = admittedOn;

    // Default window is the 7 days from admission (day 1 first), never running
    // past today.
    const defaultTo = addDays(from, 6) > today ? today : addDays(from, 6);
    let to = req.query.to ? dayEnd(parseLocalDate(req.query.to as string)) : dayEnd(defaultTo);
    if (Number.isNaN(to.getTime())) {
      res.status(400).json({ error: 'from / to must be valid dates' });
      return;
    }
    if (to < from) to = dayEnd(from);

    const [vitals, io, daily, lastVitals] = await Promise.all([
      prisma.ipdVitalsReading.findMany({
        where: { admissionId, recordedAt: { gte: from, lte: to } },
        orderBy: { recordedAt: 'asc' },
      }),
      prisma.ipdIntakeOutputEntry.findMany({
        where: { admissionId, recordedAt: { gte: from, lte: to } },
        orderBy: { recordedAt: 'asc' },
      }),
      // chartDate is a date-only value at UTC midnight, so it is filtered on
      // the UTC-midnight instants of the window's first and last day — not on
      // the local instants used for the timestamped rows above.
      prisma.ipdDailyChart.findMany({
        where: {
          admissionId,
          chartDate: { gte: chartDateKey(localKey(from)), lte: chartDateKey(localKey(to)) },
        },
        orderBy: { chartDate: 'asc' },
      }),
      // Latest reading regardless of the chart window — drives "next due".
      prisma.ipdVitalsReading.findFirst({
        where: { admissionId },
        orderBy: { recordedAt: 'desc' },
        select: { recordedAt: true },
      }),
    ]);

    // Bucket by local calendar day.
    const blocks: Record<string, DayBlock> = {};

    // Pre-seed every day in the range so empty days still render columns.
    // Walk by calendar day rather than by +86 400 000 ms so a DST transition
    // can't skip or duplicate a column.
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      const key = localKey(d);
      blocks[key] = {
        date: key, vitals: [], intakeTotalMl: 0, outputTotalMl: 0,
        intakeBreakdown: {}, outputBreakdown: {}, ioEntries: [], daily: null,
      };
    }

    for (const v of vitals) {
      const key = localKey(v.recordedAt);
      const b = blocks[key];
      if (!b) continue;
      b.vitals.push({
        id: v.id, recordedAt: v.recordedAt.toISOString(), shift: v.shift,
        temperatureC: v.temperatureC, temperatureF: v.temperatureF,
        pulse: v.pulse, respiration: v.respiration,
        bpSystolic: v.bpSystolic, bpDiastolic: v.bpDiastolic,
        spo2: v.spo2, painScore: v.painScore, sputum: v.sputum,
        notes: v.notes, recordedBy: v.recordedBy,
      });
    }

    for (const e of io) {
      const key = localKey(e.recordedAt);
      const b = blocks[key];
      if (!b) continue;
      if (e.entryType === 'INTAKE') {
        b.intakeTotalMl += e.amountMl;
        b.intakeBreakdown[e.category] = (b.intakeBreakdown[e.category] ?? 0) + e.amountMl;
      } else {
        b.outputTotalMl += e.amountMl;
        b.outputBreakdown[e.category] = (b.outputBreakdown[e.category] ?? 0) + e.amountMl;
      }
      b.ioEntries.push({
        id: e.id, recordedAt: e.recordedAt.toISOString(),
        entryType: e.entryType, category: e.category,
        amountMl: e.amountMl, description: e.description,
      });
    }

    for (const d of daily) {
      // chartDate is date-only at UTC midnight — its UTC date IS the calendar
      // date, so this matches the local keys seeded above.
      const key = d.chartDate.toISOString().slice(0, 10);
      const b = blocks[key];
      if (b) b.daily = d;
    }

    res.status(200).json({
      admissionId,
      from: from.toISOString(),
      to: to.toISOString(),
      // Lets the chart stop its "previous week" paging at the admission day.
      admissionDate: admissionRow?.admissionDate
        ? admissionRow.admissionDate.toISOString()
        : null,
      days: Object.values(blocks),
      // Phase 9.13 — doctor-ordered vitals monitoring frequency + last
      // reading time so the chart can show a "next due / overdue" banner.
      monitoring: {
        frequency: admissionRow?.vitalsMonitoringFrequency ?? null,
        setBy: admissionRow?.vitalsMonitoringSetBy ?? null,
        setAt: admissionRow?.vitalsMonitoringSetAt
          ? admissionRow.vitalsMonitoringSetAt.toISOString()
          : null,
        lastVitalsAt: lastVitals?.recordedAt ? lastVitals.recordedAt.toISOString() : null,
      },
    });
  } catch (error) {
    console.error('[clinical-chart] getChart failed:', error);
    res.status(500).json({ error: 'Failed to load clinical chart' });
  }
};

// ─── Delete handlers (corrective; nurses occasionally enter wrong amount) ─

export const deleteVitals = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.ipdVitalsReading.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('[clinical-chart] deleteVitals failed:', error);
    res.status(500).json({ error: 'Failed to delete vitals reading' });
  }
};

export const deleteIntakeOutput = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.ipdIntakeOutputEntry.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('[clinical-chart] deleteIntakeOutput failed:', error);
    res.status(500).json({ error: 'Failed to delete intake/output entry' });
  }
};
