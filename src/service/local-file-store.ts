import fs from 'fs';
import path from 'path';

/**
 * Local file storage — write uploads to the server's PDF_STORAGE_DIR and serve
 * them through the existing `app.use('/files', express.static(PDF_STORAGE_DIR))`
 * mount (see src/index.ts). Same pattern as estimation/NABH PDFs.
 *
 * Replaces the old basic-ftp uploads to an external host (which hardcoded FTP
 * credentials in source). Files now live on the API server only.
 *
 * URL forms:
 *   relativeUrl — `/files/<subdir>/<file>`. Use for things the in-app frontend
 *                 renders (it resolves against the API origin).
 *   absoluteUrl — `${PUBLIC_BASE_URL}/files/<subdir>/<file>`. Use when an
 *                 EXTERNAL consumer must fetch the file (e.g. WhatsApp pulling
 *                 an image by URL). Falls back to relativeUrl if PUBLIC_BASE_URL
 *                 is unset.
 */

const STORAGE_DIR = process.env.PDF_STORAGE_DIR || '/var/www/docminds/pdfs';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

export interface StoredFile {
  fileName: string;
  /** Absolute path on the local filesystem. */
  filePath: string;
  /** `/files/<subdir>/<file>` — resolve against the API origin. */
  relativeUrl: string;
  /** `${PUBLIC_BASE_URL}/files/...`, or relativeUrl if PUBLIC_BASE_URL unset. */
  absoluteUrl: string;
}

/** Strip anything that isn't filename-safe (no path separators, no traversal). */
export const sanitizeFileName = (name: string): string =>
  path
    .basename(name)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'file';

const buildResult = (subdir: string, fileName: string, filePath: string): StoredFile => {
  const relativeUrl = `/files/${subdir}/${fileName}`;
  return {
    fileName,
    filePath,
    relativeUrl,
    absoluteUrl: PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}${relativeUrl}` : relativeUrl,
  };
};

const ensureDir = (subdir: string): string => {
  const dir = path.join(STORAGE_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Write a buffer (e.g. multer memoryStorage `file.buffer`) to local storage. */
export const saveBufferToStorage = (
  buffer: Buffer,
  subdir: string,
  fileName: string
): StoredFile => {
  const safeName = sanitizeFileName(fileName);
  const dir = ensureDir(subdir);
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, buffer);
  return buildResult(subdir, safeName, filePath);
};

/**
 * Copy a file already on disk (e.g. a formidable/puppeteer temp file) into
 * local storage. The source is removed afterwards. Copy (not rename) because
 * the temp file may live on a different volume.
 */
export const saveFileToStorage = (
  srcPath: string,
  subdir: string,
  fileName: string
): StoredFile => {
  const safeName = sanitizeFileName(fileName);
  const dir = ensureDir(subdir);
  const filePath = path.join(dir, safeName);
  fs.copyFileSync(srcPath, filePath);
  try {
    fs.unlinkSync(srcPath);
  } catch {
    /* temp cleanup is best-effort */
  }
  return buildResult(subdir, safeName, filePath);
};
