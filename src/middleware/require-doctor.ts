import type { Request, Response, NextFunction } from 'express';
import prisma from '../service/prisma-client';

/**
 * Doctor mobile app guard — the caller must be linked to a Doctor record.
 *
 * The "/my-…" doctor endpoints (OPD queue, IPD round, reports, WhatsApp
 * queries) scope every query by the caller's Doctor row. Without one they
 * used to fall back to "no filter" — every doctor's patients — so a non-doctor
 * calling them directly could read and act on any patient. These routes are
 * the doctor's own work list; nobody else has a reason to call them.
 *
 * Apply AFTER `authenticateToken`. Role checks hit the DB (the JWT carries
 * only `{ id, username }`), same as requireRole.
 */
export const requireDoctor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const userId = req.user?.id;
  if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const doctor = await prisma.doctor.findFirst({ where: { userId }, select: { id: true } });
    if (!doctor) {
      res.status(403).json({ error: 'Only doctors can use this. Your login is not linked to a doctor profile — ask IT.' });
      return;
    }
    next();
  } catch (error) {
    console.error('[require-doctor] failed:', error);
    res.status(500).json({ error: 'Could not check your access' });
  }
};
