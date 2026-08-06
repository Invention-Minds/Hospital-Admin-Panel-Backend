import type { Request, Response } from 'express';
import fs from 'fs';
import { resolveSecureLink, logRecordAccess } from '../../service/record-access.service';

// Public, token-authenticated record view: GET /p/:token
// The token IS the credential (random, PRN-scoped, expiring). Files live in the
// private storage dir and are never exposed via the /files static mount.

export const viewSecureLink = async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token;
  const link = await resolveSecureLink(token);
  if (!link) {
    res.status(404).send('This link is invalid or has expired. Please request the document again on WhatsApp.');
    return;
  }
  if (!fs.existsSync(link.filePath)) {
    res.status(410).send('This document is no longer available. Please request it again on WhatsApp.');
    return;
  }

  if (!link.firstUsedAt) {
    await import('../../service/prisma-client').then(({ default: prisma }) =>
      prisma.secureLink.update({ where: { id: link.id }, data: { firstUsedAt: new Date() } }).catch(() => {}),
    );
  }
  await logRecordAccess({ prn: link.prn, phone: '', itemType: link.kind, itemRef: link.refId, action: 'viewed', channel: 'link' });

  res.setHeader('Content-Type', link.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${link.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  fs.createReadStream(link.filePath).pipe(res);
};
