import { Router, RequestHandler, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../../middleware/middleware';
import { requireRole } from '../../middleware/require-role';
import { runHmisImport, lastHmisImport } from './hmis-import.service';
import { HmisExportError } from './hmis-export-parser';

/**
 * HMIS export import — `/api/hmis-import`.
 *
 *   POST /preview  multipart `files` (1–6 exports) → what would change
 *   POST /apply    same files → applies the plan
 *   GET  /status   last applied import (time, who, counts)
 *
 * Files are parsed in memory and never stored (they carry patient data).
 * Super admin and Nursing Superintendent only.
 */
const router = Router();

const MAX_MB = 10;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 } });

const uploadFiles: RequestHandler = (req, res, next) => {
  upload.array('files', 6)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      // Drain the rest of the upload before answering (see patient.routes.ts).
      req.unpipe();
      req.resume();
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        message: err.code === 'LIMIT_FILE_SIZE' ? `Each file must be under ${MAX_MB}MB` : `Upload failed: ${err.message}`,
        code: err.code,
      });
      return;
    }
    next(err);
  });
};

const importer = requireRole({ subAdminTypes: ['Nursing Superintendent'] });

const handle = (apply: boolean) => async (req: Request, res: Response): Promise<void> => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) {
    res.status(400).json({ message: 'Attach at least one HMIS export (field "files")' });
    return;
  }
  try {
    const result = await runHmisImport(
      files.map((f) => ({ name: f.originalname, buffer: f.buffer })),
      { apply, req },
    );
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof HmisExportError) {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error(`[hmis-import] ${apply ? 'apply' : 'preview'} failed:`, error);
    res.status(500).json({ message: 'HMIS import failed' });
  }
};

router.post('/preview', authenticateToken, importer, uploadFiles, handle(false));
router.post('/apply', authenticateToken, importer, uploadFiles, handle(true));
router.get('/status', authenticateToken, async (_req, res) => {
  try {
    res.status(200).json(await lastHmisImport());
  } catch (error) {
    console.error('[hmis-import] status failed:', error);
    res.status(500).json({ message: 'Failed to load import status' });
  }
});

export default router;
