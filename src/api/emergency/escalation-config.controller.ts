import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.19 — admin config for the referral escalation chain + SLA.
//
// EscalationChainStep: an ordered, per-department list of who to notify when
// a referral goes unacknowledged. Level 1 is the first escalation above the
// referred doctor. ReferralSlaConfig: minutes-before-escalation by triage.

const VALID_TARGET_TYPES = ['doctor', 'role'];
const VALID_TRIAGE = ['red', 'yellow', 'green', 'black'];

// ─── Escalation chain ──────────────────────────────────────────────────

export const listChain = async (req: Request, res: Response): Promise<void> => {
  try {
    const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
    const rows = await prisma.escalationChainStep.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: [{ departmentId: 'asc' }, { level: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        targetDoctor: { select: { id: true, name: true, departmentName: true } },
      },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[escalation-config] listChain failed:', error);
    res.status(500).json({ message: 'Failed to load escalation chain' });
  }
};

interface StepBody {
  departmentId?: number;
  level?: number;
  targetType?: string;
  targetDoctorId?: number | null;
  targetRole?: string | null;
  label?: string | null;
}

const validateStep = (body: StepBody): string | null => {
  if (!body.departmentId) return 'departmentId is required';
  if (!body.level || body.level < 1) return 'level must be ≥ 1';
  if (!body.targetType || !VALID_TARGET_TYPES.includes(body.targetType)) {
    return `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}`;
  }
  if (body.targetType === 'doctor' && !body.targetDoctorId) return 'targetDoctorId is required when targetType=doctor';
  if (body.targetType === 'role' && !body.targetRole?.trim()) return 'targetRole is required when targetType=role';
  return null;
};

export const createStep = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as StepBody;
    const err = validateStep(body);
    if (err) { res.status(400).json({ message: err }); return; }

    const row = await prisma.escalationChainStep.create({
      data: {
        departmentId: body.departmentId!,
        level: body.level!,
        targetType: body.targetType!,
        targetDoctorId: body.targetType === 'doctor' ? body.targetDoctorId! : null,
        targetRole: body.targetType === 'role' ? body.targetRole!.trim() : null,
        label: body.label?.trim() || null,
      },
    });
    await auditLog(req, { module: 'emergency-referral', action: 'CREATE', entityType: 'EscalationChainStep', entityId: row.id, payload: { departmentId: row.departmentId, level: row.level } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[escalation-config] createStep failed:', error);
    res.status(500).json({ message: 'Failed to create chain step' });
  }
};

export const updateStep = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid step id' }); return; }
    const body = req.body as StepBody;
    const err = validateStep(body);
    if (err) { res.status(400).json({ message: err }); return; }

    const row = await prisma.escalationChainStep.update({
      where: { id },
      data: {
        departmentId: body.departmentId!,
        level: body.level!,
        targetType: body.targetType!,
        targetDoctorId: body.targetType === 'doctor' ? body.targetDoctorId! : null,
        targetRole: body.targetType === 'role' ? body.targetRole!.trim() : null,
        label: body.label?.trim() || null,
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[escalation-config] updateStep failed:', error);
    res.status(500).json({ message: 'Failed to update chain step' });
  }
};

export const deleteStep = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid step id' }); return; }
    await prisma.escalationChainStep.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    console.error('[escalation-config] deleteStep failed:', error);
    res.status(500).json({ message: 'Failed to delete chain step' });
  }
};

// ─── SLA config (minutes before escalation, by triage) ──────────────────

const DEFAULT_SLA: Record<string, number> = { red: 5, yellow: 15, green: 30, black: 60 };

export const getSla = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.referralSlaConfig.findMany();
    const byTriage = new Map(rows.map((r) => [r.triageCategory, r.minutes]));
    // Merge stored values over defaults so the UI always shows all triage rows.
    const data = VALID_TRIAGE.map((t) => ({ triageCategory: t, minutes: byTriage.get(t) ?? DEFAULT_SLA[t] }));
    res.status(200).json({ data });
  } catch (error) {
    console.error('[escalation-config] getSla failed:', error);
    res.status(500).json({ message: 'Failed to load SLA config' });
  }
};

export const setSla = async (req: Request, res: Response): Promise<void> => {
  try {
    const { triageCategory, minutes } = req.body as { triageCategory?: string; minutes?: number };
    if (!triageCategory || !VALID_TRIAGE.includes(triageCategory)) {
      res.status(400).json({ message: `triageCategory must be one of: ${VALID_TRIAGE.join(', ')}` });
      return;
    }
    if (typeof minutes !== 'number' || minutes < 1) { res.status(400).json({ message: 'minutes must be ≥ 1' }); return; }
    const row = await prisma.referralSlaConfig.upsert({
      where: { triageCategory },
      update: { minutes },
      create: { triageCategory, minutes },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[escalation-config] setSla failed:', error);
    res.status(500).json({ message: 'Failed to save SLA config' });
  }
};
