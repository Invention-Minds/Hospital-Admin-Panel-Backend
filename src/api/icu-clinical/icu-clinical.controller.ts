import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { computeAndStoreSnapshot } from '../treatment-dashboard/acuity-snapshot.service';

// Phase 9.6 — ICU clinical artefacts controller (NABH COP.3).
//
// All seven artefact types live in one controller file because they share
// the same shape: list-for-admission, create, update, delete. The split
// happens by table, not by file. Route file maps each table to its REST
// surface under /api/ipd/admission/:admissionId/icu/<artefact>.

function clamp<T>(v: T | null | undefined, fallback: T): T { return v ?? fallback; }
function trim<T>(v: string | null | undefined): string | null { return v?.trim() || null; }

async function assertAdmissionExists(admissionId: string): Promise<{ ok: boolean; msg?: string }> {
  const a = await prisma.ipdAdmission.findUnique({ where: { id: admissionId }, select: { id: true } });
  return a ? { ok: true } : { ok: false, msg: 'Admission not found' };
}

// ─── ICU Vitals (hourly + vent + ABG) ──────────────────────────────────

export const listIcuVitals = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const rows = await prisma.icuVitalsReading.findMany({
      where: { admissionId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-vitals] list failed:', error);
    res.status(500).json({ message: 'Failed to load ICU vitals' });
  }
};

export const addIcuVitals = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const exists = await assertAdmissionExists(admissionId);
    if (!exists.ok) { res.status(404).json({ message: exists.msg }); return; }
    const body = req.body as Record<string, unknown>;
    const row = await prisma.icuVitalsReading.create({
      data: {
        admissionId,
        recordedAt: body['recordedAt'] ? new Date(body['recordedAt'] as string) : new Date(),
        intervalMinutes: Number(body['intervalMinutes'] ?? 60),
        hr: body['hr'] as number | null, sbp: body['sbp'] as number | null,
        dbp: body['dbp'] as number | null, map: body['map'] as number | null,
        rr: body['rr'] as number | null, spo2: body['spo2'] as number | null,
        temp: body['temp'] as number | null, gcs: body['gcs'] as number | null,
        cvp: body['cvp'] as number | null,
        ventilatorMode: trim(body['ventilatorMode'] as string),
        fiO2: body['fiO2'] as number | null, peep: body['peep'] as number | null,
        pressureSupport: body['pressureSupport'] as number | null,
        tidalVolume: body['tidalVolume'] as number | null,
        respRateSet: body['respRateSet'] as number | null,
        abgPh: body['abgPh'] as number | null, abgPco2: body['abgPco2'] as number | null,
        abgPo2: body['abgPo2'] as number | null, abgHco3: body['abgHco3'] as number | null,
        abgBe: body['abgBe'] as number | null, abgLactate: body['abgLactate'] as number | null,
        inotropes: trim(body['inotropes'] as string),
        notes: trim(body['notes'] as string),
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    // Phase 9.13 — refresh NEWS2 acuity for the Treatment Dashboard.
    // Fire-and-forget so a scoring failure can't fail the vitals save.
    computeAndStoreSnapshot(admissionId).catch((e) =>
      console.warn('[icu-vitals] acuity snapshot failed:', (e as Error).message),
    );
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-vitals] add failed:', error);
    res.status(500).json({ message: 'Failed to record ICU vitals' });
  }
};

export const removeIcuVitals = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.icuVitalsReading.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    console.error('[icu-vitals] remove failed:', error);
    res.status(500).json({ message: 'Failed to remove ICU vitals row' });
  }
};

// ─── ICU Progress Note ─────────────────────────────────────────────────

export const listIcuProgressNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuProgressNote.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { noteDate: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-progress] list failed:', error);
    res.status(500).json({ message: 'Failed to load ICU progress notes' });
  }
};

