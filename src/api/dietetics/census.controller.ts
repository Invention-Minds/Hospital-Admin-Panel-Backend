import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { resolveWardScope } from '../_shared/nursing-roles';
import { syncOrdersQuietly } from './meal-order.cron';
import { loadPatientContext, loadCurrentPlans, remarkText } from './patient-context';

/**
 * Nursing daily census → Dietary (the hospital's "early morning nurses census").
 *
 * Closed loop:  nurse SUBMITS (signed)  →  Dietary RECEIVES  →  Dietary ACKNOWLEDGES
 *
 * On acknowledge, what the nurse relayed takes effect in the kitchen:
 *   • NPO lines   → MealHold (source CENSUS) from the nurse's NPO time
 *   • New patients with a diet picked from the master and no diet yet
 *     → INTERIM plan (source CENSUS) so they are never left without a tray —
 *       or served the previous patient's diet — until the dietitian assesses.
 * Every line's admission is then re-synced to the kitchen.
 */

interface CensusLineBody {
  admissionId: string;
  dietText?: string | null;
  dietMasterId?: string | null;
  npo?: boolean;
  npoFrom?: string | null;
  feedText?: string | null;
  disposablePlate?: boolean;
  remarks?: string | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayStart = (s?: string): Date => {
  const d = s ? new Date(`${s}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return dayStart();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * A genuinely new admission for this ward's census: not on the ward's last
 * census — or, for the ward's first census, admitted in the last 24 h.
 * (Not "has no diet plan" — unassessed patients are a dietitian matter.)
 */
function isNewAdmission(admissionDate: Date, lastIds: Set<string> | null, admissionId: string): boolean {
  if (lastIds) return !lastIds.has(admissionId);
  return Date.now() - admissionDate.getTime() < 24 * 60 * 60 * 1000;
}

/** Wards the caller may submit a census for (scoped nurses → their wards). */
async function allowedWards(userId: number | undefined): Promise<Array<{ id: string; wardName: string }>> {
  const scope = await resolveWardScope(userId);
  return prisma.ipdWard.findMany({
    where: scope.unrestricted ? {} : { id: { in: scope.wardIds } },
    select: { id: true, wardName: true },
    orderBy: { wardName: 'asc' },
  });
}

export const listCensusWards = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(await allowedWards(req.user?.id));
  } catch (error) {
    console.error('[dietetics] listCensusWards failed:', error);
    res.status(500).json({ error: 'Failed to list wards' });
  }
};

/** GET /census/prefill?wardId= — the census pre-filled from the IP list + current diets. */
export const getCensusPrefill = async (req: Request, res: Response): Promise<void> => {
  try {
    const wardId = req.query.wardId as string;
    if (!wardId) { res.status(400).json({ error: 'wardId is required' }); return; }
    const wards = await allowedWards(req.user?.id);
    if (!wards.some((w) => w.id === wardId)) {
      res.status(403).json({ error: 'You are not assigned to this ward' });
      return;
    }
    const patients = await loadPatientContext({ wardId });
    const ids = patients.map((p) => p.admissionId);
    const [plans, holds, lastCensus] = await Promise.all([
      loadCurrentPlans(ids),
      ids.length ? prisma.mealHold.findMany({ where: { admissionId: { in: ids }, liftedAt: null } }) : [],
      prisma.dietCensus.findFirst({
        where: { wardId },
        orderBy: { submittedAt: 'desc' },
        include: { lines: { select: { admissionId: true } } },
      }),
    ]);
    const lastIds = lastCensus ? new Set(lastCensus.lines.map((l) => l.admissionId)) : null;
    const holdBy = new Map(holds.map((h) => [h.admissionId, h]));

    const lines = patients
      .sort((a, b) => (a.bedNumber ?? '').localeCompare(b.bedNumber ?? '', undefined, { numeric: true }))
      .map((p) => {
        const plan = plans.get(p.admissionId);
        const hold = holdBy.get(p.admissionId);
        const planNpo = !!plan && (!!plan.npoFrom || !!plan.npoUntil);
        return {
          admissionId: p.admissionId,
          admissionNo: p.admissionNo,
          bedNumber: p.bedNumber,
          patientName: p.patientName,
          prn: p.prn,
          ageSex: [p.age, p.sex].filter(Boolean).join('/') || null,
          consultant: p.consultant,
          diagnosis: p.diagnosis,
          currentDiet: plan ? { code: plan.displayCode, name: plan.dietName, status: plan.status } : null,
          dietText: plan?.displayCode ?? '',
          dietMasterId: plan?.dietId ?? null,
          npo: planNpo || !!hold,
          npoFrom: (hold?.fromAt ?? plan?.npoFrom ?? null)?.toISOString() ?? null,
          feedText: plan?.feed ?? '',
          disposablePlate: plan?.disposablePlate ?? false,
          remarks: '',
          isNew: isNewAdmission(p.admissionDate, lastIds, p.admissionId),
        };
      });

    res.status(200).json({
      wardId,
      wardName: wards.find((w) => w.id === wardId)?.wardName ?? null,
      censusDate: ymd(new Date()),
      lastCensus: lastCensus
        ? { id: lastCensus.id, submittedAt: lastCensus.submittedAt, submittedBy: lastCensus.submittedBy, status: lastCensus.status }
        : null,
      lines,
    });
  } catch (error) {
    console.error('[dietetics] getCensusPrefill failed:', error);
    res.status(500).json({ error: 'Failed to prepare census' });
  }
};

/** POST /census — nurse submits (signed). */
export const submitCensus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { wardId, censusDate, notes, signatureId, lines } = req.body as {
      wardId: string; censusDate?: string; notes?: string; signatureId?: string; lines: CensusLineBody[];
    };
    if (!wardId || !Array.isArray(lines)) {
      res.status(400).json({ error: 'wardId and lines are required' });
      return;
    }
    if (!signatureId) {
      res.status(400).json({ error: 'Nurse signature is required to send the census' });
      return;
    }
    const wards = await allowedWards(req.user?.id);
    const ward = wards.find((w) => w.id === wardId);
    if (!ward) { res.status(403).json({ error: 'You are not assigned to this ward' }); return; }

    // Only patients actually admitted in this ward; snapshot their details.
    const patients = await loadPatientContext({ wardId });
    const byId = new Map(patients.map((p) => [p.admissionId, p]));
    const unknown = lines.filter((l) => !byId.has(l.admissionId));
    if (unknown.length) {
      res.status(400).json({ error: `${unknown.length} line(s) are not admitted in this ward — refresh the census` });
      return;
    }
    const ids = patients.map((p) => p.admissionId);
    const [plans, holds, lastCensus] = await Promise.all([
      loadCurrentPlans(ids),
      ids.length ? prisma.mealHold.findMany({ where: { admissionId: { in: ids }, liftedAt: null } }) : [],
      prisma.dietCensus.findFirst({
        where: { wardId },
        orderBy: { submittedAt: 'desc' },
        include: { lines: { select: { admissionId: true } } },
      }),
    ]);
    const lastIds = lastCensus ? new Set(lastCensus.lines.map((l) => l.admissionId)) : null;
    const holdIds = new Set(holds.map((h) => h.admissionId));

    // One open census per ward per day: a resend replaces the earlier one
    // Dietary has not acknowledged yet.
    await prisma.dietCensus.updateMany({
      where: { wardId, censusDate: dayStart(censusDate), status: { in: ['SUBMITTED', 'RECEIVED'] } },
      data: { status: 'REPLACED' },
    });

    const census = await prisma.dietCensus.create({
      data: {
        wardId,
        wardName: ward.wardName,
        censusDate: dayStart(censusDate),
        notes: notes?.trim() || null,
        submittedBy: req.user?.username ?? null,
        submittedById: typeof req.user?.id === 'number' ? req.user.id : null,
        signatureId,
        lines: {
          create: lines.map((l) => {
            const p = byId.get(l.admissionId)!;
            const plan = plans.get(l.admissionId);
            const dietText = l.dietText?.trim() || null;
            const npoFrom = l.npo && l.npoFrom ? new Date(l.npoFrom) : null;
            // NPO already in force (dietitian NPO or a live hold) is not a change.
            const npoNow = (!!plan && (!!plan.npoFrom || !!plan.npoUntil)) || holdIds.has(l.admissionId);
            const feed = l.feedText?.trim() || '';
            // Did the nurse report anything different from what Dietary already has?
            const changed = plan
              ? (!!dietText && dietText !== plan.displayCode)
                || !!l.npo !== npoNow
                || !!l.disposablePlate !== plan.disposablePlate
                || !!l.remarks?.trim()
                || (!!feed && feed !== (plan.feed ?? ''))
              : (!!l.npo && !npoNow) || !!l.dietMasterId || !!dietText || !!l.remarks?.trim() || !!feed || !!l.disposablePlate;
            const isNew = isNewAdmission(p.admissionDate, lastIds, l.admissionId);
            return {
              admissionId: l.admissionId,
              bedNumber: p.bedNumber,
              patientName: p.patientName,
              prn: p.prn,
              ageSex: [p.age, p.sex].filter(Boolean).join('/') || null,
              consultant: p.consultant,
              diagnosis: p.diagnosis,
              dietText,
              dietMasterId: l.dietMasterId || null,
              npo: !!l.npo,
              npoFrom: npoFrom && !Number.isNaN(npoFrom.getTime()) ? npoFrom : null,
              feedText: l.feedText?.trim() || null,
              disposablePlate: !!l.disposablePlate,
              remarks: l.remarks?.trim() || null,
              // NEW = newly admitted since the last census; CHANGED = nurse reported a difference.
              changeFlag: isNew ? 'NEW' : changed ? 'CHANGED' : 'UNCHANGED',
            };
          }),
        },
      },
      include: { lines: true },
    });

    await auditLog(req, {
      module: 'dietetics', action: 'CREATE', entityType: 'DietCensusSubmit', entityId: census.id,
      payload: { wardId, lines: census.lines.length },
    });
    res.status(201).json({ id: census.id, status: census.status, submittedAt: census.submittedAt, lines: census.lines.length });
  } catch (error) {
    console.error('[dietetics] submitCensus failed:', error);
    res.status(500).json({
      error: 'Failed to submit census',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

/** GET /census?date=&status= — Dietary inbox (and nurse's own history). */
export const listCensus = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (req.query.date) where.censusDate = dayStart(req.query.date as string);
    if (req.query.status) where.status = req.query.status;
    if (req.query.wardId) where.wardId = req.query.wardId;
    const rows = await prisma.dietCensus.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 200,
      include: { _count: { select: { lines: true } }, lines: { select: { changeFlag: true, npo: true } } },
    });
    res.status(200).json(rows.map(({ lines, _count, ...c }) => ({
      ...c,
      lineCount: _count.lines,
      newCount: lines.filter((l) => l.changeFlag === 'NEW').length,
      changedCount: lines.filter((l) => l.changeFlag === 'CHANGED').length,
      npoCount: lines.filter((l) => l.npo).length,
      // Rows Dietary has to look at: new admissions, nurse-reported changes, NPO.
      actionCount: lines.filter((l) => l.changeFlag !== 'UNCHANGED' || l.npo).length,
    })));
  } catch (error) {
    console.error('[dietetics] listCensus failed:', error);
    res.status(500).json({ error: 'Failed to list census' });
  }
};

/** GET /census/:id — lines + how each compares with the patient's current diet now. */
export const getCensus = async (req: Request, res: Response): Promise<void> => {
  try {
    const census = await prisma.dietCensus.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { dietMaster: { select: { code: true, name: true } } } } },
    });
    if (!census) { res.status(404).json({ error: 'Census not found' }); return; }
    const ids = census.lines.map((l) => l.admissionId);
    const [plans, holds, admissions] = await Promise.all([
      loadCurrentPlans(ids),
      prisma.mealHold.findMany({ where: { admissionId: { in: ids }, liftedAt: null } }),
      prisma.ipdAdmission.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
    ]);
    const holdIds = new Set(holds.map((h) => h.admissionId));
    const statusBy = new Map(admissions.map((a) => [a.id, a.status]));
    res.status(200).json({
      ...census,
      lines: census.lines
        .sort((a, b) => (a.bedNumber ?? '').localeCompare(b.bedNumber ?? '', undefined, { numeric: true }))
        .map((l) => {
          const plan = plans.get(l.admissionId);
          const planNpo = !!plan && (!!plan.npoFrom || !!plan.npoUntil);
          // actions = what Dietary must act on; info = context only.
          const actions: string[] = [];
          const info: string[] = [];
          if (statusBy.get(l.admissionId) !== 'admitted') actions.push('No longer admitted — do not serve');
          if (l.changeFlag === 'NEW') actions.push('New admission since last census');
          if (!plan) {
            if (l.dietMasterId) actions.push('Interim diet will be applied on acknowledge');
            else info.push('No diet yet — dietitian to assess');
          } else if (l.dietText && l.dietText !== plan.displayCode) {
            actions.push(`Nurse reports "${l.dietText}" · current diet ${plan.displayCode}`);
          }
          if (l.npo && !planNpo && !holdIds.has(l.admissionId)) actions.push('NPO reported — hold will be applied on acknowledge');
          if (!l.npo && (planNpo || holdIds.has(l.admissionId))) actions.push('Census shows no NPO but an NPO is active');
          if (plan && l.disposablePlate !== plan.disposablePlate) actions.push(`Plate: census says ${l.disposablePlate ? 'disposable' : 'regular'}`);
          if (l.remarks) actions.push(`Remark: ${l.remarks}`);
          return {
            ...l,
            currentDiet: plan ? { code: plan.displayCode, name: plan.dietName, status: plan.status, remark: remarkText(plan) } : null,
            actions,
            info,
            needsAction: actions.length > 0,
          };
        }),
    });
  } catch (error) {
    console.error('[dietetics] getCensus failed:', error);
    res.status(500).json({ error: 'Failed to load census' });
  }
};

/** POST /census/:id/receive — Dietary has opened / received it. */
export const receiveCensus = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.dietCensus.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Census not found' }); return; }
    if (existing.status !== 'SUBMITTED') { res.status(200).json(existing); return; }
    const row = await prisma.dietCensus.update({
      where: { id: existing.id },
      data: { status: 'RECEIVED', receivedAt: new Date(), receivedBy: req.user?.username ?? null },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dietetics] receiveCensus failed:', error);
    res.status(500).json({ error: 'Failed to mark census received' });
  }
};

/** POST /census/:id/acknowledge — Dietary accepts; NPO holds + interim diets applied. */
export const acknowledgeCensus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { applyNpo = true, createInterim = true } = (req.body ?? {}) as { applyNpo?: boolean; createInterim?: boolean };
    const census = await prisma.dietCensus.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!census) { res.status(404).json({ error: 'Census not found' }); return; }
    if (census.status === 'ACKNOWLEDGED') {
      res.status(409).json({ error: `Already acknowledged by ${census.acknowledgedBy ?? 'Dietary'}` });
      return;
    }
    if (census.status === 'REPLACED') {
      res.status(409).json({ error: 'The ward sent a newer census — acknowledge that one' });
      return;
    }
    const ids = census.lines.map((l) => l.admissionId);
    const [plans, holds, admitted] = await Promise.all([
      loadCurrentPlans(ids),
      prisma.mealHold.findMany({ where: { admissionId: { in: ids }, liftedAt: null } }),
      prisma.ipdAdmission.findMany({ where: { id: { in: ids }, status: 'admitted' }, select: { id: true } }),
    ]);
    const holdIds = new Set(holds.map((h) => h.admissionId));
    const admittedIds = new Set(admitted.map((a) => a.id));
    const actor = req.user?.username ?? null;
    let holdsCreated = 0;
    let interimCreated = 0;

    for (const l of census.lines) {
      if (!admittedIds.has(l.admissionId)) continue;
      const plan = plans.get(l.admissionId);
      const planNpo = !!plan && (!!plan.npoFrom || !!plan.npoUntil);

      if (applyNpo && l.npo && !planNpo && !holdIds.has(l.admissionId)) {
        await prisma.mealHold.create({
          data: {
            admissionId: l.admissionId,
            fromAt: l.npoFrom ?? new Date(),
            reason: 'NPO (nursing census)',
            source: 'CENSUS',
            createdBy: actor,
          },
        });
        holdsCreated++;
      }
      if (createInterim && !plan && l.dietMasterId) {
        await prisma.dietPlan.create({
          data: {
            admissionId: l.admissionId,
            dietMasterId: l.dietMasterId,
            status: 'INTERIM',
            source: 'CENSUS',
            disposablePlate: l.disposablePlate,
            feedNotes: l.feedText,
            remarks: [l.dietText ? `Census: ${l.dietText}` : null, l.remarks].filter(Boolean).join(' · ') || null,
            createdBy: actor,
          },
        });
        interimCreated++;
      }
      await auditLog(req, {
        module: 'dietetics', action: 'UPDATE', entityType: 'DietCensus', entityId: l.admissionId,
        payload: {
          censusId: census.id,
          summary: `Census acknowledged (${census.wardName ?? 'ward'})${l.npo ? ' · NPO reported' : ''}${!plan && l.dietMasterId ? ' · interim diet' : ''}`,
        },
      });
    }

    const row = await prisma.dietCensus.update({
      where: { id: census.id },
      data: {
        status: 'ACKNOWLEDGED',
        receivedAt: census.receivedAt ?? new Date(),
        receivedBy: census.receivedBy ?? actor,
        acknowledgedAt: new Date(),
        acknowledgedBy: actor,
        acknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    for (const id of ids) if (admittedIds.has(id)) await syncOrdersQuietly(id);

    res.status(200).json({ ...row, holdsCreated, interimCreated });
  } catch (error) {
    console.error('[dietetics] acknowledgeCensus failed:', error);
    res.status(500).json({
      error: 'Failed to acknowledge census',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
