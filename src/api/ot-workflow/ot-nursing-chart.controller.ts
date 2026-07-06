import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * OT Intra-Operative Nursing Chart controller (Phase 4b).
 *
 * One row per OtSchedule. Captured by the scrub/floor nurses during a
 * procedure. Complements OtIntraOpNote (doctor narrative) and
 * OtSafetyChecklist (WHO sign-in / time-out / sign-out) without
 * duplicating fields. Mirrors the printed UHJ/OTS/F-02 form.
 *
 * Sign chain: scrub nurse → floor nurse → OT in-charge. Each sign
 * transitions the status. Once OT in-charge has signed the row is
 * read-only.
 */

const VALID_TRANSFER_MODES = ['bed', 'stretcher', 'wheelchair'];
const VALID_ANAESTHESIA = ['GA', 'SA', 'EA', 'REGIONAL', 'BLOCK_MAC', 'LOCAL'];
const VALID_POSITIONS = ['supine', 'prone', 'lithotomy', 'left-lateral', 'right-lateral', 'others'];
const VALID_TRINARY = ['YES', 'NO', 'NA'];
const VALID_BINARY = ['YES', 'NA'];
const VALID_END_CONDITIONS = ['stable', 'fair', 'critical'];
const VALID_DRESSING_TYPES = ['compression', 'simple', 'immobilizer', 'pop-cast'];
const VALID_SHIFTED_TO = ['recovery', 'icu', 'ward', 'others'];

interface UpsertBody {
  wheelInAt?: string | null;
  wheelOutAt?: string | null;
  modeOfTransfer?: string | null;
  anaesthesia?: string | null;
  position?: string | null;
  positionNotes?: string | null;

  pressureProtections?: string | null;

  warmerPlaced?: string | null;
  dvtPumpApplied?: string | null;
  electricCautery?: string | null;
  cauteryPadLocation?: string | null;

  tourniquet?: string | null;
  catheters?: string | null;
  instrumentsCount?: string | null;

  // Swab counts — flat fields per type
  swabRoMopInitial?: number | null;
  swabRoMopAdditional?: number | null;
  swabRoMopFinal?: number | null;
  swabRoGauzeInitial?: number | null;
  swabRoGauzeAdditional?: number | null;
  swabRoGauzeFinal?: number | null;
  swabPlainGauzeInitial?: number | null;
  swabPlainGauzeAdditional?: number | null;
  swabPlainGauzeFinal?: number | null;
  swabThroatPackInitial?: number | null;
  swabThroatPackAdditional?: number | null;
  swabThroatPackFinal?: number | null;
  swabPattiesInitial?: number | null;
  swabPattiesAdditional?: number | null;
  swabPattiesFinal?: number | null;
  swabPeanutsInitial?: number | null;
  swabPeanutsAdditional?: number | null;
  swabPeanutsFinal?: number | null;
  swabRibbonPacksInitial?: number | null;
  swabRibbonPacksAdditional?: number | null;
  swabRibbonPacksFinal?: number | null;
  swabsCountTallied?: boolean;

  specimensCulture?: string | null;
  specimensHistopathology?: string | null;
  specimensOther?: string | null;
  specimenHandedOverBy?: string | null;
  specimenHandedOverAt?: string | null;
  specimenReceivedBy?: string | null;
  specimenReceivedAt?: string | null;

  conditionAtEnd?: string | null;
  dressingType?: string | null;
  dressingNotes?: string | null;
  patientShiftedTo?: string | null;
  patientShiftedToOther?: string | null;
}

// ─── Read ────────────────────────────────────────────────────────────

export const getForSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const row = await prisma.otIntraOpNursingChart.findUnique({ where: { scheduleId } });
    res.status(200).json(row);
  } catch (error) {
    console.error('[ot-nursing-chart] getForSchedule failed:', error);
    res.status(500).json({ error: 'Failed to load intra-op nursing chart' });
  }
};

// ─── Upsert ─────────────────────────────────────────────────────────

