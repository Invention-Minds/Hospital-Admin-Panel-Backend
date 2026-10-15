import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * Dietetics masters — admin-only CRUD for the catalogues:
 *   MealTimeSlot, AllergenMaster, DietMaster, MealMaster, MenuPlan.
 *
 * Writes are super_admin-only, enforced in dietetics.routes.ts (requireRole).
 */

// ─── MealTimeSlot ────────────────────────────────────────────────────

export const listMealTimeSlots = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.mealTimeSlot.findMany({
      orderBy: [{ sequence: 'asc' }, { startTime: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listMealTimeSlots failed:', error);
    res.status(500).json({ error: 'Failed to list meal-time slots' });
  }
};

export const upsertMealTimeSlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { name, code, startTime, endTime, orderCutoff, sequence, isActive } = req.body as {
      name: string;
      code: string;
      startTime: string;
      endTime: string;
      orderCutoff?: string | null;
      sequence?: number;
      isActive?: boolean;
    };
    if (!name || !code || !startTime || !endTime) {
      res.status(400).json({ error: 'name, code, startTime, endTime are required' });
      return;
    }
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!HHMM.test(startTime) || !HHMM.test(endTime) || (orderCutoff && !HHMM.test(orderCutoff))) {
      res.status(400).json({ error: 'startTime / endTime / orderCutoff must be HH:mm' });
      return;
    }
    const data = {
      name: name.trim(),
      code: code.trim().toLowerCase(),
      startTime,
      endTime,
      orderCutoff: orderCutoff || null,
      sequence: sequence ?? 0,
      isActive: isActive ?? true,
    };
    // Sequence is the display order of the slots, so two slots may not share it.
    const clash = await prisma.mealTimeSlot.findFirst({
      where: { sequence: data.sequence, ...(id && { NOT: { id } }) },
      select: { name: true },
    });
    if (clash) {
      res.status(409).json({ error: `Sequence ${data.sequence} is already used by "${clash.name}" — pick another number` });
      return;
    }
    const row = id
      ? await prisma.mealTimeSlot.update({ where: { id }, data })
      : await prisma.mealTimeSlot.create({ data });
    await auditLog(req, {
      module: 'dietetics',
      action: id ? 'UPDATE' : 'CREATE',
      entityType: 'MealTimeSlot',
      entityId: row.id,
      payload: { code: row.code, sequence: row.sequence },
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertMealTimeSlot failed:', error);
    res.status(500).json({
      error: 'Failed to save meal-time slot',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── AllergenMaster ──────────────────────────────────────────────────

export const listAllergens = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.allergenMaster.findMany({ orderBy: [{ name: 'asc' }] });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listAllergens failed:', error);
    res.status(500).json({ error: 'Failed to list allergens' });
  }
};

export const upsertAllergen = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { name, isActive } = req.body as { name: string; isActive?: boolean };
    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: 'name (min 2 chars) is required' });
      return;
    }
    const data = { name: name.trim(), isActive: isActive ?? true };
    const row = id
      ? await prisma.allergenMaster.update({ where: { id }, data })
      : await prisma.allergenMaster.create({ data });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertAllergen failed:', error);
    res.status(500).json({
      error: 'Failed to save allergen',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── DietMaster ──────────────────────────────────────────────────────

export const listDiets = async (req: Request, res: Response): Promise<void> => {
  try {
    const onlyActive = req.query.active === 'true';
    const rows = await prisma.dietMaster.findMany({
      where: { ...(onlyActive && { isActive: true }) },
      orderBy: [{ name: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listDiets failed:', error);
    res.status(500).json({ error: 'Failed to list diets' });
  }
};

interface DietBody {
  name: string;
  code: string;
  description?: string;
  caloriesKcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  sodiumMg?: number;
  potassiumMg?: number;
  fluidMl?: number;
  restrictions?: string[];
  isVeg?: boolean;
  isJain?: boolean;
  isHalal?: boolean;
  isKosher?: boolean;
  isNoOnionGarlic?: boolean;
  targetConditions?: string[];
  isGeneral?: boolean;
  kind?: string;
  isActive?: boolean;
}

const DIET_KINDS = ['ORAL', 'FEED', 'NO_TRAY'];

export const upsertDiet = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as DietBody;
    if (!body.name || !body.code) {
      res.status(400).json({ error: 'name and code are required' });
      return;
    }
    // Both are stored as JSON arrays. A raw string here would be stringified
    // again on every save (`"\"Low salt\""`), so reject it.
    for (const field of ['restrictions', 'targetConditions'] as const) {
      const v = body[field];
      if (v != null && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
        res.status(400).json({ error: `${field} must be an array of strings` });
        return;
      }
    }
    if (body.kind && !DIET_KINDS.includes(body.kind)) {
      res.status(400).json({ error: `kind must be one of ${DIET_KINDS.join(', ')}` });
      return;
    }
    const data = {
      name: body.name.trim(),
      code: body.code.trim().toLowerCase(),
      description: body.description ?? null,
      caloriesKcal: body.caloriesKcal ?? null,
      proteinG: body.proteinG ?? null,
      carbsG: body.carbsG ?? null,
      fatG: body.fatG ?? null,
      sodiumMg: body.sodiumMg ?? null,
      potassiumMg: body.potassiumMg ?? null,
      fluidMl: body.fluidMl ?? null,
      restrictions: body.restrictions ? JSON.stringify(body.restrictions) : null,
      isVeg: body.isVeg ?? false,
      isJain: body.isJain ?? false,
      isHalal: body.isHalal ?? false,
      isKosher: body.isKosher ?? false,
      isNoOnionGarlic: body.isNoOnionGarlic ?? false,
      targetConditions: body.targetConditions ? JSON.stringify(body.targetConditions) : null,
      isGeneral: body.isGeneral ?? false,
      kind: body.kind ?? 'ORAL',
      isActive: body.isActive ?? true,
      createdBy: id ? undefined : (req.user?.username ?? null),
    };
    const row = id
      ? await prisma.dietMaster.update({ where: { id }, data })
      : await prisma.dietMaster.create({ data });
    await auditLog(req, {
      module: 'dietetics',
      action: id ? 'UPDATE' : 'CREATE',
      entityType: 'DietMaster',
      entityId: row.id,
      payload: { code: row.code },
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertDiet failed:', error);
    res.status(500).json({
      error: 'Failed to save diet',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── MealMaster ──────────────────────────────────────────────────────

export const listMeals = async (req: Request, res: Response): Promise<void> => {
  try {
    const onlyActive = req.query.active === 'true';
    const dietId = req.query.dietId as string | undefined;
    const rows = await prisma.mealMaster.findMany({
      where: {
        ...(onlyActive && { isActive: true }),
        ...(dietId && { compatibleDiets: { some: { dietMasterId: dietId } } }),
      },
      include: {
        compatibleDiets: { select: { dietMasterId: true } },
        allergens: { select: { allergenId: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
    // Flatten the joins into the id arrays the client edits and posts back
    // via upsertMeal (compatibleDietIds / allergenIds).
    const shaped = rows.map(({ compatibleDiets, allergens, ...meal }) => ({
      ...meal,
      compatibleDietIds: compatibleDiets.map((c) => c.dietMasterId),
      allergenIds: allergens.map((a) => a.allergenId),
    }));
    res.status(200).json(shaped);
  } catch (error) {
    console.error('[dietetics] listMeals failed:', error);
    res.status(500).json({ error: 'Failed to list meals' });
  }
};

interface MealBody {
  name: string;
  description?: string;
  category?: string;
  caloriesKcal?: number;
  isVeg?: boolean;
  isActive?: boolean;
  compatibleDietIds?: string[];
  allergenIds?: string[];
}

export const upsertMeal = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as MealBody;
    if (!body.name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const data = {
      name: body.name.trim(),
      description: body.description ?? null,
      category: body.category ?? null,
      caloriesKcal: body.caloriesKcal ?? null,
      isVeg: body.isVeg ?? true,
      isActive: body.isActive ?? true,
    };
    const row = await prisma.$transaction(async (tx) => {
      const saved = id
        ? await tx.mealMaster.update({ where: { id }, data })
        : await tx.mealMaster.create({ data });

      // Replace M-to-N rows wholesale — simpler than reconciling diffs.
      if (Array.isArray(body.compatibleDietIds)) {
        await tx.dietMealCompat.deleteMany({ where: { mealMasterId: saved.id } });
        if (body.compatibleDietIds.length > 0) {
          await tx.dietMealCompat.createMany({
            data: body.compatibleDietIds.map((dietMasterId) => ({
              dietMasterId,
              mealMasterId: saved.id,
            })),
          });
        }
      }
      if (Array.isArray(body.allergenIds)) {
        await tx.mealAllergen.deleteMany({ where: { mealMasterId: saved.id } });
        if (body.allergenIds.length > 0) {
          await tx.mealAllergen.createMany({
            data: body.allergenIds.map((allergenId) => ({
              allergenId,
              mealMasterId: saved.id,
            })),
          });
        }
      }
      return saved;
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertMeal failed:', error);
    res.status(500).json({
      error: 'Failed to save meal',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── MenuPlan ────────────────────────────────────────────────────────

/** Returns the full weekly grid for a given diet — used by the menu editor. */
export const getMenuForDiet = async (req: Request, res: Response): Promise<void> => {
  try {
    const dietMasterId = req.params.dietMasterId;
    if (!dietMasterId) { res.status(400).json({ error: 'dietMasterId required' }); return; }
    const rows = await prisma.menuPlan.findMany({
      where: { dietMasterId },
      include: { meal: true, mealTimeSlot: true },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] getMenuForDiet failed:', error);
    res.status(500).json({ error: 'Failed to load menu' });
  }
};

export const upsertMenuCell = async (req: Request, res: Response): Promise<void> => {
  try {
    const { dietMasterId, mealTimeSlotId, dayOfWeek, mealMasterId, notes } = req.body as {
      dietMasterId: string;
      mealTimeSlotId: string;
      dayOfWeek: number;
      mealMasterId: string;
      notes?: string;
    };
    if (!dietMasterId || !mealTimeSlotId || dayOfWeek == null || !mealMasterId) {
      res.status(400).json({ error: 'dietMasterId, mealTimeSlotId, dayOfWeek, mealMasterId are required' });
      return;
    }
    if (dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: 'dayOfWeek must be 0..6' });
      return;
    }
    const row = await prisma.menuPlan.upsert({
      where: {
        dietMasterId_mealTimeSlotId_dayOfWeek: { dietMasterId, mealTimeSlotId, dayOfWeek },
      },
      create: { dietMasterId, mealTimeSlotId, dayOfWeek, mealMasterId, notes: notes ?? null },
      update: { mealMasterId, notes: notes ?? null },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] upsertMenuCell failed:', error);
    res.status(500).json({ error: 'Failed to save menu cell' });
  }
};

export const clearMenuCell = async (req: Request, res: Response): Promise<void> => {
  try {
    // Values come from the URL. Every one must be present — Prisma treats an
    // undefined filter as "no filter", which would wipe every menu row.
    const { dietMasterId, mealTimeSlotId } = req.params;
    const dayOfWeek = Number.parseInt(req.params.dayOfWeek, 10);
    if (!dietMasterId || !mealTimeSlotId || Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: 'dietMasterId, mealTimeSlotId and dayOfWeek (0..6) are required' });
      return;
    }
    const result = await prisma.menuPlan.deleteMany({
      where: { dietMasterId, mealTimeSlotId, dayOfWeek },
    });
    res.status(200).json({ deleted: result.count });
  } catch (error) {
    console.error('[dietetics] clearMenuCell failed:', error);
    res.status(500).json({ error: 'Failed to clear menu cell' });
  }
};

// ─── DietTexture (consistency modifier: SD / VSD / MSD / blended…) ───

export const listTextures = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.dietTexture.findMany({ orderBy: [{ sequence: 'asc' }, { name: 'asc' }] });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listTextures failed:', error);
    res.status(500).json({ error: 'Failed to list textures' });
  }
};

export const upsertTexture = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { name, code, description, sequence, isActive } = req.body as {
      name: string; code: string; description?: string | null; sequence?: number; isActive?: boolean;
    };
    if (!name?.trim() || !code?.trim()) {
      res.status(400).json({ error: 'name and code are required' });
      return;
    }
    const data = {
      name: name.trim(),
      // Codes are shown as typed on the sheet / labels ("SRDD-SD"), so keep case.
      code: code.trim(),
      description: description?.trim() || null,
      sequence: sequence ?? 0,
      isActive: isActive ?? true,
    };
    const row = id
      ? await prisma.dietTexture.update({ where: { id }, data })
      : await prisma.dietTexture.create({ data });
    await auditLog(req, {
      module: 'dietetics', action: id ? 'UPDATE' : 'CREATE',
      entityType: 'DietTexture', entityId: row.id, payload: { code: row.code },
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertTexture failed:', error);
    res.status(500).json({
      error: 'Failed to save texture',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── SupplementMaster (Ensure DM, Resource Dialysis, feed formulas…) ─

export const listSupplements = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.supplementMaster.findMany({ orderBy: [{ name: 'asc' }] });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listSupplements failed:', error);
    res.status(500).json({ error: 'Failed to list supplements' });
  }
};

export const upsertSupplement = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const { name, unit, defaultDose, notes, isActive } = req.body as {
      name: string; unit?: string | null; defaultDose?: string | null; notes?: string | null; isActive?: boolean;
    };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const data = {
      name: name.trim(),
      unit: unit?.trim() || null,
      defaultDose: defaultDose?.trim() || null,
      notes: notes?.trim() || null,
      isActive: isActive ?? true,
    };
    const row = id
      ? await prisma.supplementMaster.update({ where: { id }, data })
      : await prisma.supplementMaster.create({ data });
    await auditLog(req, {
      module: 'dietetics', action: id ? 'UPDATE' : 'CREATE',
      entityType: 'SupplementMaster', entityId: row.id, payload: { name: row.name },
    });
    res.status(id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[dietetics] upsertSupplement failed:', error);
    res.status(500).json({
      error: 'Failed to save supplement',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Settings (sheet window, label layout, standing notes) ──────────

/**
 * Known settings and their defaults. Values are JSON-encoded in the table;
 * unknown keys are rejected so a typo can't silently create a new setting.
 */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  // Slot that opens the Diet Information Sheet window (their sheet runs
  // evening today → lunch tomorrow). null = first slot of the day.
  sheetStartSlotId: null,
  // Standing kitchen instructions printed on every sheet header.
  sheetStandingNotes: '',
  // Label sheet layout (A4 sticker sheets by default).
  labelWidthMm: 63,
  labelHeightMm: 38,
  labelColumns: 3,
  labelShowQr: true,
  // Default screening form when age / ward don't decide it.
  defaultScreeningForm: 'NRS2002',
  // Department names whose admissions get the Maternal form by default.
  maternalDepartments: ['OBG', 'Obstetrics', 'Gynaecology', 'OBG/Gynaec'],
};

export async function readSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.dieteticsSetting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (!(r.key in SETTING_DEFAULTS)) continue;
    try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
  }
  return out;
}

export const getSettings = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(await readSettings());
  } catch (error) {
    console.error('[dietetics] getSettings failed:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
};

export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(body).filter((k) => !(k in SETTING_DEFAULTS));
    if (unknown.length) {
      res.status(400).json({ error: `Unknown setting(s): ${unknown.join(', ')}` });
      return;
    }
    for (const [key, value] of Object.entries(body)) {
      await prisma.dieteticsSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value), updatedBy: req.user?.username ?? null },
        update: { value: JSON.stringify(value), updatedBy: req.user?.username ?? null },
      });
    }
    await auditLog(req, {
      module: 'dietetics', action: 'UPDATE', entityType: 'DieteticsSetting',
      entityId: 'settings', payload: { keys: Object.keys(body) },
    });
    res.status(200).json(await readSettings());
  } catch (error) {
    console.error('[dietetics] updateSettings failed:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
};

// ─── Drug-food interactions (built-in catalogue) ────────────────────

export const listDrugFoodInteractions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.drugFoodInteraction.findMany({
      where: { isActive: true },
      orderBy: [{ severity: 'desc' }, { match: 'asc' }],
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[dietetics] listDrugFoodInteractions failed:', error);
    res.status(500).json({ error: 'Failed to load drug-food interactions' });
  }
};

/**
 * Cross-reference active IpdPrescriptions for an admission against the
 * DrugFoodInteraction catalogue. Returns matches with the prescription
 * row id + drug name + severity + guidance for the Diet tab banner.
 */
export const getInteractionsForAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!admissionId) { res.status(400).json({ error: 'admissionId required' }); return; }
    const [prescriptions, interactions] = await Promise.all([
      prisma.ipdPrescription.findMany({
        where: { admissionId, status: 'active' },
        select: { id: true, genericName: true, brandName: true },
      }),
      prisma.drugFoodInteraction.findMany({ where: { isActive: true } }),
    ]);
    const matches: Array<{
      prescriptionId: string;
      drugName: string;
      severity: string;
      foodGuidance: string;
    }> = [];
    for (const rx of prescriptions) {
      const haystack = `${rx.genericName ?? ''} ${rx.brandName ?? ''}`.toLowerCase();
      for (const inter of interactions) {
        if (haystack.includes(inter.match.toLowerCase())) {
          matches.push({
            prescriptionId: rx.id,
            drugName: rx.genericName ?? rx.brandName ?? '—',
            severity: inter.severity,
            foodGuidance: inter.foodGuidance,
          });
        }
      }
    }
    res.status(200).json(matches);
  } catch (error) {
    console.error('[dietetics] getInteractionsForAdmission failed:', error);
    res.status(500).json({ error: 'Failed to compute drug-food matches' });
  }
};
