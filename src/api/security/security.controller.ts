import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { blockIp, unblockIp } from '../../middleware/global-rate-limit';

/**
 * Super-admin management of rate-limit IP blocks.
 * Routes are guarded by authenticateToken + requireRole super_admin.
 */

/** GET /api/security/blocks?active=true — list blocks (active first, newest first). */
export const listBlocks = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeOnly = req.query.active === 'true';
    const blocks = await prisma.securityIpBlock.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ active: 'desc' }, { blockedAt: 'desc' }],
      take: 500,
    });
    res.status(200).json({ count: blocks.length, blocks });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list blocks' });
  }
};

/** POST /api/security/blocks/:ip/unblock — lift a block. */
export const unblock = async (req: Request, res: Response): Promise<void> => {
  try {
    const ip = req.params.ip;
    if (!ip) {
      res.status(400).json({ error: 'ip is required' });
      return;
    }
    const ok = await unblockIp(ip, req.user?.username ?? null);
    if (!ok) {
      res.status(404).json({ error: 'No active block found for that IP' });
      return;
    }
    res.status(200).json({ message: `Unblocked ${ip}`, ip });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to unblock' });
  }
};

/** POST /api/security/blocks — manually block an IP { ip, reason?, minutes? }. */
export const createBlock = async (req: Request, res: Response): Promise<void> => {
  try {
    const { ip, reason, minutes } = req.body ?? {};
    if (!ip || typeof ip !== 'string') {
      res.status(400).json({ error: 'ip is required' });
      return;
    }
    const mins = minutes === null || minutes === undefined ? null : Number(minutes);
    await blockIp(ip, reason || `manual block by ${req.user?.username ?? 'admin'}`, mins, 0);
    res.status(201).json({ message: `Blocked ${ip}`, ip, minutes: mins });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to block' });
  }
};