export const addIcuProgressNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const adm = await prisma.ipdAdmission.findUnique({ where: { id: admissionId }, select: { id: true, icuAdmittedAt: true } });
    if (!adm) { res.status(404).json({ message: 'Admission not found' }); return; }
    const body = req.body as Record<string, unknown>;
    if (!body['subjective'] || !body['objective'] || !body['assessment'] || !body['plan']) {
      res.status(400).json({ message: 'SOAP fields are required' }); return;
    }
    const noteDate = body['noteDate'] ? new Date(body['noteDate'] as string) : new Date();
    // Derive ICU day from icuAdmittedAt (fall back to 1 if unknown)
    let icuDayNumber = 1;
    if (adm.icuAdmittedAt) {
      const ms = noteDate.getTime() - new Date(adm.icuAdmittedAt).getTime();
      icuDayNumber = Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)) + 1);
    }
    const row = await prisma.icuProgressNote.create({
      data: {
        admissionId, noteDate, icuDayNumber,
        doctorName: String(body['doctorName'] ?? 'Unknown'),
        doctorId: typeof body['doctorId'] === 'number' ? (body['doctorId'] as number) : null,
        subjective: String(body['subjective']),
        objective: String(body['objective']),
        assessment: String(body['assessment']),
        plan: String(body['plan']),
        sofaScore: body['sofaScore'] as number | null,
        apacheScore: body['apacheScore'] as number | null,
        gcsScore: body['gcsScore'] as number | null,
        trajectory: trim(body['trajectory'] as string),
        signatureId: trim(body['signatureId'] as string),
        signedAt: body['signatureId'] ? new Date() : null,
        signedBy: body['signatureId'] ? (req.user?.username ?? null) : null,
        createdBy: req.user?.username ?? null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-progress] add failed:', error);
    res.status(500).json({ message: 'Failed to add ICU progress note' });
  }
};

export const updateIcuProgressNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const row = await prisma.icuProgressNote.update({
      where: { id: req.params.id },
      data: {
        ...(body['subjective'] !== undefined && { subjective: String(body['subjective']) }),
        ...(body['objective'] !== undefined && { objective: String(body['objective']) }),
        ...(body['assessment'] !== undefined && { assessment: String(body['assessment']) }),
        ...(body['plan'] !== undefined && { plan: String(body['plan']) }),
        ...(body['sofaScore'] !== undefined && { sofaScore: body['sofaScore'] as number | null }),
        ...(body['apacheScore'] !== undefined && { apacheScore: body['apacheScore'] as number | null }),
        ...(body['gcsScore'] !== undefined && { gcsScore: body['gcsScore'] as number | null }),
        ...(body['trajectory'] !== undefined && { trajectory: trim(body['trajectory'] as string) }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-progress] update failed:', error);
    res.status(500).json({ message: 'Failed to update ICU progress note' });
  }
};

// ─── Sedation Log (RASS + CPOT) ────────────────────────────────────────

export const listSedationLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuSedationLog.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-sedation] list failed:', error);
    res.status(500).json({ message: 'Failed to load sedation logs' });
  }
};

export const addSedationLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const exists = await assertAdmissionExists(admissionId);
    if (!exists.ok) { res.status(404).json({ message: exists.msg }); return; }
    const body = req.body as Record<string, unknown>;
    if (body['rassScore'] !== undefined && body['rassScore'] !== null) {
      const r = Number(body['rassScore']);
      if (r < -5 || r > 4) { res.status(400).json({ message: 'rassScore must be -5..+4' }); return; }
    }
    if (body['cpotScore'] !== undefined && body['cpotScore'] !== null) {
      const c = Number(body['cpotScore']);
      if (c < 0 || c > 8) { res.status(400).json({ message: 'cpotScore must be 0..8' }); return; }
    }
    const row = await prisma.icuSedationLog.create({
      data: {
        admissionId,
        recordedAt: body['recordedAt'] ? new Date(body['recordedAt'] as string) : new Date(),
        shift: trim(body['shift'] as string),
        rassScore: body['rassScore'] as number | null,
        rassBehavior: trim(body['rassBehavior'] as string),
        cpotScore: body['cpotScore'] as number | null,
        cpotBehavior: trim(body['cpotBehavior'] as string),
        sedativeAgent: trim(body['sedativeAgent'] as string),
        sedativeRate: trim(body['sedativeRate'] as string),
        analgesicAgent: trim(body['analgesicAgent'] as string),
        analgesicRate: trim(body['analgesicRate'] as string),
        rassGoal: body['rassGoal'] as number | null,
        notes: trim(body['notes'] as string),
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-sedation] add failed:', error);
    res.status(500).json({ message: 'Failed to add sedation log' });
  }
};

