import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { atClock, composeKitchenNote, generateOrdersForDate, syncOrdersQuietly } from './meal-order.cron';
import { readSettings } from './masters.controller';
import {
  loadPatientContext, loadCurrentPlans, avoidText, remarkText,
  type PatientContext, type CurrentPlanSummary,
} from './patient-context';

/**
 * Diet Information Sheet — the dietitian's daily sheet (the hospital's
 * "DIET INFORMATION LIST 10-09-2026 · 10-09 EVE TO 11-09 LUNCH").
 *
 *   • Window: from the configured start slot (e.g. Evening) on the service
 *     date through the slot before it on the next day.
 *   • One row per admitted patient: bed, PRN, name, age, diagnosis, diet code
 *     (diet + texture), food allergy / avoid, one cell per meal slot, remark.
 *   • Cells (PatientMealInstruction) persist until changed; every change is
 *     audited and pushed to the kitchen (meal orders) immediately.
 *   • Changes since the last issued sheet are listed per row (the sheet's
 *     green highlight); new admissions and patients who left are separated.
 *   • Issue = dietitian signs → snapshot stored; the F&B manager / supervisor
 *     acknowledges ("diet communicated to kitchen").
 */

export interface WindowSlot {
  slotId: string;
  name: string;
  code: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  orderCutoff: string | null;
}

