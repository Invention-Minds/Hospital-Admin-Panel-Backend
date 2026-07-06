import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.19 — Emergency referral acknowledgment.
//
// The ER doctor refers a case to an in-system doctor/surgeon, who must
// acknowledge it within a triage-driven SLA. Creating the referral fires an
// in-app notification to that doctor; the escalation cron climbs the chain
// if it stays unacknowledged. Routes under /api/emergency.

// Default SLA (minutes) before the first escalation, by triage. Overridable
// via ReferralSlaConfig. Exported so the cron uses the same resolution.
const DEFAULT_SLA: Record<string, number> = { red: 5, yellow: 15, green: 30, black: 60 };

export const resolveSlaMinutes = async (triage: string): Promise<number> => {
  const cfg = await prisma.referralSlaConfig.findUnique({ where: { triageCategory: triage } }).catch(() => null);
  return cfg?.minutes ?? DEFAULT_SLA[triage] ?? 15;
};

interface CreateReferralBody {
  referredToDoctorId?: number;
  reason?: string | null;
}

export const createReferral = async (req: Request, res: Response): Promise<void> => {
  try {
    const emergencyId = parseInt(req.params.id, 10);
    if (Number.isNaN(emergencyId)) { res.status(400).json({ message: 'Invalid emergency id' }); return; }

    const body = req.body as CreateReferralBody;
    if (!body.referredToDoctorId) { res.status(400).json({ message: 'referredToDoctorId is required' }); return; }

    const emergency = await prisma.emergency.findUnique({
      where: { id: emergencyId },
      select: { id: true, prn: true, patientName: true, triageCategory: true },
    });
    if (!emergency) { res.status(404).json({ message: 'Emergency case not found' }); return; }

    const doctor = await prisma.doctor.findUnique({
      where: { id: body.referredToDoctorId },
      select: { id: true, name: true, userId: true, departmentName: true },
    });
    if (!doctor) { res.status(404).json({ message: 'Referred doctor not found' }); return; }

    const slaMinutes = await resolveSlaMinutes(emergency.triageCategory);

    const referral = await prisma.emergencyReferral.create({
      data: {
        emergencyId,
        referredToDoctorId: doctor.id,
        referredByName: req.user?.username ?? null,
        referredById: typeof req.user?.id === 'number' ? req.user.id : null,
        reason: body.reason?.trim() || null,
        triageCategory: emergency.triageCategory,
        slaMinutes,
        status: 'pending',
      },
      include: { referredToDoctor: { select: { id: true, name: true, departmentName: true } } },
    });

    // In-app notification to the referred doctor (bell).
    const isCritical = emergency.triageCategory === 'red';
    await prisma.notification.create({
      data: {
        type: 'emergency_referral',
        title: 'New emergency referral',
        message: `${req.user?.username ?? 'ER'} referred ${emergency.patientName} (${emergency.prn}, ${emergency.triageCategory}) to you — acknowledge within ${slaMinutes} min`,
        status: 'unread',
        userId: doctor.userId ?? undefined,
        isCritical,
        entityId: referral.id,
        entityType: 'EmergencyReferral',
      },
    }).catch((e) => console.warn('[referral] notify failed:', (e as Error).message));

    await auditLog(req, {
      module: 'emergency-referral', action: 'CREATE', entityType: 'EmergencyReferral',
      entityId: referral.id, payload: { emergencyId, referredToDoctorId: doctor.id },
    });

    res.status(201).json({ data: referral });
  } catch (error) {
    console.error('[referral] create failed:', error);
    res.status(500).json({ message: 'Failed to create referral' });
  }
};

export const listReferralsForEmergency = async (req: Request, res: Response): Promise<void> => {
  try {
    const emergencyId = parseInt(req.params.id, 10);
    if (Number.isNaN(emergencyId)) { res.status(400).json({ message: 'Invalid emergency id' }); return; }
    const rows = await prisma.emergencyReferral.findMany({
      where: { emergencyId },
      orderBy: { referredAt: 'desc' },
      include: { referredToDoctor: { select: { id: true, name: true, departmentName: true } } },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[referral] list failed:', error);
    res.status(500).json({ message: 'Failed to load referrals' });
  }
};

export const acknowledgeReferral = async (req: Request, res: Response): Promise<void> => {
  try {
    const refId = parseInt(req.params.refId, 10);
    if (Number.isNaN(refId)) { res.status(400).json({ message: 'Invalid referral id' }); return; }

    const existing = await prisma.emergencyReferral.findUnique({ where: { id: refId }, select: { id: true, status: true } });
    if (!existing) { res.status(404).json({ message: 'Referral not found' }); return; }
    if (existing.status !== 'pending') { res.status(409).json({ message: `Referral already ${existing.status}` }); return; }

    const row = await prisma.emergencyReferral.update({
      where: { id: refId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedByName: req.user?.username ?? null,
        acknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      include: { referredToDoctor: { select: { id: true, name: true, departmentName: true } } },
    });

    await auditLog(req, {
      module: 'emergency-referral', action: 'UPDATE', entityType: 'EmergencyReferral',
      entityId: refId, payload: { status: 'acknowledged' },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[referral] acknowledge failed:', error);
    res.status(500).json({ message: 'Failed to acknowledge referral' });
  }
};

export const cancelReferral = async (req: Request, res: Response): Promise<void> => {
  try {
    const refId = parseInt(req.params.refId, 10);
    if (Number.isNaN(refId)) { res.status(400).json({ message: 'Invalid referral id' }); return; }
    const existing = await prisma.emergencyReferral.findUnique({ where: { id: refId }, select: { id: true, status: true } });
    if (!existing) { res.status(404).json({ message: 'Referral not found' }); return; }
    if (existing.status === 'acknowledged') { res.status(409).json({ message: 'Cannot cancel an acknowledged referral' }); return; }
    const row = await prisma.emergencyReferral.update({ where: { id: refId }, data: { status: 'cancelled' } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[referral] cancel failed:', error);
    res.status(500).json({ message: 'Failed to cancel referral' });
  }
};

// All emergency referrals to the logged-in doctor — both still-pending (referred)
// and already-acknowledged (assigned). Powers the doctor's "my emergency patients"
// worklist. Cancelled referrals are excluded.
export const myEmergencyReferrals = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : null;
    if (userId == null) { res.status(200).json({ data: [] }); return; }
    const rows = await prisma.emergencyReferral.findMany({
      where: { status: { in: ['pending', 'acknowledged'] }, referredToDoctor: { userId } },
      orderBy: { referredAt: 'desc' },
      include: {
        emergency: {
          select: { id: true, prn: true, patientName: true, triageCategory: true, status: true },
        },
      },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[referral] mine failed:', error);
    res.status(500).json({ message: 'Failed to load referrals' });
  }
};

// Pending referrals awaiting the logged-in doctor's acknowledgment.
export const myPendingReferrals = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : null;
    if (userId == null) { res.status(200).json({ data: [] }); return; }
    const rows = await prisma.emergencyReferral.findMany({
      where: { status: 'pending', referredToDoctor: { userId } },
      orderBy: { referredAt: 'asc' },
      include: {
        emergency: { select: { id: true, prn: true, patientName: true, triageCategory: true } },
      },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[referral] my-pending failed:', error);
    res.status(500).json({ message: 'Failed to load referrals' });
  }
};