export const upsertForSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    const body = req.body as UpsertBody;

    const schedule = await prisma.otSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) { res.status(404).json({ error: 'OT schedule not found' }); return; }

    const existing = await prisma.otIntraOpNursingChart.findUnique({ where: { scheduleId } });
    if (existing?.status === 'SIGNED_INCHARGE') {
      res.status(409).json({ error: 'Chart is OT-incharge-signed and read-only' });
      return;
    }

    // Enum-style validations — silently accept null, reject other invalid.
    const ensure = (val: string | null | undefined, allowed: string[], name: string): string | null => {
      if (val == null || val === '') return null;
      if (!allowed.includes(val)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
      return val;
    };

    const data: Record<string, unknown> = {};
    // Iterate fields, validate enums, parse timestamps, skip undefined.
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (key === 'modeOfTransfer') data[key] = ensure(value as string, VALID_TRANSFER_MODES, key);
      else if (key === 'anaesthesia') data[key] = ensure(value as string, VALID_ANAESTHESIA, key);
      else if (key === 'position') data[key] = ensure(value as string, VALID_POSITIONS, key);
      else if (key === 'warmerPlaced' || key === 'dvtPumpApplied') data[key] = ensure(value as string, VALID_TRINARY, key);
      else if (key === 'electricCautery') data[key] = ensure(value as string, VALID_BINARY, key);
      else if (key === 'conditionAtEnd') data[key] = ensure(value as string, VALID_END_CONDITIONS, key);
      else if (key === 'dressingType') data[key] = ensure(value as string, VALID_DRESSING_TYPES, key);
      else if (key === 'patientShiftedTo') data[key] = ensure(value as string, VALID_SHIFTED_TO, key);
      else if (['wheelInAt', 'wheelOutAt', 'specimenHandedOverAt', 'specimenReceivedAt'].includes(key)) {
        data[key] = value ? new Date(value as string) : null;
      } else {
        data[key] = value;
      }
    }

    const row = await prisma.otIntraOpNursingChart.upsert({
      where: { scheduleId },
      update: {
        ...data,
        updatedBy: req.user?.username ?? null,
        updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
      create: {
        scheduleId,
        ...data,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(existing ? 200 : 201).json(row);
  } catch (error) {
    console.error('[ot-nursing-chart] upsertForSchedule failed:', error);
    res.status(500).json({
      error: 'Failed to save intra-op nursing chart',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Sign chain ─────────────────────────────────────────────────────

type SignerRole = 'scrub' | 'floor' | 'incharge';

interface SignBody {
  signatureId: string;
  nurseName?: string;
}

/** Generic sign endpoint. The :role path param decides which nurse slot is
 *  being stamped. Status transitions: DRAFT → SIGNED_SCRUB → SIGNED_FLOOR
 *  → SIGNED_INCHARGE. */
export const signRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scheduleId } = req.params;
    const role = req.params.role as SignerRole;
    const body = req.body as SignBody;
    if (!body.signatureId) {
      res.status(400).json({ error: 'signatureId is required' });
      return;
    }
    if (!['scrub', 'floor', 'incharge'].includes(role)) {
      res.status(400).json({ error: 'role must be scrub, floor or incharge' });
      return;
    }

    const existing = await prisma.otIntraOpNursingChart.findUnique({ where: { scheduleId } });
    if (!existing) {
      res.status(404).json({ error: 'Chart not found — save it first' });
      return;
    }
    if (existing.status === 'SIGNED_INCHARGE') {
      res.status(409).json({ error: 'Already finalised by OT in-charge' });
      return;
    }

    // Sign-chain order: scrub → floor → incharge. The role being signed
    // must match the next expected step.
    const order: Array<{ role: SignerRole; expected: string; next: string; idCol: string; nameCol: string; sigCol: string; atCol: string }> = [
      { role: 'scrub', expected: 'DRAFT', next: 'SIGNED_SCRUB',
        idCol: 'scrubNurseId', nameCol: 'scrubNurseName', sigCol: 'scrubNurseSignatureId', atCol: 'scrubNurseSignedAt' },
      { role: 'floor', expected: 'SIGNED_SCRUB', next: 'SIGNED_FLOOR',
        idCol: 'floorNurseId', nameCol: 'floorNurseName', sigCol: 'floorNurseSignatureId', atCol: 'floorNurseSignedAt' },
      { role: 'incharge', expected: 'SIGNED_FLOOR', next: 'SIGNED_INCHARGE',
        idCol: 'otInchargeId', nameCol: 'otInchargeName', sigCol: 'otInchargeSignatureId', atCol: 'otInchargeSignedAt' },
    ];
    const step = order.find((s) => s.role === role);
    if (!step) { res.status(400).json({ error: 'Invalid role' }); return; }
    if (existing.status !== step.expected) {
      res.status(409).json({ error: `Out-of-order sign. Current status: ${existing.status}, need ${step.expected}` });
      return;
    }

    const now = new Date();
    const nurseName = body.nurseName ?? req.user?.username ?? null;
    const updated = await prisma.otIntraOpNursingChart.update({
      where: { scheduleId },
      data: {
        [step.idCol]: typeof req.user?.id === 'number' ? req.user.id : null,
        [step.nameCol]: nurseName,
        [step.sigCol]: body.signatureId,
        [step.atCol]: now,
        status: step.next,
      },
    });
    await auditLog(req, {
      module: 'ot',
      action: 'STATUS_CHANGE',
      entityType: 'OtIntraOpNursingChart',
      entityId: updated.id,
      payload: { from: existing.status, to: step.next, role },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error('[ot-nursing-chart] signRole failed:', error);
    res.status(500).json({ error: 'Failed to sign nursing chart' });
  }
};
