import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { computeAndStoreSnapshot, refreshAllSnapshots } from './acuity-snapshot.service';

// Phase 9.13 — Treatment Dashboard controllers.
//
// The watchboard aggregates, per admitted patient:
//   • NEWS2 acuity score + band + trend  (PatientAcuitySnapshot)
//   • critical lab/radiology results     (InvestigationResult — Phase 9.11)
//   • attender-concern flag              (IpdDailyClosure.negativeFlag)
//   • care gap — no progress note today  (IpdProgressNote)
//   • overdue vitals                     (snapshot freshness)
// Rows are returned sickest-first. IPD + ICU patients on one board.

const BAND_RANK: Record<string, number> = { high: 3, medium: 2, 'low-medium': 1, low: 0 };

// Vitals are "overdue" past these gaps (hours). ICU expects hourly rounds.
// Used only as the last-resort fallback — see effectiveOverdueHours().
const VITALS_OVERDUE_HOURS = { ICU: 2, IPD: 8 } as const;

// Phase 9.13 — doctor-ordered monitoring frequency → hours.
const FREQUENCY_HOURS: Record<string, number> = {
  continuous: 1, '1h': 1, '2h': 2, '4h': 4, '6h': 6, '8h': 8, '12h': 12, bd: 12,
};

// NEWS2 band → default monitoring interval (hours), per the RCP escalation
// table. Used when the doctor has not set an explicit order.
const BAND_DEFAULT_HOURS: Record<string, number> = {
  high: 1, medium: 1, 'low-medium': 4, low: 8,
};

/**
 * The interval (hours) after which this patient's vitals count as overdue.
 * Precedence: doctor's explicit order → NEWS2-band default → flat fallback.
 */
