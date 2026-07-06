import fs from 'fs';
import path from 'path';
import prisma from '../../service/prisma-client';

// Delete patient-uploaded WhatsApp media after the retention window (default 5
// days), per the consent/privacy notice shown to patients. Removes the files on
// disk AND nulls the media fields on the message so the doctor panel shows the
// attachment as expired rather than a broken link. Message text/caption stays.

const RETENTION_DAYS = Number(process.env.WHATSAPP_MEDIA_RETENTION_DAYS) || 5;

export interface MediaCleanupReport {
  filesDeleted: number;
  rowsCleared: number;
}

export async function runWhatsappMediaCleanup(): Promise<MediaCleanupReport> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const storageDir = process.env.PDF_STORAGE_DIR || '/var/www/docminds/pdfs';
  const dir = path.join(storageDir, 'whatsapp');

  const expired = await prisma.whatsappQueryMessage.findMany({
    where: { mediaUrl: { not: null }, created_at: { lt: cutoff } },
    select: { id: true, mediaUrl: true },
  });

  let filesDeleted = 0;
  for (const m of expired) {
    const fileName = (m.mediaUrl ?? '').split('/').pop();
    if (!fileName) continue;
    const filePath = path.join(dir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        filesDeleted++;
      }
    } catch (e) {
      console.warn('[whatsapp-media-cleanup] unlink failed:', filePath, (e as Error).message);
    }
  }

  let rowsCleared = 0;
  if (expired.length) {
    const res = await prisma.whatsappQueryMessage.updateMany({
      where: { id: { in: expired.map((m) => m.id) } },
      data: { mediaUrl: null, mediaType: null, mediaMime: null, fileName: null },
    });
    rowsCleared = res.count;
  }
  return { filesDeleted, rowsCleared };
}

export const registerWhatsappMediaCleanupCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  // Daily at 02:00.
  cron.schedule('0 2 * * *', async () => {
    if (isRunning) { console.log('[whatsapp-media-cleanup] previous run still going — skipping'); return; }
    isRunning = true;
    try {
      const r = await runWhatsappMediaCleanup();
      if (r.filesDeleted || r.rowsCleared) {
        console.log(`[whatsapp-media-cleanup] deleted ${r.filesDeleted} file(s), cleared ${r.rowsCleared} row(s)`);
      }
    } catch (err) {
      console.error('[whatsapp-media-cleanup] failed:', err);
    } finally {
      isRunning = false;
    }
  });
};
