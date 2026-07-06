import type { Request, Response } from 'express';
import axios from 'axios';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.20 — Hospital emergency codes (Code Blue / Red / Pink / …).
//
// The 7 codes + dial number are FIXED from the printed poster. Activating a
// code records the event, alerts responders (in-app bell + best-effort SMS),
// and the UI shows a "Call 3111" tel: button + the announcement script.
// Code Blue + Yellow can also be auto-SUGGESTED from clinical data.

export interface EmergencyCodeDef {
  code: string;
  label: string;
  situation: string;
  number: string;
  extra?: string;
}

export const EMERGENCY_CODES: EmergencyCodeDef[] = [
  { code: 'red', label: 'Code Red', situation: 'Fire', number: '3111' },
  { code: 'blue', label: 'Code Blue', situation: 'Cardiac arrest / Medical emergency', number: '3111' },
  { code: 'pink', label: 'Code Pink', situation: 'Child abduction', number: '3111' },
  { code: 'violet', label: 'Code Violet', situation: 'Violence', number: '3111' },
  { code: 'yellow', label: 'Code Yellow', situation: 'Mass casualty', number: '3111' },
  { code: 'orange', label: 'Code Orange', situation: 'Hazardous spillages', number: '3111' },
  { code: 'black', label: 'Code Black', situation: 'Bomb threat', number: '3111', extra: 'Also inform Medical Director / Safety / Security Officer' },
];

const codeDef = (code: string): EmergencyCodeDef | undefined =>
  EMERGENCY_CODES.find((c) => c.code === code);

const announcement = (def: EmergencyCodeDef, location: string): string =>
  `Dial ${def.number} from the intercom and announce "${def.label}, ${location}" three times.`;

// Best-effort SMS to a configured responder list. The gateway is DLT-bound,
// so this only fires when both a template id and recipient numbers are set in
// the environment; otherwise it silently no-ops (the bell alert still fires).
const notifyRespondersBySms = async (text: string): Promise<void> => {
  const phones = (process.env.EMERGENCY_CODE_RESPONDER_PHONES ?? '')
    .split(',').map((p) => p.trim()).filter(Boolean);
  const templateId = process.env.SMS_DLT_TE_ID_FOR_EMERGENCY_CODE;
  const apiKey = process.env.SMS_API_KEY;
  const apiUrl = process.env.SMS_API_URL;
  const sender = process.env.SMS_SENDER;
  if (!phones.length || !templateId || !apiKey || !apiUrl || !sender) return; // not configured

  await Promise.all(phones.map(async (phone) => {
    try {
      const url = `${apiUrl}/${sender}/${phone}/${encodeURIComponent(text)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${templateId}`;
      await axios.get(url);
    } catch (e) {
      console.warn('[emergency-codes] responder SMS failed:', (e as Error).message);
    }
  }));
};

export const getCodes = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ data: EMERGENCY_CODES });
};

interface ActivateBody {
  code?: string;
  location?: string;
  admissionId?: string | null;
  emergencyId?: number | null;
  patientName?: string | null;
  note?: string | null;
  autoSuggested?: boolean;
}