// ─── Restraint Log (orders + 4h review) ────────────────────────────────

export const listRestraintLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuRestraintLog.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { orderedAt: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-restraint] list failed:', error);
    res.status(500).json({ message: 'Failed to load restraint logs' });
  }
};

export const addRestraintLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const exists = await assertAdmissionExists(admissionId);
    if (!exists.ok) { res.status(404).json({ message: exists.msg }); return; }
    const body = req.body as Record<string, unknown>;
    if (!body['restraintType'] || !body['reason'] || !body['orderedBy']) {
      res.status(400).json({ message: 'restraintType, reason and orderedBy are required' });
      return;
    }
    const row = await prisma.icuRestraintLog.create({
      data: {
        admissionId,
        orderedAt: body['orderedAt'] ? new Date(body['orderedAt'] as string) : new Date(),
        orderedBy: String(body['orderedBy']),
        orderedById: typeof body['orderedById'] === 'number' ? (body['orderedById'] as number) : null,
        reason: String(body['reason']),
        restraintType: String(body['restraintType']),
        bodyPart: trim(body['bodyPart'] as string),
        reviewLog: trim(body['reviewLog'] as string),
      },
    });
    await auditLog(req, { module: 'icu', action: 'CREATE', entityType: 'IcuRestraintLog', entityId: row.id, payload: { admissionId, type: row.restraintType } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-restraint] add failed:', error);
    res.status(500).json({ message: 'Failed to add restraint log' });
  }
};

export const appendRestraintReview = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.icuRestraintLog.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Restraint log not found' }); return; }
    if (existing.discontinuedAt) { res.status(409).json({ message: 'Restraint already discontinued' }); return; }
    const body = req.body as { status?: 'continue' | 'discontinue'; notes?: string };
    const reviewedBy = req.user?.username ?? 'Unknown';
    const log = existing.reviewLog ? (JSON.parse(existing.reviewLog) as unknown[]) : [];
    log.push({ reviewedAt: new Date().toISOString(), reviewedBy, status: body.status ?? 'continue', notes: body.notes ?? '' });
    const row = await prisma.icuRestraintLog.update({
      where: { id },
      data: {
        reviewLog: JSON.stringify(log),
        ...(body.status === 'discontinue' && {
          discontinuedAt: new Date(),
          discontinuedBy: reviewedBy,
          discontinuedReason: body.notes ?? null,
        }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-restraint] append review failed:', error);
    res.status(500).json({ message: 'Failed to append restraint review' });
  }
};

// ─── Bundle Compliance Log ─────────────────────────────────────────────

export const listBundleLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuBundleLog.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { chartDate: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-bundle] list failed:', error);
    res.status(500).json({ message: 'Failed to load bundle logs' });
  }
};