function effectiveOverdueHours(
  orderedFreq: string | null,
  band: string | null,
  source: 'IPD' | 'ICU',
): number {
  if (orderedFreq && FREQUENCY_HOURS[orderedFreq] !== undefined) return FREQUENCY_HOURS[orderedFreq];
  if (band && BAND_DEFAULT_HOURS[band] !== undefined) return BAND_DEFAULT_HOURS[band];
  return VITALS_OVERDUE_HOURS[source];
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

interface AlertChip {
  kind: 'critical-lab' | 'attender-concern' | 'no-progress-note' | 'overdue-vitals'
    | 'rising-streak' | 'critical-glucose';
  label: string;
  count?: number;
}

// Phase 9.14 — critical blood-glucose thresholds (mg/dL), mirroring the
// insulin-chart highlight rule.
const GLUCOSE_HIGH = 250;
const GLUCOSE_LOW = 70;

// ─── Watchboard ─────────────────────────────────────────────────────────

export const getWatchboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const source = (req.query.source as string | undefined) ?? 'all'; // ipd | icu | all
    const wardId = req.query.wardId as string | undefined;
    const doctor = (req.query.doctor as string | undefined)?.trim();
    const search = (req.query.search as string | undefined)?.trim()?.toLowerCase();

    const admissions = await prisma.ipdAdmission.findMany({
      where: {
        status: 'admitted',
        ...(wardId && { wardId }),
        ...(doctor && { admittingDoctor: { contains: doctor } }),
      },
      select: {
        id: true, prn: true, admissionNo: true, admittingDoctor: true,
        department: true, wardId: true, bedId: true,
        admissionDate: true, icuAdmittedAt: true, icuDischargedAt: true,
        vitalsMonitoringFrequency: true, vitalsMonitoringSetBy: true,
        ward: { select: { wardName: true, wardCode: true } },
        bed: { select: { bedNumber: true } },
      },
    });

    if (!admissions.length) {
      res.status(200).json({ data: [], kpis: emptyKpis() });
      return;
    }

    const admissionIds = admissions.map((a) => a.id);
    const prns = Array.from(new Set(admissions.map((a) => a.prn).filter(Boolean))) as string[];

    // Patient names (PatientDetails keyed by prn — joined separately to keep
    // the admission query lean). PatientDetails.prn is an Int column while
    // IpdAdmission.prn is a String, so convert for the lookup + remap keys.
    const prnInts = prns.map((p) => Number(p)).filter((n) => Number.isFinite(n));
    const patients = prnInts.length
      ? await prisma.patientDetails.findMany({
          where: { prn: { in: prnInts } },
          select: { prn: true, name: true, age: true, gender: true },
        })
      : [];
    const patientByPrn = new Map(patients.map((p) => [String(p.prn), p]));

    // Latest acuity snapshot per admission.
    const snapshots = await prisma.patientAcuitySnapshot.findMany({
      where: { admissionId: { in: admissionIds } },
      orderBy: { computedAt: 'desc' },
    });
    const snapByAdmission = new Map<string, typeof snapshots[number]>();
    // EWS history per admission (last 10 scores, chronological) for the
    // watchboard sparkline. `snapshots` is computedAt-desc, so we collect
    // then reverse.
    const historyByAdmission = new Map<string, number[]>();
    for (const s of snapshots) {
      if (!snapByAdmission.has(s.admissionId)) snapByAdmission.set(s.admissionId, s);
      const hist = historyByAdmission.get(s.admissionId) ?? [];
      if (hist.length < 10) hist.push(s.ewsScore);
      historyByAdmission.set(s.admissionId, hist);
    }

    // Lazily compute a snapshot for any admission that has none yet.
    for (const a of admissions) {
      if (!snapByAdmission.has(a.id)) {
        const fresh = await computeAndStoreSnapshot(a.id);
        if (fresh) {
          const row = await prisma.patientAcuitySnapshot.findUnique({ where: { id: fresh.id } });
          if (row) snapByAdmission.set(a.id, row);
        }
      }
    }

    // Critical labs (unacknowledged) keyed by prn.
    const criticalLabs = prns.length
      ? await prisma.investigationResult.findMany({
          where: { prn: { in: prns }, criticalFlag: true, acknowledgedAt: null, isDeleted: false },
          select: { prn: true },
        })
      : [];
    const criticalByPrn = new Map<string, number>();
    for (const r of criticalLabs) {
      criticalByPrn.set(r.prn, (criticalByPrn.get(r.prn) ?? 0) + 1);
    }

    // Attender-concern flag — open daily closures with negativeFlag.
    const negativeClosures = await prisma.ipdDailyClosure.findMany({
      where: { admissionId: { in: admissionIds }, negativeFlag: true, status: 'OPEN' },
      select: { admissionId: true },
    });
    const negativeAdmissions = new Set(negativeClosures.map((c) => c.admissionId));

    // Progress notes recorded today.
    const todayNotes = await prisma.ipdProgressNote.findMany({
      where: { admissionId: { in: admissionIds }, date: { gte: startOfToday() } },
      select: { admissionId: true },
    });
    const hasNoteToday = new Set(todayNotes.map((n) => n.admissionId));

    // Phase 9.14 — recent critical blood glucose from the insulin chart
    // (last 24h, out of range). Keep the single worst reading per admission.
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const glucoseRows = await prisma.ipdInsulinInfusion.findMany({
      where: {
        admissionId: { in: admissionIds },
        recordedAt: { gte: since24h },
        OR: [{ bloodGlucoseMgDl: { gte: GLUCOSE_HIGH } }, { bloodGlucoseMgDl: { lte: GLUCOSE_LOW } }],
      },
      select: { admissionId: true, bloodGlucoseMgDl: true },
    });
    // Track the most extreme out-of-range value per admission for the chip.
    const glucoseByAdmission = new Map<string, number>();
    for (const g of glucoseRows) {
      if (g.bloodGlucoseMgDl == null) continue;
      const prev = glucoseByAdmission.get(g.admissionId);
      // "Most extreme" = furthest from the mid-normal (~110).
      if (prev === undefined || Math.abs(g.bloodGlucoseMgDl - 110) > Math.abs(prev - 110)) {
        glucoseByAdmission.set(g.admissionId, g.bloodGlucoseMgDl);
      }
    }

    const now = Date.now();
    const rows = admissions.map((a) => {
      const isIcu = !!a.icuAdmittedAt && !a.icuDischargedAt;
      const rowSource: 'IPD' | 'ICU' = isIcu ? 'ICU' : 'IPD';
      const snap = snapByAdmission.get(a.id) ?? null;
      const patient = a.prn ? patientByPrn.get(a.prn) : undefined;

      const chips: AlertChip[] = [];
      const critCount = a.prn ? (criticalByPrn.get(a.prn) ?? 0) : 0;
      if (critCount > 0) {
        chips.push({ kind: 'critical-lab', label: 'Critical result', count: critCount });
      }
      if (negativeAdmissions.has(a.id)) {
        chips.push({ kind: 'attender-concern', label: 'Attender concern' });
      }
      if (!hasNoteToday.has(a.id)) {
        chips.push({ kind: 'no-progress-note', label: 'No progress note today' });
      }
      const overdueHrs = effectiveOverdueHours(a.vitalsMonitoringFrequency, snap?.ewsBand ?? null, rowSource);
      const vitalsAt = snap?.vitalsRecordedAt ? new Date(snap.vitalsRecordedAt).getTime() : null;
      if (!vitalsAt || (now - vitalsAt) > overdueHrs * 3600_000) {
        chips.push({ kind: 'overdue-vitals', label: `Vitals overdue (>${overdueHrs}h)` });
      }
      if (snap?.risingStreak) {
        chips.push({ kind: 'rising-streak', label: 'EWS rising 3×' });
      }
      const glucose = glucoseByAdmission.get(a.id);
      if (glucose !== undefined) {
        const arrow = glucose >= GLUCOSE_HIGH ? '▲' : '▼';
        chips.push({ kind: 'critical-glucose', label: `Glucose ${glucose} ${arrow}` });
      }

      return {
        admissionId: a.id,
        admissionNo: a.admissionNo,
        prn: a.prn,
        patientName: patient?.name ?? null,
        age: patient?.age ?? null,
        gender: patient?.gender ?? null,
        source: rowSource,
        department: a.department,
        ward: a.ward ? `${a.ward.wardName} (${a.ward.wardCode})` : null,
        bed: a.bed?.bedNumber ?? null,
        admittingDoctor: a.admittingDoctor,
        admissionDate: a.admissionDate,
        ewsScore: snap?.ewsScore ?? null,
        ewsBand: snap?.ewsBand ?? null,
        trend: snap?.trend ?? null,
        risingStreak: snap?.risingStreak ?? false,
        ewsHistory: (historyByAdmission.get(a.id) ?? []).slice().reverse(),
        vitalsRecordedAt: snap?.vitalsRecordedAt ?? null,
        acuityComputedAt: snap?.computedAt ?? null,
        vitalsMonitoringFrequency: a.vitalsMonitoringFrequency ?? null,
        vitalsMonitoringSetBy: a.vitalsMonitoringSetBy ?? null,
        chips,
        alertCount: chips.length,
      };
    });

    // Source filter.
    let filtered = rows;
    if (source === 'ipd') filtered = filtered.filter((r) => r.source === 'IPD');
    else if (source === 'icu') filtered = filtered.filter((r) => r.source === 'ICU');
    // Search filter (name / PRN / bed).
    if (search) {
      filtered = filtered.filter((r) =>
        `${r.patientName ?? ''} ${r.prn ?? ''} ${r.bed ?? ''}`.toLowerCase().includes(search),
      );
    }

    // Sort: highest band first, then score desc, then most alerts.
    filtered.sort((a, b) => {
      const bandDiff = (BAND_RANK[b.ewsBand ?? 'low'] ?? 0) - (BAND_RANK[a.ewsBand ?? 'low'] ?? 0);
      if (bandDiff !== 0) return bandDiff;
      const scoreDiff = (b.ewsScore ?? 0) - (a.ewsScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return b.alertCount - a.alertCount;
    });

    res.status(200).json({ data: filtered, kpis: computeKpis(filtered) });
  } catch (error) {
    console.error('[treatment-dashboard] watchboard failed:', error);
    res.status(500).json({ message: 'Failed to build watchboard' });
  }
};

