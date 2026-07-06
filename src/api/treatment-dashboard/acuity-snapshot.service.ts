import prisma from '../../service/prisma-client';
import {
  computeNews2, gcsToAcvpu, trendOf,
  News2Inputs, AcvpuLevel,
} from '../../service/news2-score';

// Phase 9.13 — Treatment Dashboard acuity snapshot service.
//
// `computeAndStoreSnapshot` is the one place a NEWS2 score is calculated +
// persisted. Called from:
//   • the on-vitals-write hooks (IPD + ICU vitals controllers)
//   • the periodic refresh cron
//   • the watchboard endpoint, lazily, when an admission has no snapshot yet
//
// One PatientAcuitySnapshot row per call → the table is also the EWS-trend
// history the patient drawer graphs.

export interface SnapshotResult {
  id: string;
  admissionId: string;
  source: 'IPD' | 'ICU';
  ewsScore: number;
  ewsBand: string;
  trend: string | null;
  risingStreak: boolean;
  vitalsRecordedAt: Date | null;
  computedAt: Date;
}

// ICU vitals capture GCS + ventilator settings rather than ACVPU + an
// oxygen flag — derive the NEWS2 inputs from what ICU records.
const icuOnOxygen = (v: { ventilatorMode: string | null; fiO2: number | null }): boolean | null => {
  if (v.ventilatorMode) return true;
  if (typeof v.fiO2 === 'number') return v.fiO2 > 21;
  return null;
};

/**
 * Compute + persist a NEWS2 snapshot for one admission. Returns null when
 * the admission has no vitals at all (nothing to score yet).
 */
export async function computeAndStoreSnapshot(admissionId: string): Promise<SnapshotResult | null> {
  const admission = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    select: { id: true, icuAdmittedAt: true, icuDischargedAt: true },
  });
  if (!admission) return null;

  const isIcu = !!admission.icuAdmittedAt && !admission.icuDischargedAt;
  const source: 'IPD' | 'ICU' = isIcu ? 'ICU' : 'IPD';

  let inputs: News2Inputs | null = null;
  let vitalsReadingId: string | null = null;
  let vitalsRecordedAt: Date | null = null;

  if (isIcu) {
    const v = await prisma.icuVitalsReading.findFirst({
      where: { admissionId },
      orderBy: { recordedAt: 'desc' },
    });
    if (v) {
      inputs = {
        respirationRate: v.rr,
        spo2: v.spo2,
        onOxygen: icuOnOxygen(v),
        temperatureC: v.temp,
        systolicBp: v.sbp,
        pulse: v.hr,
        consciousness: gcsToAcvpu(v.gcs),
      };
      vitalsReadingId = v.id;
      vitalsRecordedAt = v.recordedAt;
    }
  } else {
    const v = await prisma.ipdVitalsReading.findFirst({
      where: { admissionId },
      orderBy: { recordedAt: 'desc' },
    });
    if (v) {
      inputs = {
        respirationRate: v.respiration,
        spo2: v.spo2,
        onOxygen: v.onSupplementalOxygen,
        temperatureC: v.temperatureC,
        systolicBp: v.bpSystolic,
        pulse: v.pulse,
        consciousness: (v.consciousnessAcvpu as AcvpuLevel | null) ?? null,
      };
      vitalsReadingId = v.id;
      vitalsRecordedAt = v.recordedAt;
    }
  }

  if (!inputs) return null;

  const result = computeNews2(inputs);

  // Prior snapshot drives trend + the "rising 3 readings" streak (Phase C).
  const priorTwo = await prisma.patientAcuitySnapshot.findMany({
    where: { admissionId },
    orderBy: { computedAt: 'desc' },
    take: 2,
  });
  const prev = priorTwo[0] ?? null;
  const prevPrev = priorTwo[1] ?? null;
  const trend = trendOf(result.score, prev?.ewsScore ?? null);
  // Rising streak: this > prev AND prev > prevPrev.
  const risingStreak =
    !!prev && !!prevPrev &&
    result.score > prev.ewsScore && prev.ewsScore > prevPrev.ewsScore;

  const row = await prisma.patientAcuitySnapshot.create({
    data: {
      admissionId,
      source,
      ewsScore: result.score,
      ewsBand: result.band,
      componentScores: JSON.stringify(result.components),
      trend,
      risingStreak,
      vitalsReadingId,
      vitalsRecordedAt,
    },
  });

  // Auto-notify when a patient crosses INTO the high band (worsening only —
  // we don't re-notify on every high reading, only the transition).
  if (result.band === 'high' && (!prev || prev.ewsBand !== 'high')) {
    try {
      await prisma.notification.create({
        data: {
          type: 'acuity_high',
          title: 'Patient deteriorating — NEWS2 high',
          message: `NEWS2 ${result.score} (${source}) — urgent review required`,
          status: 'unread',
          entityType: 'IpdAdmission',
          // entityId is Int? in the schema; admissionId is a uuid string, so
          // we leave it null and rely on entityType + message for routing.
          isCritical: true,
          targetRole: source === 'ICU' ? 'doctor' : 'doctor',
        },
      });
    } catch (e) {
      console.warn('[acuity] high-band notification failed:', (e as Error).message);
    }
  }

  return {
    id: row.id,
    admissionId,
    source,
    ewsScore: row.ewsScore,
    ewsBand: row.ewsBand,
    trend: row.trend,
    risingStreak: row.risingStreak,
    vitalsRecordedAt: row.vitalsRecordedAt,
    computedAt: row.computedAt,
  };
}

/** Recompute snapshots for every currently-admitted patient. Cron entry. */
export async function refreshAllSnapshots(): Promise<{ processed: number; scored: number }> {
  const active = await prisma.ipdAdmission.findMany({
    where: { status: 'admitted' },
    select: { id: true },
  });
  let scored = 0;
  for (const a of active) {
    const r = await computeAndStoreSnapshot(a.id);
    if (r) scored += 1;
  }
  return { processed: active.length, scored };
}
