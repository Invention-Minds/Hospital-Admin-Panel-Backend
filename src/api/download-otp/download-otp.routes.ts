import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import moment from 'moment-timezone';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import prisma from '../../service/prisma-client';
import {
  SecurityError, createCaptcha, isValidDownloadGrant, maskEmail, sendEmailOtp, signDownloadGrant,
  signDownloadTicket, verifyCaptcha, verifyEmailOtp,
} from '../../service/account-security.service';

// Download gate:
//   1. email OTP → grant valid 60 min (X-Download-Grant)
//   2. every download: image captcha + reason → DownloadLog row + one-time
//      ticket (X-Download-Ticket) that server file routes consume.
const router = Router();
router.use(authenticateToken);

const MIN_REASON = 5;
const MAX_REASON = 500;

// Download ID printed in the footer of every downloaded file:
//   <employeeId>-<YYYYMMDD>-<HHmmss IST>-<this user's nth download>
// e.g. EMP1023-20261031-143205-0057. The count includes downloads logged
// before the ID existed; @@unique([userId, seq]) makes two simultaneous
// downloads retry instead of sharing a number.
type LogFields = Pick<Prisma.DownloadLogUncheckedCreateInput, 'label' | 'page' | 'reason' | 'ip' | 'userAgent'>;

async function createNumberedLog(
  userId: number,
  user: { username: string; employeeId: string | null; role: string },
  fields: LogFields,
): Promise<{ id: string; downloadRef: string | null }> {
  const who = (user.employeeId || user.username || '').replace(/[^A-Za-z0-9_]/g, '') || `U${userId}`;
  for (let attempt = 0; ; attempt++) {
    const now = new Date();
    const seq = (await prisma.downloadLog.count({ where: { userId } })) + 1;
    const downloadRef = `${who}-${moment(now).tz('Asia/Kolkata').format('YYYYMMDD-HHmmss')}-${String(seq).padStart(4, '0')}`;
    try {
      return await prisma.downloadLog.create({
        data: { userId, username: user.username, employeeId: user.employeeId, role: user.role, ...fields, seq, downloadRef, createdAt: now },
        select: { id: true, downloadRef: true },
      });
    } catch (error) {
      const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!clash || attempt >= 4) throw error;
    }
  }
}

function sendError(res: Response, error: unknown, label: string) {
  if (error instanceof SecurityError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(`[download-otp] ${label} failed:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

router.post('/request', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user?.email || !user.emailVerifiedAt) {
      throw new SecurityError(409, 'No verified email on your account. Please sign out and sign in again to add one.');
    }
    const { expiresAt } = await sendEmailOtp(user.id, 'download', user.email);
    res.status(200).json({ sentTo: maskEmail(user.email), expiresAt });
  } catch (error) {
    sendError(res, error, 'request');
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    await verifyEmailOtp(req.user!.id, 'download', req.body?.otp);
    res.status(200).json(signDownloadGrant(req.user!.id));
  } catch (error) {
    sendError(res, error, 'verify');
  }
});

router.get('/captcha', async (req: Request, res: Response) => {
  try {
    res.status(200).json(await createCaptcha(req.user!.id));
  } catch (error) {
    sendError(res, error, 'captcha');
  }
});

router.post('/authorize', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    if (!isValidDownloadGrant(req.headers['x-download-grant'], userId)) {
      throw new SecurityError(428, 'Email OTP verification is required to download.');
    }
    verifyCaptcha(req.body?.captchaId, req.body?.captchaAnswer, userId);

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < MIN_REASON) throw new SecurityError(400, `Please enter a reason (at least ${MIN_REASON} characters).`);
    const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 191) : '';
    const page = typeof req.body?.page === 'string' ? req.body.page.slice(0, 191) : null;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, employeeId: true, role: true } });
    if (!user) throw new SecurityError(401, 'User not found.');

    const log = await createNumberedLog(userId, user, {
      label: label || 'Unlabelled download',
      page,
      reason: reason.slice(0, MAX_REASON),
      ip: (req.ip || req.socket?.remoteAddress || '').slice(0, 64) || null,
      userAgent: (req.headers['user-agent'] || '').slice(0, 1000) || null,
    });
    res.status(200).json({ logId: log.id, downloadRef: log.downloadRef, ticket: signDownloadTicket(userId, log.id) });
  } catch (error) {
    sendError(res, error, 'authorize');
  }
});

// Audit view (Settings → Download Logs). super_admin always passes requireRole.
router.get('/logs', requireRole({ roles: ['admin'] }), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const from = typeof req.query.from === 'string' && req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    const to = typeof req.query.to === 'string' && req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : null;

    const where: Prisma.DownloadLogWhereInput = {
      ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
      ...(search && {
        OR: [
          { username: { contains: search } },
          { employeeId: { contains: search } },
          { downloadRef: { contains: search } },
          { label: { contains: search } },
          { reason: { contains: search } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      prisma.downloadLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.downloadLog.count({ where }),
    ]);
    res.status(200).json({ data: rows, total, page, pageSize });
  } catch (error) {
    sendError(res, error, 'logs');
  }
});

export default router;
