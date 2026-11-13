import { Router, type Request, type Response } from 'express';
import prisma from '../../service/prisma-client';
import { authenticateToken } from '../../middleware/middleware';

// Mobile app push-token registration. Mounted at /api/mobile/push.
const router = Router();
const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

/** POST /register {token, platform} — upsert this device for the signed-in user. */
router.post('/register', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
    if (!userId) return void res.status(401).json({ error: 'Sign in again' });
    if (!TOKEN_RE.test(token)) return void res.status(400).json({ error: 'Not an Expo push token' });
    // A phone handed to another doctor moves to them; re-enable if it was off.
    const row = await prisma.mobilePushDevice.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date(), disabledAt: null },
      select: { id: true },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[mobile-push] register failed:', error);
    res.status(500).json({ error: 'Failed to register for notifications' });
  }
});

/** POST /unregister {token} — on sign-out, so alerts stop reaching this phone. */
router.post('/unregister', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!userId || !token) return void res.status(400).json({ error: 'token is required' });
    const r = await prisma.mobilePushDevice.updateMany({ where: { token, userId }, data: { disabledAt: new Date() } });
    res.status(200).json({ data: { disabled: r.count } });
  } catch (error) {
    console.error('[mobile-push] unregister failed:', error);
    res.status(500).json({ error: 'Failed to unregister' });
  }
});

export default router;
