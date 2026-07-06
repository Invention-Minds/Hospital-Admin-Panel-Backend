import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.16 — ICU Nurses Care Record controllers.
//   • Invasive lines register (line-days)
//   • Nursing care plan (goals checklist + GOAL/PLANNING/IMPLEMENTATION/OUTCOME)
//   • Nurse special notes
// All admission-scoped, mounted under /api/ipd/admission/:admissionId/icu/...

const VALID_LINE_TYPES = ['peripheral', 'central', 'arterial', 'hd-catheter', 'trach-et', 'foley'];

async function assertAdmission(admissionId: string): Promise<boolean> {
  const a = await prisma.ipdAdmission.findUnique({ where: { id: admissionId }, select: { id: true } });
  return !!a;
}

// ─── Invasive lines ──────────────────────────────────────────────────────

export const listInvasiveLines = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuInvasiveLine.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: [{ removedAt: 'asc' }, { insertedAt: 'desc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-lines] list failed:', error);
    res.status(500).json({ message: 'Failed to load invasive lines' });
  }
};

export const addInvasiveLine = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!(await assertAdmission(admissionId))) { res.status(404).json({ message: 'Admission not found' }); return; }
    const b = req.body as Record<string, unknown>;
    if (!VALID_LINE_TYPES.includes(b['lineType'] as string)) {
      res.status(400).json({ message: `lineType must be one of: ${VALID_LINE_TYPES.join(', ')}` });
      return;
    }
    if (!b['insertedAt']) { res.status(400).json({ message: 'insertedAt is required' }); return; }
    const row = await prisma.icuInvasiveLine.create({
      data: {
        admissionId,
        lineType: b['lineType'] as string,
        site: (b['site'] as string)?.trim() || null,
        insertedAt: new Date(b['insertedAt'] as string),
        removedAt: b['removedAt'] ? new Date(b['removedAt'] as string) : null,
        removalReason: (b['removalReason'] as string)?.trim() || null,
        insertedBy: (b['insertedBy'] as string)?.trim() || null,
        notes: (b['notes'] as string)?.trim() || null,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, { module: 'icu-nurses-care', action: 'CREATE', entityType: 'IcuInvasiveLine', entityId: row.id, payload: { lineType: row.lineType } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-lines] add failed:', error);
    res.status(500).json({ message: 'Failed to add invasive line' });
  }
};

export const updateInvasiveLine = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const b = req.body as Record<string, unknown>;
    const row = await prisma.icuInvasiveLine.update({
      where: { id },
      data: {
        ...(b['site'] !== undefined && { site: (b['site'] as string)?.trim() || null }),
        ...(b['insertedAt'] !== undefined && { insertedAt: new Date(b['insertedAt'] as string) }),
        ...(b['removedAt'] !== undefined && { removedAt: b['removedAt'] ? new Date(b['removedAt'] as string) : null }),
        ...(b['removalReason'] !== undefined && { removalReason: (b['removalReason'] as string)?.trim() || null }),
        ...(b['notes'] !== undefined && { notes: (b['notes'] as string)?.trim() || null }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-lines] update failed:', error);
    res.status(500).json({ message: 'Failed to update invasive line' });
  }
};

export const removeInvasiveLine = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.icuInvasiveLine.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    console.error('[icu-lines] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove invasive line' });
  }
};

// ─── Nursing care plan ─────────────────────────────────────────────────────

const GOAL_FIELDS = [
  'goalPatentAirway', 'goalAdequateOxygenation', 'goalTissuePerfusion', 'goalFluidBalance',
  'goalPainRelief', 'goalNutrition', 'goalPreventDvt', 'goalSkinIntegrity',
  'goalActivityTolerance', 'goalPersonalHygiene', 'goalEliminationNeed', 'goalSafety',
  'goalReduceAnxiety', 'goalCommunication', 'goalPatientFamilyEducation',
] as const;

export const listCarePlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuNursingCarePlan.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { planDate: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-careplan] list failed:', error);
    res.status(500).json({ message: 'Failed to load care plans' });
  }
};

export const createCarePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!(await assertAdmission(admissionId))) { res.status(404).json({ message: 'Admission not found' }); return; }
    const b = req.body as Record<string, unknown>;
    const goals: Record<string, boolean> = {};
    for (const g of GOAL_FIELDS) goals[g] = !!b[g];
    const row = await prisma.icuNursingCarePlan.create({
      data: {
        admissionId,
        planDate: b['planDate'] ? new Date(b['planDate'] as string) : new Date(),
        shift: (b['shift'] as string) || null,
        ...goals,
        carePlanRows: b['carePlanRows'] != null ? JSON.stringify(b['carePlanRows']) : null,
        nurseName: (b['nurseName'] as string)?.trim() || null,
        nurseEmpNo: (b['nurseEmpNo'] as string)?.trim() || null,
        nurseSignatureId: (b['nurseSignatureId'] as string) || null,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, { module: 'icu-nurses-care', action: 'CREATE', entityType: 'IcuNursingCarePlan', entityId: row.id, payload: { planDate: row.planDate } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-careplan] create failed:', error);
    res.status(500).json({ message: 'Failed to save care plan' });
  }
};

export const updateCarePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const b = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const g of GOAL_FIELDS) if (b[g] !== undefined) data[g] = !!b[g];
    if (b['shift'] !== undefined) data['shift'] = (b['shift'] as string) || null;
    if (b['planDate'] !== undefined) data['planDate'] = new Date(b['planDate'] as string);
    if (b['carePlanRows'] !== undefined) data['carePlanRows'] = b['carePlanRows'] != null ? JSON.stringify(b['carePlanRows']) : null;
    if (b['nurseName'] !== undefined) data['nurseName'] = (b['nurseName'] as string)?.trim() || null;
    if (b['nurseEmpNo'] !== undefined) data['nurseEmpNo'] = (b['nurseEmpNo'] as string)?.trim() || null;
    if (b['nurseSignatureId'] !== undefined) data['nurseSignatureId'] = (b['nurseSignatureId'] as string) || null;
    const row = await prisma.icuNursingCarePlan.update({ where: { id }, data });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-careplan] update failed:', error);
    res.status(500).json({ message: 'Failed to update care plan' });
  }
};

export const removeCarePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.icuNursingCarePlan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    console.error('[icu-careplan] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove care plan' });
  }
};

// ─── Nurse special notes ───────────────────────────────────────────────────

export const listNurseNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuNurseNote.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { recordedAt: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-nursenote] list failed:', error);
    res.status(500).json({ message: 'Failed to load nurse notes' });
  }
};

export const addNurseNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!(await assertAdmission(admissionId))) { res.status(404).json({ message: 'Admission not found' }); return; }
    const b = req.body as Record<string, unknown>;
    if (!(b['note'] as string)?.trim()) { res.status(400).json({ message: 'note is required' }); return; }
    const row = await prisma.icuNurseNote.create({
      data: {
        admissionId,
        recordedAt: b['recordedAt'] ? new Date(b['recordedAt'] as string) : new Date(),
        note: (b['note'] as string).trim(),
        nurseName: (b['nurseName'] as string)?.trim() || null,
        nurseEmpNo: (b['nurseEmpNo'] as string)?.trim() || null,
        nurseSignatureId: (b['nurseSignatureId'] as string) || null,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, { module: 'icu-nurses-care', action: 'CREATE', entityType: 'IcuNurseNote', entityId: row.id, payload: null });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-nursenote] add failed:', error);
    res.status(500).json({ message: 'Failed to add nurse note' });
  }
};

export const removeNurseNote = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.icuNurseNote.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    console.error('[icu-nursenote] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove nurse note' });
  }
};