export interface SheetRow {
  admissionId: string;
  admissionNo: string;
  prn: string;
  patientName: string | null;
  age: string | null;
  sex: string | null;
  wardName: string | null;
  bedNumber: string | null;
  diagnosis: string;
  consultant: string;
  admissionDate: string;
  planId: string | null;
  planStatus: 'ACTIVE' | 'INTERIM' | 'NONE';
  dietCode: string | null;
  dietName: string | null;
  dietKind: string | null;
  avoid: string | null;
  remark: string | null;
  npo: string | null;
  needsCheck: boolean;
  checkNote: string | null;
  riskLevel: string | null;
  /** slotId → cell as shown on the sheet ("NO", "Ensure DM — 2.5 scoops", …). */
  cells: Record<string, {
    text: string | null;
    skip: boolean;
    instruction: string | null;
    supplementId: string | null;
    supplementDose: string | null;
    defaultMeal: string | null;
  }>;
  isNew: boolean;
  changes: string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string | undefined): Date => {
  const d = s ? new Date(`${s}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return parseYmd(undefined);
  d.setHours(0, 0, 0, 0);
  return d;
};
const fmt = (d: Date): string =>
  `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

/** Slots in sheet order: start slot … end of day, then next day's earlier slots. */
export async function buildWindow(serviceDate: Date): Promise<WindowSlot[]> {
  const settings = await readSettings();
  const slots = await prisma.mealTimeSlot.findMany({
    where: { isActive: true },
    orderBy: [{ sequence: 'asc' }, { startTime: 'asc' }],
  });
  const startIdx = Math.max(0, slots.findIndex((s) => s.id === settings.sheetStartSlotId));
  const next = new Date(serviceDate);
  next.setDate(next.getDate() + 1);
  const mk = (s: (typeof slots)[number], d: Date): WindowSlot => ({
    slotId: s.id, name: s.name, code: s.code, date: ymd(d),
    startTime: s.startTime, endTime: s.endTime, orderCutoff: s.orderCutoff,
  });
  return [
    ...slots.slice(startIdx).map((s) => mk(s, serviceDate)),
    ...slots.slice(0, startIdx).map((s) => mk(s, next)),
  ];
}

function npoText(plan: CurrentPlanSummary | undefined, holds: Array<{ reason: string; fromAt: Date; untilAt: Date | null }>): string | null {
  const parts: string[] = [];
  if (plan && (plan.npoFrom || plan.npoUntil)) {
    parts.push(`NPO${plan.npoFrom ? ` from ${fmt(plan.npoFrom)}` : ''}${plan.npoUntil ? ` until ${fmt(plan.npoUntil)}` : ' till further orders'}`);
  }
  for (const h of holds) {
    parts.push(`${h.reason} from ${fmt(h.fromAt)}${h.untilAt ? ` until ${fmt(h.untilAt)}` : ''}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Build every row of the sheet for the window starting on `serviceDate`. */
export async function buildSheet(serviceDate: Date): Promise<{
  window: WindowSlot[];
  rows: SheetRow[];
  departed: Array<{ admissionNo: string; patientName: string | null; bedNumber: string | null; wardName: string | null }>;
  lastSheet: { id: string; issuedAt: Date; issuedBy: string | null; status: string } | null;
}> {
  const window = await buildWindow(serviceDate);
  const patients: PatientContext[] = await loadPatientContext({});
  const ids = patients.map((p) => p.admissionId);

  const [plans, cells, holds, risks, lastSheet] = await Promise.all([
    loadCurrentPlans(ids),
    ids.length
      ? prisma.patientMealInstruction.findMany({
          where: { admissionId: { in: ids } },
          include: { supplement: { select: { name: true } } },
        })
      : [],
    ids.length
      ? prisma.mealHold.findMany({ where: { admissionId: { in: ids }, liftedAt: null } })
      : [],
    ids.length
      ? prisma.nutritionAssessment.findMany({
          where: { admissionId: { in: ids }, formType: { not: 'REASSESSMENT' } },
          select: { admissionId: true, riskLevel: true, assessedAt: true },
          orderBy: { assessedAt: 'desc' },
        })
      : [],
    prisma.dietSheet.findFirst({ orderBy: { issuedAt: 'desc' } }),
  ]);

  // Default meal per (diet × slot × weekday of that window column).
  const dietIds = Array.from(new Set(Array.from(plans.values()).map((p) => p.dietId)));
  const menuRows = dietIds.length
    ? await prisma.menuPlan.findMany({
        where: { dietMasterId: { in: dietIds } },
        include: { meal: { select: { name: true } } },
      })
    : [];
  const menuMeal = new Map(menuRows.map((m) => [`${m.dietMasterId}|${m.mealTimeSlotId}|${m.dayOfWeek}`, m.meal.name]));

  const cellMap = new Map(cells.map((c) => [`${c.admissionId}|${c.mealTimeSlotId}`, c]));
  const holdsBy = new Map<string, typeof holds>();
  for (const h of holds) holdsBy.set(h.admissionId, [...(holdsBy.get(h.admissionId) ?? []), h]);
  const riskBy = new Map<string, string | null>();
  for (const r of risks) if (!riskBy.has(r.admissionId)) riskBy.set(r.admissionId, r.riskLevel);

  // Previous issued sheet → what changed since (the green rows).
  let prevRows = new Map<string, SheetRow>();
  if (lastSheet) {
    try {
      const snap = JSON.parse(lastSheet.snapshot) as { rows?: SheetRow[] };
      prevRows = new Map((snap.rows ?? []).map((r) => [r.admissionId, r]));
    } catch { /* corrupt snapshot — treat as no previous sheet */ }
  }

  const rows: SheetRow[] = patients.map((p) => {
    const plan = plans.get(p.admissionId);
    const rowCells: SheetRow['cells'] = {};
    for (const w of window) {
      const c = cellMap.get(`${p.admissionId}|${w.slotId}`);
      const weekday = new Date(`${w.date}T00:00:00`).getDay();
      rowCells[w.slotId] = {
        text: c?.skip ? 'NO' : composeKitchenNote(c),
        skip: !!c?.skip,
        instruction: c?.instruction ?? null,
        supplementId: c?.supplementId ?? null,
        supplementDose: c?.supplementDose ?? null,
        defaultMeal: plan ? (menuMeal.get(`${plan.dietId}|${w.slotId}|${weekday}`) ?? null) : null,
      };
    }
    const row: SheetRow = {
      admissionId: p.admissionId,
      admissionNo: p.admissionNo,
      prn: p.prn,
      patientName: p.patientName,
      age: p.age,
      sex: p.sex,
      wardName: p.wardName,
      bedNumber: p.bedNumber,
      diagnosis: p.diagnosis,
      consultant: p.consultant,
      admissionDate: p.admissionDate.toISOString(),
      planId: plan?.id ?? null,
      planStatus: (plan?.status as 'ACTIVE' | 'INTERIM' | undefined) ?? 'NONE',
      dietCode: plan?.displayCode ?? null,
      dietName: plan?.dietName ?? null,
      dietKind: plan?.dietKind ?? null,
      avoid: avoidText(plan),
      remark: remarkText(plan),
      npo: npoText(plan, holdsBy.get(p.admissionId) ?? []),
      needsCheck: !!plan?.needsCheck,
      checkNote: plan?.checkNote ?? null,
      riskLevel: riskBy.get(p.admissionId) ?? null,
      cells: rowCells,
      isNew: false,
      changes: [],
    };

    const prev = prevRows.get(p.admissionId);
    if (lastSheet && !prev) {
      row.isNew = true;
      row.changes.push('New since last sheet');
    } else if (prev) {
      if (prev.bedNumber !== row.bedNumber) row.changes.push(`Bed ${prev.bedNumber ?? '—'} → ${row.bedNumber ?? '—'}`);
      if (prev.dietCode !== row.dietCode) row.changes.push(`Diet ${prev.dietCode ?? '—'} → ${row.dietCode ?? '—'}`);
      if (prev.npo !== row.npo) row.changes.push(row.npo ? `NPO: ${row.npo}` : 'NPO lifted');
      if (prev.avoid !== row.avoid) row.changes.push('Food allergy / avoid changed');
      if (prev.remark !== row.remark) row.changes.push('Remark changed');
      const changedSlots = window
        .filter((w) => (prev.cells?.[w.slotId]?.text ?? null) !== row.cells[w.slotId].text)
        .map((w) => w.name);
      if (changedSlots.length) row.changes.push(`Meals changed: ${changedSlots.join(', ')}`);
    }
    return row;
  });

  // Ward then bed, as the printed sheet is walked bed by bed.
  rows.sort((a, b) =>
    (a.wardName ?? '').localeCompare(b.wardName ?? '')
    || (a.bedNumber ?? '').localeCompare(b.bedNumber ?? '', undefined, { numeric: true }));

  const currentIds = new Set(ids);
  const departed = Array.from(prevRows.values())
    .filter((r) => !currentIds.has(r.admissionId))
    .map((r) => ({ admissionNo: r.admissionNo, patientName: r.patientName, bedNumber: r.bedNumber, wardName: r.wardName }));

  return {
    window,
    rows,
    departed,
    lastSheet: lastSheet
      ? { id: lastSheet.id, issuedAt: lastSheet.issuedAt, issuedBy: lastSheet.issuedBy, status: lastSheet.status }
      : null,
  };
}

function totals(rows: SheetRow[]): { total: number; noTray: number; served: number; npo: number; noPlan: number } {
  const noTray = rows.filter((r) => r.dietKind === 'NO_TRAY').length;
  return {
    total: rows.length,
    noTray,
    served: rows.length - noTray,
    npo: rows.filter((r) => !!r.npo).length,
    noPlan: rows.filter((r) => r.planStatus === 'NONE').length,
  };
}

// ─── GET /sheet/preview?date=YYYY-MM-DD ─────────────────────────────

export const getSheetPreview = async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceDate = parseYmd(req.query.date as string | undefined);
    const settings = await readSettings();
    const sheet = await buildSheet(serviceDate);
    res.status(200).json({
      serviceDate: ymd(serviceDate),
      ...sheet,
      totals: totals(sheet.rows),
      standingNotes: settings.sheetStandingNotes ?? '',
    });
  } catch (error) {
    console.error('[dietetics] getSheetPreview failed:', error);
    res.status(500).json({ error: 'Failed to build diet sheet' });
  }
};

// ─── PUT /sheet/cell — one patient × meal cell ──────────────────────

interface CellBody {
  admissionId: string;
  mealTimeSlotId: string;
  instruction?: string | null;
  skip?: boolean;
  supplementId?: string | null;
  supplementDose?: string | null;
}

export const updateCell = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CellBody;
    if (!body.admissionId || !body.mealTimeSlotId) {
      res.status(400).json({ error: 'admissionId and mealTimeSlotId are required' });
      return;
    }
    const instruction = body.instruction?.trim() || null;
    const supplementId = body.supplementId || null;
    const supplementDose = body.supplementDose?.trim() || null;
    const skip = !!body.skip;
    const where = { admissionId_mealTimeSlotId: { admissionId: body.admissionId, mealTimeSlotId: body.mealTimeSlotId } };
    const before = await prisma.patientMealInstruction.findUnique({ where });

    let row = null;
    if (!skip && !instruction && !supplementId) {
      // Empty cell → back to the weekly-menu default.
      if (before) await prisma.patientMealInstruction.delete({ where });
    } else {
      const data = { instruction, skip, supplementId, supplementDose, updatedBy: req.user?.username ?? null };
      row = await prisma.patientMealInstruction.upsert({
        where,
        create: { admissionId: body.admissionId, mealTimeSlotId: body.mealTimeSlotId, ...data },
        update: data,
        include: { supplement: { select: { name: true } } },
      });
    }

    // entityId = admissionId so the patient's diet history can be read back.
    await auditLog(req, {
      module: 'dietetics',
      action: 'UPDATE',
      entityType: 'DietSheetCell',
      entityId: body.admissionId,
      payload: {
        mealTimeSlotId: body.mealTimeSlotId,
        before: before ? { instruction: before.instruction, skip: before.skip, supplementId: before.supplementId, supplementDose: before.supplementDose } : null,
        after: row ? { instruction, skip, supplementId, supplementDose } : null,
      },
    });
    await syncOrdersQuietly(body.admissionId);
    res.status(200).json({ cell: row, text: row ? (row.skip ? 'NO' : composeKitchenNote(row)) : null });
  } catch (error) {
    console.error('[dietetics] updateCell failed:', error);
    res.status(500).json({
      error: 'Failed to save meal instruction',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Issue + acknowledge ────────────────────────────────────────────

export const issueSheet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, notes, signatureId } = req.body as { date?: string; notes?: string; signatureId?: string };
    if (!signatureId) {
      res.status(400).json({ error: 'Dietitian signature is required to issue the sheet' });
      return;
    }
    const serviceDate = parseYmd(date);
    const settings = await readSettings();
    const sheet = await buildSheet(serviceDate);
    const t = totals(sheet.rows);
    const window = sheet.window;
    const label = window.length
      ? `${window[0].name} ${window[0].date} → ${window[window.length - 1].name} ${window[window.length - 1].date}`
      : ymd(serviceDate);

    // One live sheet per service window: re-issuing (e.g. after late changes)
    // replaces the earlier copy, which F&B then no longer has to acknowledge.
    await prisma.dietSheet.updateMany({
      where: { serviceDate, status: { in: ['ISSUED', 'ACKNOWLEDGED'] } },
      data: { status: 'REPLACED' },
    });

    const row = await prisma.dietSheet.create({
      data: {
        serviceDate,
        windowLabel: label,
        totalPatients: t.total,
        noTrayPatients: t.noTray,
        notes: notes?.trim() || (settings.sheetStandingNotes as string) || null,
        snapshot: JSON.stringify({ window, rows: sheet.rows, departed: sheet.departed, totals: t }),
        issuedBy: req.user?.username ?? null,
        issuedById: typeof req.user?.id === 'number' ? req.user.id : null,
        signatureId,
      },
    });

    // Push the whole window to the kitchen now (every patient, both days).
    const dates = Array.from(new Set(window.map((w) => w.date)));
    for (const d of dates) await generateOrdersForDate(new Date(`${d}T00:00:00`));

    await auditLog(req, {
      module: 'dietetics', action: 'CREATE', entityType: 'DietSheet', entityId: row.id,
      payload: { serviceDate: ymd(serviceDate), totals: t },
    });
    res.status(201).json({ id: row.id, issuedAt: row.issuedAt, windowLabel: row.windowLabel, totals: t });
  } catch (error) {
    console.error('[dietetics] issueSheet failed:', error);
    res.status(500).json({
      error: 'Failed to issue diet sheet',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

/** F&B manager / supervisor confirms receipt — "diet communicated to kitchen". */
export const acknowledgeSheet = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { signatureId } = req.body as { signatureId?: string };
    const existing = await prisma.dietSheet.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Sheet not found' }); return; }
    if (existing.status === 'ACKNOWLEDGED') {
      res.status(409).json({ error: `Already acknowledged by ${existing.supervisorAckBy ?? 'supervisor'}` });
      return;
    }
    if (existing.status === 'REPLACED') {
      res.status(409).json({ error: 'This sheet was replaced by a newer issue — acknowledge the latest one' });
      return;
    }
    const row = await prisma.dietSheet.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        supervisorAckAt: new Date(),
        supervisorAckBy: req.user?.username ?? null,
        supervisorAckById: typeof req.user?.id === 'number' ? req.user.id : null,
        supervisorSignatureId: signatureId ?? null,
      },
      select: { id: true, status: true, supervisorAckAt: true, supervisorAckBy: true },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'STATUS_CHANGE', entityType: 'DietSheet', entityId: id,
      payload: { from: 'ISSUED', to: 'ACKNOWLEDGED' },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] acknowledgeSheet failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge sheet' });
  }
};

export const listSheets = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const rows = await prisma.dietSheet.findMany({
      orderBy: { issuedAt: 'desc' },
      take: limit,
      select: {
        id: true, serviceDate: true, windowLabel: true, status: true,
        totalPatients: true, noTrayPatients: true,
        issuedAt: true, issuedBy: true, supervisorAckAt: true, supervisorAckBy: true,
      },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listSheets failed:', error);
    res.status(500).json({ error: 'Failed to list sheets' });
  }
};

export const getSheet = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.dietSheet.findUnique({ where: { id: req.params.id } });
    if (!row) { res.status(404).json({ error: 'Sheet not found' }); return; }
    const { snapshot, ...meta } = row;
    let parsed: unknown = null;
    try { parsed = JSON.parse(snapshot); } catch { /* leave null */ }
    res.status(200).json({ ...meta, snapshot: parsed });
  } catch (error) {
    console.error('[dietetics] getSheet failed:', error);
    res.status(500).json({ error: 'Failed to load sheet' });
  }
};

// ─── Meal holds (NPO / meal break) ──────────────────────────────────

export const listHolds = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.mealHold.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listHolds failed:', error);
    res.status(500).json({ error: 'Failed to list holds' });
  }
};

export const createHold = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionId, fromAt, untilAt, reason, source } = req.body as {
      admissionId: string; fromAt?: string; untilAt?: string | null; reason?: string; source?: string;
    };
    if (!admissionId) { res.status(400).json({ error: 'admissionId is required' }); return; }
    const from = fromAt ? new Date(fromAt) : new Date();
    const until = untilAt ? new Date(untilAt) : null;
    if (Number.isNaN(from.getTime()) || (until && Number.isNaN(until.getTime()))) {
      res.status(400).json({ error: 'Invalid fromAt / untilAt' });
      return;
    }
    if (until && until <= from) { res.status(400).json({ error: 'untilAt must be after fromAt' }); return; }
    const row = await prisma.mealHold.create({
      data: {
        admissionId,
        fromAt: from,
        untilAt: until,
        reason: reason?.trim() || 'NPO',
        source: ['CENSUS', 'DIETARY', 'DIETITIAN'].includes(source ?? '') ? source! : 'DIETARY',
        createdBy: req.user?.username ?? null,
      },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'CREATE', entityType: 'MealHold', entityId: admissionId,
      payload: { holdId: row.id, fromAt: row.fromAt, untilAt: row.untilAt, reason: row.reason, source: row.source },
    });
    await syncOrdersQuietly(admissionId);
    res.status(201).json(row);
  } catch (error) {
    console.error('[dietetics] createHold failed:', error);
    res.status(500).json({ error: 'Failed to create hold' });
  }
};

export const liftHold = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.mealHold.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Hold not found' }); return; }
    if (existing.liftedAt) { res.status(409).json({ error: 'Hold already lifted' }); return; }
    const row = await prisma.mealHold.update({
      where: { id: existing.id },
      data: { liftedAt: new Date(), liftedBy: req.user?.username ?? null },
    });
    await auditLog(req, {
      module: 'dietetics', action: 'STATUS_CHANGE', entityType: 'MealHold', entityId: existing.admissionId,
      payload: { holdId: existing.id, lifted: true },
    });
    await syncOrdersQuietly(existing.admissionId);
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] liftHold failed:', error);
    res.status(500).json({ error: 'Failed to lift hold' });
  }
};

// ─── Date/time-wise diet change history for one patient ─────────────

export const getDietHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const [plans, audits, slots] = await Promise.all([
      prisma.dietPlan.findMany({
        where: { admissionId },
        include: { diet: { select: { code: true, name: true } }, texture: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.appAuditLog.findMany({
        where: { module: 'dietetics', entityId: admissionId, entityType: { in: ['DietSheetCell', 'MealHold', 'DietCensus'] } },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      }),
      prisma.mealTimeSlot.findMany({ select: { id: true, name: true } }),
    ]);
    const slotName = new Map(slots.map((s) => [s.id, s.name]));
    const events: Array<{ at: Date; by: string | null; what: string }> = [];
    for (const p of plans) {
      const code = p.texture ? `${p.diet.code}-${p.texture.code}` : p.diet.code;
      events.push({ at: p.createdAt, by: p.createdBy, what: `${p.status === 'INTERIM' ? 'Interim diet (census)' : 'Diet plan drafted'}: ${code} · ${p.diet.name}` });
      if (p.signedAt) events.push({ at: p.signedAt, by: p.signedBy, what: `Diet plan signed: ${code}` });
    }
    for (const a of audits) {
      let payload: Record<string, unknown> = {};
      try { payload = a.payload ? JSON.parse(a.payload) : {}; } catch { /* ignore */ }
      if (a.entityType === 'DietSheetCell') {
        const after = payload.after as { instruction?: string; skip?: boolean } | null;
        const slot = slotName.get(String(payload.mealTimeSlotId)) ?? 'Meal';
        events.push({
          at: a.createdAt, by: a.actorName,
          what: `${slot}: ${after ? (after.skip ? 'NO' : (after.instruction ?? 'supplement updated')) : 'reset to menu default'}`,
        });
      } else if (a.entityType === 'MealHold') {
        events.push({ at: a.createdAt, by: a.actorName, what: payload.lifted ? 'Meal hold lifted' : `Meal hold: ${String(payload.reason ?? 'NPO')}` });
      } else {
        events.push({ at: a.createdAt, by: a.actorName, what: String(payload.summary ?? 'Census update') });
      }
    }
    events.sort((x, y) => x.at.getTime() - y.at.getTime());
    res.status(200).json(events);
  } catch (error) {
    console.error('[dietetics] getDietHistory failed:', error);
    res.status(500).json({ error: 'Failed to load diet history' });
  }
};

// Re-exported so the label controller can reuse window + slot timing.
export { atClock };
