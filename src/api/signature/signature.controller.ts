import type { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../service/prisma-client';
import bucket from '../../config/googeCloudStorage';
import { auditLog } from '../../service/app-audit';

/**
 * Phase 0 — Reusable signature capture endpoint.
 *
 * Accepts EITHER:
 *   • a JSON body with `dataUrl` (base64 PNG from a canvas), OR
 *   • a multipart upload with field name `file`.
 *
 * Returns a SignatureBlob row that other modules link to via
 * `signatureId` foreign keys (consent, MAR ack, handover, CAPA close, etc.).
 *
 * NABH refs: PRE.4 (informed consent), AAC.10.d (handover), COP.14.e (operative note).
 */

interface SignContextBody {
  signerType: string;
  signerName: string;
  signerRole?: string;
  signerRelation?: string;
  contextType?: string;
  contextId?: string;
  dataUrl?: string;
  deviceFingerprint?: string;
}

const ALLOWED_SIGNER_TYPES = [
  'doctor',
  'nurse',
  // 'staff' covers generic clinical-staff signatures (used by Phase 4–7 chains —
  // MAR witness, ICU transfer originator/receiver, staff-handover originator,
  // discharge clinician). Treated like 'nurse'/'doctor' for signerId attribution.
  'staff',
  'patient',
  'attender',
  'supervisor',
  'witness',
  'other',
];

const isValidDataUrl = (s: string): boolean => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s);

const ipFromReq = (req: Request): string | null => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
};

const sha256 = (buf: Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * POST /api/signature
 * Body: SignContextBody (JSON) or multipart with `file` plus form fields.
 */
export const createSignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as SignContextBody;
    const file = (req as Request & { file?: Express.Multer.File }).file;

    // Validate common fields
    if (!body.signerType || !ALLOWED_SIGNER_TYPES.includes(body.signerType)) {
      res.status(400).json({ error: `signerType must be one of: ${ALLOWED_SIGNER_TYPES.join(', ')}` });
      return;
    }
    if (!body.signerName || body.signerName.trim().length === 0) {
      res.status(400).json({ error: 'signerName is required' });
      return;
    }

    let blobUrl: string;
    let mimeType = 'image/png';
    let hash: string | null = null;

    if (file) {
      // Multipart upload path — push to GCS like other uploads do.
      const objectName = `signatures/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${file.originalname}`;
      const blob = bucket.file(objectName);
      const stream = blob.createWriteStream({ resumable: false, contentType: file.mimetype });
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', () => resolve());
        stream.end(file.buffer);
      });
      blobUrl = `https://storage.googleapis.com/${bucket.name}/${objectName}`;
      mimeType = file.mimetype || 'image/png';
      hash = sha256(file.buffer);
    } else if (body.dataUrl && isValidDataUrl(body.dataUrl)) {
      // Inline data URL — stored directly in the row. Fine for small signatures.
      blobUrl = body.dataUrl;
      mimeType = body.dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
      const b64 = body.dataUrl.split(',')[1] ?? '';
      hash = sha256(Buffer.from(b64, 'base64'));
    } else {
      res.status(400).json({ error: 'Provide either a multipart file or a valid base64 dataUrl' });
      return;
    }

    const signerId = typeof req.user?.id === 'number' ? req.user.id : null;

    const signature = await prisma.signatureBlob.create({
      data: {
        blobUrl,
        mimeType,
        signerType: body.signerType,
        signerId: body.signerType === 'doctor' || body.signerType === 'nurse' || body.signerType === 'staff' || body.signerType === 'supervisor' ? signerId : null,
        signerName: body.signerName.trim(),
        signerRole: body.signerRole?.trim() ?? null,
        signerRelation: body.signerRelation?.trim() ?? null,
        contextType: body.contextType?.trim() ?? null,
        contextId: body.contextId?.trim() ?? null,
        deviceFingerprint: body.deviceFingerprint?.trim() ?? null,
        ipAddress: ipFromReq(req),
        sha256Hash: hash,
      },
    });

    await auditLog(req, {
      module: 'signature',
      action: 'CREATE',
      entityType: 'SignatureBlob',
      entityId: signature.id,
      payload: {
        signerType: signature.signerType,
        contextType: signature.contextType,
        contextId: signature.contextId,
      },
    });

    res.status(201).json({
      id: signature.id,
      blobUrl: signature.blobUrl,
      capturedAt: signature.capturedAt,
    });
  } catch (error) {
    console.error('[signature] create failed:', error);
    res.status(500).json({ error: 'Failed to create signature' });
  }
};

/**
 * GET /api/signature/:id — fetch one signature by id (used by audit views).
 */
export const getSignature = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const sig = await prisma.signatureBlob.findUnique({ where: { id } });
    if (!sig) {
      res.status(404).json({ error: 'Signature not found' });
      return;
    }
    res.status(200).json(sig);
  } catch (error) {
    console.error('[signature] get failed:', error);
    res.status(500).json({ error: 'Failed to fetch signature' });
  }
};

/**
 * GET /api/signature?contextType=...&contextId=...
 * Lists signatures linked to a particular consuming row — useful for the consent / handover audit views.
 */
export const listByContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const contextType = (req.query.contextType as string | undefined)?.trim();
    const contextId = (req.query.contextId as string | undefined)?.trim();
    if (!contextType || !contextId) {
      res.status(400).json({ error: 'contextType and contextId are required' });
      return;
    }
    const rows = await prisma.signatureBlob.findMany({
      where: { contextType, contextId },
      orderBy: { capturedAt: 'asc' },
    });
    res.status(200).json(rows);
  } catch (error) {
    console.error('[signature] list failed:', error);
    res.status(500).json({ error: 'Failed to list signatures' });
  }
};