export const upsertBundleLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const exists = await assertAdmissionExists(admissionId);
    if (!exists.ok) { res.status(404).json({ message: exists.msg }); return; }
    const body = req.body as Record<string, unknown>;
    const chartDate = body['chartDate'] ? new Date(body['chartDate'] as string) : new Date();
    chartDate.setHours(0, 0, 0, 0);
    const row = await prisma.icuBundleLog.upsert({
      where: { admissionId_chartDate: { admissionId, chartDate } },
      update: {
        ...(body['vapStatus'] !== undefined && { vapStatus: trim(body['vapStatus'] as string), vapNotes: trim(body['vapNotes'] as string) }),
        ...(body['clabsiStatus'] !== undefined && { clabsiStatus: trim(body['clabsiStatus'] as string), clabsiNotes: trim(body['clabsiNotes'] as string) }),
        ...(body['cautiStatus'] !== undefined && { cautiStatus: trim(body['cautiStatus'] as string), cautiNotes: trim(body['cautiNotes'] as string) }),
        ...(body['pressureUlcerStatus'] !== undefined && { pressureUlcerStatus: trim(body['pressureUlcerStatus'] as string), pressureUlcerNotes: trim(body['pressureUlcerNotes'] as string) }),
        ...(body['dvtStatus'] !== undefined && { dvtStatus: trim(body['dvtStatus'] as string), dvtNotes: trim(body['dvtNotes'] as string) }),
        ...(body['glycemicControlStatus'] !== undefined && { glycemicControlStatus: trim(body['glycemicControlStatus'] as string), glycemicControlNotes: trim(body['glycemicControlNotes'] as string) }),
      },
      create: {
        admissionId, chartDate,
        vapStatus: trim(body['vapStatus'] as string), vapNotes: trim(body['vapNotes'] as string),
        clabsiStatus: trim(body['clabsiStatus'] as string), clabsiNotes: trim(body['clabsiNotes'] as string),
        cautiStatus: trim(body['cautiStatus'] as string), cautiNotes: trim(body['cautiNotes'] as string),
        pressureUlcerStatus: trim(body['pressureUlcerStatus'] as string), pressureUlcerNotes: trim(body['pressureUlcerNotes'] as string),
        dvtStatus: trim(body['dvtStatus'] as string), dvtNotes: trim(body['dvtNotes'] as string),
        glycemicControlStatus: trim(body['glycemicControlStatus'] as string), glycemicControlNotes: trim(body['glycemicControlNotes'] as string),
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-bundle] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save bundle log' });
  }
};

// ─── Family Communication Log ──────────────────────────────────────────

export const listFamilyComms = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuFamilyCommunication.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { communicationAt: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-familycomm] list failed:', error);
    res.status(500).json({ message: 'Failed to load family communications' });
  }
};

export const addFamilyComm = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const exists = await assertAdmissionExists(admissionId);
    if (!exists.ok) { res.status(404).json({ message: exists.msg }); return; }
    const body = req.body as Record<string, unknown>;
    if (!body['category'] || !body['participantName'] || !body['participantRelation'] || !body['topicsDiscussed']) {
      res.status(400).json({ message: 'category, participantName, participantRelation and topicsDiscussed are required' });
      return;
    }
    const row = await prisma.icuFamilyCommunication.create({
      data: {
        admissionId,
        communicationAt: body['communicationAt'] ? new Date(body['communicationAt'] as string) : new Date(),
        category: String(body['category']),
        participantName: String(body['participantName']),
        participantRelation: String(body['participantRelation']),
        participantPhone: trim(body['participantPhone'] as string),
        topicsDiscussed: String(body['topicsDiscussed']),
        decisionsReached: trim(body['decisionsReached'] as string),
        secondOpinionRequested: clamp(body['secondOpinionRequested'] as boolean, false),
        multiPartyMeeting: clamp(body['multiPartyMeeting'] as boolean, false),
        documentedBy: req.user?.username ?? 'Unknown',
        documentedById: typeof req.user?.id === 'number' ? req.user.id : null,
        signatureId: trim(body['signatureId'] as string),
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-familycomm] add failed:', error);
    res.status(500).json({ message: 'Failed to add family communication' });
  }
};

// ─── Step-Down Request (ICU → ward back-transfer) ──────────────────────

