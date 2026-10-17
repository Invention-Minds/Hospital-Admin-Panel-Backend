import { Request, Response, NextFunction } from 'express';
import prisma from '../service/prisma-client';
import { isValidDownloadGrant, readDownloadTicket } from '../service/account-security.service';

/**
 * File-download routes need both:
 *   - X-Download-Grant  — email OTP, valid 60 minutes (POST /api/download-otp/verify)
 *   - X-Download-Ticket — one per download, issued after captcha + reason
 *     (POST /api/download-otp/authorize). Consuming it stamps the DownloadLog
 *     row with the route actually served.
 * Must run after authenticateToken.
 */
export const requireDownloadGrant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const userId = req.user?.id;
  if (typeof userId !== 'number' || !isValidDownloadGrant(req.headers['x-download-grant'], userId)) {
    res.status(428).json({ error: 'Email OTP verification is required to download.', code: 'DOWNLOAD_OTP_REQUIRED' });
    return;
  }
  try {
    const logId = readDownloadTicket(req.headers['x-download-ticket'], userId);
    const consumed = logId
      ? await prisma.downloadLog.updateMany({
          where: { id: logId, userId, servedAt: null },
          data: { servedAt: new Date(), serverRoute: req.originalUrl.slice(0, 1000) },
        })
      : { count: 0 };
    if (consumed.count !== 1) {
      res.status(428).json({ error: 'Please complete the captcha and reason for this download.', code: 'DOWNLOAD_REASON_REQUIRED' });
      return;
    }
    next();
  } catch (error) {
    next(error); // Express 4 doesn't catch async rejections itself
  }
};