export const activateCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as ActivateBody;
    const def = body.code ? codeDef(body.code) : undefined;
    if (!def) {
      res.status(400).json({ message: `code must be one of: ${EMERGENCY_CODES.map((c) => c.code).join(', ')}` });
      return;
    }
    const location = (body.location ?? '').trim();
    if (!location) { res.status(400).json({ message: 'location is required' }); return; }

    const activation = await prisma.codeActivation.create({
      data: {
        code: def.code,
        situation: def.situation,
        dialNumber: def.number,
        location,
        admissionId: body.admissionId ?? null,
        emergencyId: typeof body.emergencyId === 'number' ? body.emergencyId : null,
        patientName: body.patientName?.trim() || null,
        note: body.note?.trim() || null,
        autoSuggested: !!body.autoSuggested,
        status: 'active',
        triggeredByName: req.user?.username ?? null,
        triggeredById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    const alertText = `${def.label.toUpperCase()} — ${def.situation} at ${location}. ${announcement(def, location)}`;

    // In-app bell — broadcast (no userId): emergency codes are hospital-wide.
    await prisma.notification.create({
      data: {
        type: 'emergency_code',
        title: `${def.label} activated`,
        message: alertText,
        status: 'unread',
        isCritical: true,
        entityId: activation.id,
        entityType: 'CodeActivation',
      },
    }).catch((e) => console.warn('[emergency-codes] bell failed:', (e as Error).message));

    // Best-effort SMS (gated on env config).
    await notifyRespondersBySms(alertText);

    await auditLog(req, {
      module: 'emergency-codes', action: 'CREATE', entityType: 'CodeActivation',
      entityId: activation.id, payload: { code: def.code, location },
    });

    res.status(201).json({
      data: activation,
      dial: { number: def.number, script: announcement(def, location), extra: def.extra ?? null },
    });
  } catch (error) {
    console.error('[emergency-codes] activate failed:', error);
    res.status(500).json({ message: 'Failed to activate code' });
  }
};

export const listActivations = async (req: Request, res: Response): Promise<void> => {
  try {
    const all = req.query.all === 'true';
    const rows = await prisma.codeActivation.findMany({
      where: all ? undefined : { status: 'active' },
      orderBy: { triggeredAt: 'desc' },
      take: all ? 100 : undefined,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[emergency-codes] list failed:', error);
    res.status(500).json({ message: 'Failed to load code activations' });
  }
};

// Phase 9.26 / Phase 5i — mark team arrival on a Code Blue (powers PSQ-014).
// Separate endpoint from resolve so the two timestamps stay distinct: arrival
// is when the responding team reaches the patient; resolve is when the
// situation is closed (could be hours later).
export const markAttended = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.codeActivation.findUnique({
      where: { id }, select: { id: true, attendedAt: true },
    });
    if (!existing) { res.status(404).json({ message: 'Activation not found' }); return; }
    if (existing.attendedAt) { res.status(409).json({ message: 'Already marked attended' }); return; }

    const row = await prisma.codeActivation.update({
      where: { id },
      data: {
        attendedAt: new Date(),
        attendedByName: req.user?.username ?? null,
        attendedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, { module: 'emergency-codes', action: 'ATTEND', entityType: 'CodeActivation', entityId: id, payload: { attendedAt: row.attendedAt } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[emergency-codes] markAttended failed:', error);
    res.status(500).json({ message: 'Failed to mark attended' });
  }
};

export const resolveActivation = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.codeActivation.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) { res.status(404).json({ message: 'Activation not found' }); return; }
    if (existing.status === 'resolved') { res.status(409).json({ message: 'Already resolved' }); return; }

    const row = await prisma.codeActivation.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedByName: req.user?.username ?? null,
        resolvedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, { module: 'emergency-codes', action: 'UPDATE', entityType: 'CodeActivation', entityId: id, payload: { status: 'resolved' } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[emergency-codes] resolve failed:', error);
    res.status(500).json({ message: 'Failed to resolve activation' });
  }
};

interface CodeSuggestion {
  code: string;
  label: string;
  situation: string;
  location: string;
  reason: string;
  admissionId?: string;
  patientName?: string;
}

// Code Blue (critical NEWS2) + Code Yellow (ER red-triage surge).
const YELLOW_SURGE_THRESHOLD = 5;

export const getSuggestions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const suggestions: CodeSuggestion[] = [];

    // ── Code Blue — patients with a recent high NEWS2 band ──
    const since = new Date(Date.now() - 2 * 3600_000);
    const snaps = await prisma.patientAcuitySnapshot.findMany({
      where: { ewsBand: 'high', computedAt: { gte: since } },
      orderBy: { computedAt: 'desc' },
      include: {
        admission: {
          select: {
            id: true, prn: true, status: true, icuDischargedAt: true,
            ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
          },
        },
      },
    });
    const seen = new Set<string>();
    const blueAdmissions: { admissionId: string; prn: string | null; location: string; score: number }[] = [];
    for (const s of snaps) {
      if (seen.has(s.admissionId)) continue; // keep only the latest per admission
      seen.add(s.admissionId);
      const adm = s.admission;
      if (!adm || adm.status === 'discharged' || adm.status === 'expired') continue;
      const loc = [adm.ward?.wardName, adm.bed?.bedNumber].filter(Boolean).join(' / ') || 'IPD';
      blueAdmissions.push({ admissionId: adm.id, prn: adm.prn ?? null, location: loc, score: s.ewsScore });
    }
    // Resolve patient names (PatientDetails.prn is Int).
    const prnInts = blueAdmissions.map((b) => Number(b.prn)).filter((n) => Number.isFinite(n));
    const patients = prnInts.length
      ? await prisma.patientDetails.findMany({ where: { prn: { in: prnInts } }, select: { prn: true, name: true } })
      : [];
    const nameByPrn = new Map(patients.map((p) => [String(p.prn), p.name]));
    const blueDef = codeDef('blue')!;
    for (const b of blueAdmissions) {
      suggestions.push({
        code: 'blue', label: blueDef.label, situation: blueDef.situation,
        location: b.location, admissionId: b.admissionId,
        patientName: b.prn ? nameByPrn.get(b.prn) ?? undefined : undefined,
        reason: `Critical NEWS2 ${b.score} (high band)`,
      });
    }

    // ── Code Yellow — surge of red-triage ER cases in the last 6h ──
    const ersince = new Date(Date.now() - 6 * 3600_000);
    const redCount = await prisma.emergency.count({
      where: { triageCategory: 'red', status: { in: ['arrived', 'stabilized'] }, createdAt: { gte: ersince } },
    });
    if (redCount >= YELLOW_SURGE_THRESHOLD) {
      const yellowDef = codeDef('yellow')!;
      suggestions.push({
        code: 'yellow', label: yellowDef.label, situation: yellowDef.situation,
        location: 'Emergency Department',
        reason: `${redCount} red-triage ER cases in the last 6 hours`,
      });
    }

    res.status(200).json({ data: suggestions });
  } catch (error) {
    console.error('[emergency-codes] suggestions failed:', error);
    res.status(500).json({ message: 'Failed to compute suggestions' });
  }
};