function emptyKpis() {
  return { total: 0, high: 0, medium: 0, deteriorating: 0, criticalLabs: 0, careGaps: 0, icu: 0 };
}

function computeKpis(rows: Array<{
  ewsBand: string | null; trend: string | null; source: string;
  chips: AlertChip[];
}>) {
  return {
    total: rows.length,
    high: rows.filter((r) => r.ewsBand === 'high').length,
    medium: rows.filter((r) => r.ewsBand === 'medium').length,
    deteriorating: rows.filter((r) => r.trend === 'worsening').length,
    criticalLabs: rows.filter((r) => r.chips.some((c) => c.kind === 'critical-lab')).length,
    careGaps: rows.filter((r) => r.chips.some((c) => c.kind === 'no-progress-note')).length,
    icu: rows.filter((r) => r.source === 'ICU').length,
  };
}

// ─── Patient acuity detail ──────────────────────────────────────────────

export const getPatientAcuity = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: {
        id: true, prn: true, admissionNo: true, admittingDoctor: true,
        department: true, diagnosis: true, admissionDate: true,
        icuAdmittedAt: true, icuDischargedAt: true,
        vitalsMonitoringFrequency: true, vitalsMonitoringSetBy: true, vitalsMonitoringSetAt: true,
        ward: { select: { wardName: true, wardCode: true } },
        bed: { select: { bedNumber: true } },
      },
    });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    const isIcu = !!admission.icuAdmittedAt && !admission.icuDischargedAt;

    // Ensure a fresh snapshot exists, then pull history (oldest→newest).
    await computeAndStoreSnapshot(admissionId);
    const snapshots = await prisma.patientAcuitySnapshot.findMany({
      where: { admissionId },
      orderBy: { computedAt: 'asc' },
      take: 50,
    });

    // Vitals trend — last 24 readings from the relevant stream.
    const vitalsTrend = isIcu
      ? await prisma.icuVitalsReading.findMany({
          where: { admissionId }, orderBy: { recordedAt: 'desc' }, take: 24,
        })
      : await prisma.ipdVitalsReading.findMany({
          where: { admissionId }, orderBy: { recordedAt: 'desc' }, take: 24,
        });

    // Critical + recent results (Phase 9.11).
    const results = admission.prn
      ? await prisma.investigationResult.findMany({
          where: { prn: admission.prn, isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];

    const latestProgressNote = await prisma.ipdProgressNote.findFirst({
      where: { admissionId },
      orderBy: { date: 'desc' },
    });

    const escalations = await prisma.acuityEscalation.findMany({
      where: { admissionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // PatientDetails.prn is Int; admission.prn is String.
    const prnInt = admission.prn ? Number(admission.prn) : NaN;
    const patient = Number.isFinite(prnInt)
      ? await prisma.patientDetails.findFirst({
          where: { prn: prnInt },
          select: { name: true, age: true, gender: true, bloodGroup: true },
        })
      : null;

    res.status(200).json({
      data: {
        admission: {
          ...admission,
          source: isIcu ? 'ICU' : 'IPD',
          patientName: patient?.name ?? null,
          age: patient?.age ?? null,
          gender: patient?.gender ?? null,
          bloodGroup: patient?.bloodGroup ?? null,
        },
        snapshots,
        latestSnapshot: snapshots[snapshots.length - 1] ?? null,
        vitalsTrend: vitalsTrend.reverse(), // chronological for the graph
        results,
        criticalResults: results.filter((r) => r.criticalFlag),
        latestProgressNote,
        escalations,
      },
    });
  } catch (error) {
    console.error('[treatment-dashboard] patient detail failed:', error);
    res.status(500).json({ message: 'Failed to load patient acuity detail' });
  }
};

// ─── Escalation / acknowledgement ───────────────────────────────────────

const VALID_ACTIONS = ['ACKNOWLEDGE', 'ESCALATE', 'REVIEW'] as const;

export const postEscalation = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const body = (req.body ?? {}) as { action?: string; note?: string; ewsScore?: number };

    if (!body.action || !VALID_ACTIONS.includes(body.action as typeof VALID_ACTIONS[number])) {
      res.status(400).json({ message: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
      return;
    }
    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: { id: true, prn: true },
    });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    const row = await prisma.acuityEscalation.create({
      data: {
        admissionId,
        action: body.action,
        ewsScore: typeof body.ewsScore === 'number' ? body.ewsScore : null,
        note: body.note?.trim() || null,
        byName: req.user?.username ?? null,
        byId: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    // An ESCALATE pings the duty doctor.
    if (body.action === 'ESCALATE') {
      try {
        await prisma.notification.create({
          data: {
            type: 'acuity_escalation',
            title: 'Patient escalated from Treatment Dashboard',
            message: `${req.user?.username ?? 'Staff'} escalated a patient (NEWS2 ${body.ewsScore ?? '—'})`,
            status: 'unread',
            entityType: 'IpdAdmission',
            isCritical: true,
            targetRole: 'doctor',
          },
        });
      } catch (e) {
        console.warn('[treatment-dashboard] escalation notification failed:', (e as Error).message);
      }
    }

    await auditLog(req, {
      module: 'treatment-dashboard',
      action: body.action,
      entityType: 'AcuityEscalation',
      entityId: row.id,
      payload: { admissionId, ewsScore: body.ewsScore ?? null },
    });

    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[treatment-dashboard] escalation failed:', error);
    res.status(500).json({ message: 'Failed to record escalation' });
  }
};

// ─── Manual snapshot refresh (admin / demo) ─────────────────────────────

export const refreshSnapshots = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await refreshAllSnapshots();
    res.status(200).json({ data: result });
  } catch (error) {
    console.error('[treatment-dashboard] refresh failed:', error);
    res.status(500).json({ message: 'Failed to refresh snapshots' });
  }
};