export const listStepDowns = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.icuStepDownRequest.findMany({
      where: { admissionId: req.params.admissionId },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[icu-stepdown] list failed:', error);
    res.status(500).json({ message: 'Failed to load step-down requests' });
  }
};

export const proposeStepDown = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const adm = await prisma.ipdAdmission.findUnique({ where: { id: admissionId } });
    if (!adm) { res.status(404).json({ message: 'Admission not found' }); return; }
    if (!adm.icuAdmittedAt) {
      res.status(409).json({ message: 'Patient is not currently in ICU — cannot raise step-down request' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (!body['rationale']) { res.status(400).json({ message: 'rationale is required' }); return; }
    const row = await prisma.icuStepDownRequest.create({
      data: {
        admissionId,
        status: 'PROPOSED',
        fromWardId: adm.wardId,
        fromBedId: adm.bedId,
        rationale: String(body['rationale']),
        stepDownCriteriaMet: clamp(body['stepDownCriteriaMet'] as boolean, false),
        ongoingMeds: trim(body['ongoingMeds'] as string),
        carryForwardOrders: trim(body['carryForwardOrders'] as string),
        codeStatus: trim(body['codeStatus'] as string),
        proposedBy: req.user?.username ?? 'Unknown',
        proposedById: typeof req.user?.id === 'number' ? req.user.id : null,
        proposerSignatureId: trim(body['proposerSignatureId'] as string),
      },
    });
    await auditLog(req, { module: 'icu', action: 'CREATE', entityType: 'IcuStepDownRequest', entityId: row.id, payload: { admissionId } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[icu-stepdown] propose failed:', error);
    res.status(500).json({ message: 'Failed to propose step-down' });
  }
};

export const acknowledgeStepDown = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as { signatureId?: string; declineReason?: string; accept: boolean };
    const existing = await prisma.icuStepDownRequest.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Step-down request not found' }); return; }
    if (existing.status !== 'PROPOSED') {
      res.status(409).json({ message: `Cannot acknowledge from status ${existing.status}` });
      return;
    }
    const row = await prisma.icuStepDownRequest.update({
      where: { id },
      data: body.accept
        ? {
            status: 'ACKNOWLEDGED',
            intensivistSignedAt: new Date(),
            intensivistSignedBy: req.user?.username ?? 'Unknown',
            intensivistSignatureId: trim(body.signatureId ?? null),
          }
        : {
            status: 'DECLINED',
            intensivistDeclineReason: body.declineReason ?? 'No reason given',
          },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-stepdown] acknowledge failed:', error);
    res.status(500).json({ message: 'Failed to acknowledge step-down' });
  }
};

export const acceptStepDown = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as { toWardId: string; toBedId: string; signatureId?: string; receivingNurseName?: string };
    if (!body.toWardId || !body.toBedId) {
      res.status(400).json({ message: 'toWardId and toBedId are required' }); return;
    }
    const existing = await prisma.icuStepDownRequest.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Step-down request not found' }); return; }
    if (existing.status !== 'ACKNOWLEDGED') {
      res.status(409).json({ message: `Cannot accept from status ${existing.status}` });
      return;
    }
    const row = await prisma.icuStepDownRequest.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        toWardId: body.toWardId,
        toBedId: body.toBedId,
        receivingNurseAcceptedAt: new Date(),
        receivingNurseName: body.receivingNurseName ?? req.user?.username ?? null,
        receivingNurseSignatureId: trim(body.signatureId ?? null),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-stepdown] accept failed:', error);
    res.status(500).json({ message: 'Failed to accept step-down' });
  }
};

