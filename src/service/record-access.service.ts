import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import prisma from './prisma-client';

// Patient record access over WhatsApp.
//
// Security model:
//  - Record PDFs are written to a PRIVATE directory that is NOT served by the
//    public /files static mount. They are reachable only via /p/:token.
//  - Tokens are random, tied to a PRN, and expire (default 24h).
//  - Every list/send/view is written to PatientRecordAccessLog.

export const PRIVATE_DIR = process.env.PRIVATE_STORAGE_DIR || '/var/www/docminds/private';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const LINK_TTL_HOURS = Number(process.env.RECORD_LINK_TTL_HOURS) || 24;

export interface PrivateFile {
  filePath: string;
  fileName: string;
}

/** Write a PDF (or any buffer) into private storage — never public. */
export function savePrivateFile(buffer: Buffer, fileName: string): PrivateFile {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });
  const safe = path.basename(fileName).replace(/[^A-Za-z0-9._-]+/g, '_');
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`;
  const filePath = path.join(PRIVATE_DIR, unique);
  fs.writeFileSync(filePath, buffer);
  return { filePath, fileName: safe };
}

/** Mint an expiring, PRN-scoped link to a private file. Returns the full URL. */
export async function createSecureLink(input: {
  prn: number;
  kind: string;
  refId?: string | null;
  filePath: string;
  fileName: string;
  mimeType?: string;
  ttlHours?: number;
}): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? LINK_TTL_HOURS) * 60 * 60 * 1000);
  await prisma.secureLink.create({
    data: {
      token,
      prn: input.prn,
      kind: input.kind,
      refId: input.refId ?? null,
      filePath: input.filePath,
      fileName: input.fileName,
      mimeType: input.mimeType ?? 'application/pdf',
      expiresAt,
    },
  });
  const url = `${PUBLIC_BASE_URL}/p/${token}`;
  return { token, url, expiresAt };
}

/** Resolve a token if it exists and hasn't expired. */
export async function resolveSecureLink(token: string) {
  const row = await prisma.secureLink.findUnique({ where: { token } });
  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  return row;
}

/** Audit trail — every record interaction. Never throws. */
export async function logRecordAccess(input: {
  prn: number;
  phone: string;
  itemType: string;
  itemRef?: string | null;
  action: 'listed' | 'sent' | 'viewed' | 'denied';
  channel?: string;
}): Promise<void> {
  await prisma.patientRecordAccessLog
    .create({
      data: {
        prn: input.prn,
        phone: input.phone,
        itemType: input.itemType,
        itemRef: input.itemRef ?? null,
        action: input.action,
        channel: input.channel ?? 'whatsapp',
      },
    })
    .catch((e) => console.warn('[record-access] audit failed:', (e as Error).message));
}

/** Last 10 digits — normalizes 91…, +91…, 0…, and bare 10-digit numbers. */
export const last10 = (s?: string | null): string => (s ?? '').replace(/\D/g, '').slice(-10);

/**
 * The mobile registered against this PRN. Identity is proved by receiving an
 * OTP on THIS number (over SMS), not by which WhatsApp number is chatting — so
 * a patient can use a relative's WhatsApp, and the registered phone doesn't
 * need WhatsApp at all. Returns null when nothing is on file (→ cannot verify).
 */
export async function getRegisteredNumber(prn: number): Promise<string | null> {
  const pd = await prisma.patientDetails.findUnique({ where: { prn }, select: { mobileNo: true, contactNo: true } });
  const p = await prisma.patient.findUnique({ where: { prn }, select: { phoneNumber: true } }).catch(() => null);
  const candidates = [pd?.mobileNo, pd?.contactNo, p?.phoneNumber];
  const valid = candidates.find((c) => last10(c).length === 10);
  return valid ?? null;
}

/** Show only the last 4 digits — never echo a full number to an unverified chat. */
export const maskNumber = (n: string): string => `xxxxxx${last10(n).slice(-4)}`;

/** True when the WhatsApp sender is itself the registered number (for auditing). */
export async function phoneMatchesPrn(from: string, prn: number): Promise<boolean> {
  const reg = await getRegisteredNumber(prn);
  return !!reg && last10(reg) === last10(from) && last10(from).length === 10;
}