export const completeStepDown = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as { handoverSignatureId?: string };
    const existing = await prisma.icuStepDownRequest.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Step-down request not found' }); return; }
    if (existing.status !== 'ACCEPTED' && existing.status !== 'IN_TRANSIT') {
      res.status(409).json({ message: `Cannot complete from status ${existing.status}` });
      return;
    }
    if (!existing.toWardId || !existing.toBedId) {
      res.status(400).json({ message: 'Target ward/bed not set' }); return;
    }
    const now = new Date();
    // Transaction: flip admission ward/bed, free ICU bed, occupy target bed,
    // mark step-down COMPLETED, set icuDischargedAt + clear icuAdmittedAt.
    const [row] = await prisma.$transaction([
      prisma.icuStepDownRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          completedBy: req.user?.username ?? null,
          handoverSignatureId: trim(body.handoverSignatureId ?? null),
        },
      }),
      prisma.ipdAdmission.update({
        where: { id: existing.admissionId },
        data: {
          wardId: existing.toWardId,
          bedId: existing.toBedId,
          icuDischargedAt: now,
          priorIcuDischargeAt: now, // for 30-day readmission flagging
          icuAdmittedAt: null,
        },
      }),
      ...(existing.fromBedId
        ? [prisma.ipdBed.update({ where: { id: existing.fromBedId }, data: { status: 'available' } })]
        : []),
      prisma.ipdBed.update({ where: { id: existing.toBedId }, data: { status: 'occupied' } }),
    ]);
    await auditLog(req, { module: 'icu', action: 'UPDATE', entityType: 'IcuStepDownRequest', entityId: id, payload: { action: 'completed' } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[icu-stepdown] complete failed:', error);
    res.status(500).json({ message: 'Failed to complete step-down' });
  }
};

// ─── Aggregator — single GET for the ICU Workbench page ────────────────

export const getIcuWorkbench = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const adm = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: {
        id: true, admissionNo: true, prn: true, admissionDate: true, admissionTime: true,
        admittingDoctor: true, department: true, diagnosis: true, status: true,
        wardId: true, bedId: true, roomType: true,
        icuAdmittedAt: true, icuDischargedAt: true, priorIcuDischargeAt: true,
      },
    });
    if (!adm) { res.status(404).json({ message: 'Admission not found' }); return; }

    const [vitals, progressNotes, sedations, restraints, bundles, familyComms, stepDowns] = await Promise.all([
      prisma.icuVitalsReading.findMany({ where: { admissionId }, orderBy: { recordedAt: 'desc' }, take: 50 }),
      prisma.icuProgressNote.findMany({ where: { admissionId }, orderBy: { noteDate: 'desc' } }),
      prisma.icuSedationLog.findMany({ where: { admissionId }, orderBy: { recordedAt: 'desc' }, take: 50 }),
      prisma.icuRestraintLog.findMany({ where: { admissionId }, orderBy: { orderedAt: 'desc' } }),
      prisma.icuBundleLog.findMany({ where: { admissionId }, orderBy: { chartDate: 'desc' }, take: 30 }),
      prisma.icuFamilyCommunication.findMany({ where: { admissionId }, orderBy: { communicationAt: 'desc' } }),
      prisma.icuStepDownRequest.findMany({ where: { admissionId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const icuDayNumber = adm.icuAdmittedAt
      ? Math.floor((Date.now() - new Date(adm.icuAdmittedAt).getTime()) / (24 * 60 * 60 * 1000)) + 1
      : null;

    const readmittedWithin30Days = adm.priorIcuDischargeAt && adm.icuAdmittedAt
      ? (new Date(adm.icuAdmittedAt).getTime() - new Date(adm.priorIcuDischargeAt).getTime()) <= 30 * 24 * 60 * 60 * 1000
      : false;

    res.status(200).json({
      data: {
        admission: adm,
        icuDayNumber,
        readmittedWithin30Days,
        vitals, progressNotes, sedations, restraints, bundles, familyComms, stepDowns,
      },
    });
  } catch (error) {
    console.error('[icu-workbench] failed:', error);
    res.status(500).json({ message: 'Failed to load ICU workbench' });
  }
};
