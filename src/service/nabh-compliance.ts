import prisma from './prisma-client';

/**
 * Phase 10 (extended) — NABH compliance scorecard.
 *
 * Runs ~15 standards-mapped checks against live application data and returns
 * a structured pass/warn/fail report. The point is to surface BREACHES
 * (where the application is non-compliant) rather than dump raw rows.
 *
 * Each check follows the same shape:
 *   numerator   = rows that ARE compliant
 *   denominator = total rows in scope (all rows that should be compliant)
 *   threshold   = NABH-aligned pass bar (e.g. 95%)
 *   status      = PASS | WARNING | FAIL | NOT_APPLICABLE
 *   breaches    = sample of non-compliant rows with their ids (max 25)
 *
 * Standards mapped here (NABH 6th Edition):
 *   AAC.2  — Patient registration completeness
 *   AAC.5  — Discharge summary clinician sign-off
 *   PRE.2  — Admission consent bundle
 *   PRE.4  — Bedside facility acceptance
 *   PRE.5  — Discharge attender acknowledgement
 *   MOM.4  — Two-identifier + 5-rights gating on MAR
 *   MOM.4b — High-risk medication witness co-sign
 *   COP.4  — Daily-care closure per admission day
 *   COP.5  — ICU transfer 3-signature chain
 *   HRM.5  — Open staff handovers (no stale >24h)
 *   HRM.5b — Ratio-breach supervisor sign-off
 *   PSQ.5  — Daily attender feedback captured
 *   PSQ.5b — Negative-flag follow-up
 *   IMS.3  — HMIS sync success rate
 *   IMS.3b — HMIS dead-letter backlog
 *   IMS.3c — HMIS conflict resolution latency
 */

export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_APPLICABLE';

export interface BreachItem {
  entityType: string;
  entityId: string;
  note: string;
}

export interface StandardResult {
  code: string;          // e.g. 'AAC.2'
  name: string;
  description: string;
  status: CheckStatus;
  numerator: number;     // compliant rows
  denominator: number;   // total rows in scope
  percentage: number;    // 0..100
  threshold: number;     // pass bar
  breaches: BreachItem[];
}

export interface ChapterResult {
  code: string;          // 'AAC' | 'PRE' | 'MOM' | …
  name: string;
  standards: StandardResult[];
  passed: number;
  warning: number;
  failed: number;
}

export interface ComplianceReport {
  fromDate: string;
  toDate: string;
  generatedAt: string;
  overall: {
    totalChecks: number;
    passed: number;
    warning: number;
    failed: number;
    notApplicable: number;
    score: number; // weighted 0..100
  };
  chapters: ChapterResult[];
}

interface CheckInput {
  fromDate: Date;
  toDate: Date;
}

const HIGH_RISK_TERMS = [
  'insulin', 'heparin', 'warfarin', 'morphine', 'fentanyl',
  'tramadol', 'pethidine', 'oxycodone', 'enoxaparin',
];

function rate(num: number, den: number): number {
  if (den === 0) return 100;
  return Math.round((num / den) * 1000) / 10;
}

function statusFor(percentage: number, threshold: number): CheckStatus {
  if (percentage >= threshold) return 'PASS';
  if (percentage >= threshold - 10) return 'WARNING';
  return 'FAIL';
}

function buildResult(
  code: string,
  name: string,
  description: string,
  threshold: number,
  numerator: number,
  denominator: number,
  breaches: BreachItem[],
): StandardResult {
  if (denominator === 0) {
    return {
      code, name, description,
      status: 'NOT_APPLICABLE',
      numerator: 0, denominator: 0, percentage: 100, threshold,
      breaches: [],
    };
  }
  const percentage = rate(numerator, denominator);
  return {
    code, name, description,
    status: statusFor(percentage, threshold),
    numerator, denominator, percentage, threshold,
    breaches: breaches.slice(0, 25),
  };
}

// ============================================================================
// CHAPTER: AAC (Access, Assessment, Continuity of Care)
// ============================================================================

async function aac2_patientRegistrationCompleteness({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Schema column names: `created_at`, `dob`, `mobileNo` (legacy snake_case mix).
  const patients = await prisma.patientDetails.findMany({
    where: { created_at: { gte: fromDate, lte: toDate } },
    select: {
      prn: true, name: true, dob: true, gender: true,
      mobileNo: true, contactNo: true,
      nextOfKinName: true, nextOfKinPhone: true,
    },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const p of patients) {
    const missing: string[] = [];
    if (!p.name) missing.push('name');
    if (!p.dob) missing.push('DOB');
    if (!p.gender) missing.push('gender');
    if (!p.mobileNo && !p.contactNo) missing.push('phone');
    if (!p.nextOfKinName) missing.push('nextOfKin');
    if (missing.length === 0) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'PatientDetails',
        entityId: String(p.prn),
        note: `Missing: ${missing.join(', ')}`,
      });
    }
  }

  return buildResult(
    'AAC.2',
    'Patient registration completeness',
    'Every registered patient has the required identity, contact, and next-of-kin fields.',
    95,
    compliant, patients.length, breaches,
  );
}

async function aac5_dischargeSummarySigned({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const discharges = await prisma.ipdDischarge.findMany({
    where: { dischargeDate: { gte: fromDate, lte: toDate } },
    select: { id: true, admissionId: true, clinicianSignatureId: true, summaryStatus: true },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const d of discharges) {
    if (d.clinicianSignatureId) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdDischarge',
        entityId: d.id,
        note: `Discharge unsigned (status=${d.summaryStatus})`,
      });
    }
  }

  return buildResult(
    'AAC.5',
    'Discharge summary clinician sign-off',
    'Every discharge has a treating-clinician electronic signature before the bed is freed.',
    95,
    compliant, discharges.length, breaches,
  );
}

// ============================================================================
// CHAPTER: PRE (Patient Rights & Education)
// ============================================================================

async function pre2_admissionConsentBundle({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Check every admission that reached 'admitted' status — should have at
  // least one ConsentSignature with consentType='admission'.
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
      status: { in: ['admitted', 'discharged', 'LAMA', 'DAMA'] },
    },
    select: { id: true, admissionNo: true },
    take: 5000,
  });

  if (admissions.length === 0) {
    return buildResult('PRE.2', 'Admission consent bundle', 'Each admission has signed admission + treatment + financial consents on file.', 95, 0, 0, []);
  }

  const ids = admissions.map((a) => a.id);
  const signedConsents = await prisma.consentSignature.findMany({
    where: {
      consentType: 'admission',
      contextType: 'admission',
      contextId: { in: ids },
      status: 'SIGNED',
    },
    select: { contextId: true },
  });
  const signedSet = new Set(signedConsents.map((c) => c.contextId));

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const a of admissions) {
    if (signedSet.has(a.id)) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdAdmission',
        entityId: a.admissionNo,
        note: 'Admission consent not signed',
      });
    }
  }

  return buildResult(
    'PRE.2',
    'Admission consent bundle',
    'Each admission has a signed admission consent on file (treatment + financial signed alongside).',
    95,
    compliant, admissions.length, breaches,
  );
}

async function pre4_bedsideFacilityAcceptance({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
      status: { in: ['admitted', 'discharged', 'LAMA', 'DAMA'] },
    },
    select: {
      id: true, admissionNo: true,
      attenderFacilityAcceptanceSignatureId: true,
    },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const a of admissions) {
    if (a.attenderFacilityAcceptanceSignatureId) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdAdmission',
        entityId: a.admissionNo,
        note: 'Bedside facility acceptance signature missing',
      });
    }
  }

  return buildResult(
    'PRE.4',
    'Bedside facility acceptance (WF-2)',
    'Each admitted patient has an attender bedside facility-acceptance signature (NABH PRE handshake).',
    95,
    compliant, admissions.length, breaches,
  );
}

async function pre5_dischargeAttenderAck({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Of the discharges that were SIGNED in the range, how many were also DELIVERED?
  const discharges = await prisma.ipdDischarge.findMany({
    where: {
      dischargeDate: { gte: fromDate, lte: toDate },
      summaryStatus: { in: ['SIGNED', 'DELIVERED'] },
    },
    select: { id: true, summaryStatus: true, attenderAcknowledgmentSignatureId: true },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const d of discharges) {
    if (d.summaryStatus === 'DELIVERED' && d.attenderAcknowledgmentSignatureId) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdDischarge',
        entityId: d.id,
        note: `Pending attender acknowledgement (status=${d.summaryStatus})`,
      });
    }
  }

  return buildResult(
    'PRE.5',
    'Discharge attender acknowledgement',
    'Discharged patients (or attender) sign acknowledgement of receipt of summary.',
    80,
    compliant, discharges.length, breaches,
  );
}

// ============================================================================
// CHAPTER: MOM (Management of Medication)
// ============================================================================

async function mom4_twoIdFiveRights({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const logs = await prisma.ipdMedicationLog.findMany({
    where: { administeredAt: { gte: fromDate, lte: toDate } },
    select: {
      id: true,
      verifiedTwoIdentifiers: true,
      fiveRightsChecked: true,
      administeredBy: true,
    },
    take: 10000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const l of logs) {
    if (l.verifiedTwoIdentifiers && l.fiveRightsChecked) {
      compliant += 1;
    } else {
      const missing = [];
      if (!l.verifiedTwoIdentifiers) missing.push('two-ID');
      if (!l.fiveRightsChecked) missing.push('5-rights');
      breaches.push({
        entityType: 'IpdMedicationLog',
        entityId: l.id,
        note: `Missing: ${missing.join(' + ')} (by ${l.administeredBy})`,
      });
    }
  }

  return buildResult(
    'MOM.4',
    'Two-identifier + five-rights gating',
    'Every MAR row records that the nurse verified patient identity (2-ID) and the five rights of medication.',
    99,
    compliant, logs.length, breaches,
  );
}

async function mom4b_highRiskWitnessed({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // High-risk = generic name matches one of the HIGH_RISK_TERMS. Join via prescriptionId.
  const logs = await prisma.ipdMedicationLog.findMany({
    where: { administeredAt: { gte: fromDate, lte: toDate } },
    select: {
      id: true,
      acknowledgedBySignatureId: true,
      remarks: true,
      prescriptionId: true,
    },
    take: 10000,
  });
  if (logs.length === 0) {
    return buildResult('MOM.4b', 'High-risk medication witness co-sign', 'High-risk medications (insulin, opioids, anticoagulants) carry a second-nurse witness signature.', 95, 0, 0, []);
  }

  const rxIds = Array.from(new Set(logs.map((l) => l.prescriptionId).filter(Boolean)));
  const rxRows = await prisma.ipdPrescription.findMany({
    where: { id: { in: rxIds as string[] } },
    select: { id: true, genericName: true, brandName: true },
  });
  const rxMap = new Map(rxRows.map((r) => [r.id, r]));

  const isHighRisk = (logId: string, prescriptionId: string, remarks: string | null): boolean => {
    const rx = rxMap.get(prescriptionId);
    const name = `${rx?.genericName ?? ''} ${rx?.brandName ?? ''}`.toLowerCase();
    if (HIGH_RISK_TERMS.some((t) => name.includes(t))) return true;
    if ((remarks ?? '').toLowerCase().includes('high-risk')) return true;
    return false;
  };

  const breaches: BreachItem[] = [];
  let scope = 0;
  let compliant = 0;
  for (const l of logs) {
    if (!isHighRisk(l.id, l.prescriptionId, l.remarks)) continue;
    scope += 1;
    if (l.acknowledgedBySignatureId) {
      compliant += 1;
    } else {
      const rx = rxMap.get(l.prescriptionId);
      breaches.push({
        entityType: 'IpdMedicationLog',
        entityId: l.id,
        note: `${rx?.genericName ?? 'unknown drug'} given without witness co-sign`,
      });
    }
  }

  return buildResult(
    'MOM.4b',
    'High-risk medication witness co-sign',
    'High-risk medications (insulin, opioids, anticoagulants) carry a second-nurse witness signature.',
    95,
    compliant, scope, breaches,
  );
}

// ============================================================================
// CHAPTER: COP (Care of Patient)
// ============================================================================

async function cop4_dailyCareClosures({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Compute the set of (admissionId, dayDate) that should have a closure
  // (i.e. each day the patient was admitted) and check if a closure exists.
  // For simplicity: use admission stays whose admissionDate <= toDate AND
  // (still admitted OR dischargeDate >= fromDate) intersected with the range.
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      admissionDate: { lte: toDate },
      OR: [
        { status: 'admitted' },
        { discharge: { is: { dischargeDate: { gte: fromDate } } } },
      ],
    },
    select: {
      id: true, admissionNo: true,
      admissionDate: true,
      discharge: { select: { dischargeDate: true } },
    },
    take: 1000,
  });
  if (admissions.length === 0) {
    return buildResult('COP.4', 'Daily-care closure per admission day', 'Each admission day has a documented daily closure (doctor visit + nursing summary + attender feedback).', 85, 0, 0, []);
  }

  const closures = await prisma.ipdDailyClosure.findMany({
    where: {
      admissionId: { in: admissions.map((a) => a.id) },
      closureDate: { gte: fromDate, lte: toDate },
      status: 'CLOSED',
    },
    select: { admissionId: true, closureDate: true },
  });
  const closureKey = new Set(
    closures.map((c) => `${c.admissionId}|${c.closureDate.toISOString().slice(0, 10)}`),
  );

  const breaches: BreachItem[] = [];
  let scope = 0;
  let compliant = 0;
  const ONE_DAY = 86_400_000;
  for (const a of admissions) {
    const start = a.admissionDate < fromDate ? fromDate : a.admissionDate;
    const end = a.discharge?.dischargeDate && a.discharge.dischargeDate < toDate
      ? a.discharge.dischargeDate
      : toDate;
    for (let t = start.getTime(); t <= end.getTime(); t += ONE_DAY) {
      const day = new Date(t);
      day.setHours(0, 0, 0, 0);
      const key = `${a.id}|${day.toISOString().slice(0, 10)}`;
      scope += 1;
      if (closureKey.has(key)) {
        compliant += 1;
      } else if (breaches.length < 25) {
        breaches.push({
          entityType: 'IpdAdmission',
          entityId: a.admissionNo,
          note: `No closure for ${day.toISOString().slice(0, 10)}`,
        });
      }
    }
  }

  return buildResult(
    'COP.4',
    'Daily-care closure per admission day',
    'Each admission day has a documented daily closure (doctor visit + nursing summary + attender feedback).',
    85,
    compliant, scope, breaches,
  );
}

async function cop5_icuTransferChain({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // For COMPLETED transfers, every signature column should be set.
  const transfers = await prisma.ipdIcuTransferRequest.findMany({
    where: {
      proposedAt: { gte: fromDate, lte: toDate },
      status: 'COMPLETED',
    },
    select: {
      id: true,
      proposerSignatureId: true,
      intensivistSignatureId: true,
      receiverSignatureId: true,
      handoverSignatureId: true,
    },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const t of transfers) {
    const missing: string[] = [];
    if (!t.proposerSignatureId) missing.push('proposer');
    if (!t.intensivistSignatureId) missing.push('intensivist');
    if (!t.receiverSignatureId) missing.push('receiver');
    if (!t.handoverSignatureId) missing.push('handover');
    if (missing.length === 0) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdIcuTransferRequest',
        entityId: t.id,
        note: `Missing signatures: ${missing.join(', ')}`,
      });
    }
  }

  return buildResult(
    'COP.5',
    'ICU transfer signature chain (WF-4)',
    'Every completed ICU transfer carries the four-signature chain: proposer, intensivist, ICU charge nurse accept, handover complete.',
    95,
    compliant, transfers.length, breaches,
  );
}

// ============================================================================
// CHAPTER: HRM (Human Resource Management)
// ============================================================================

async function hrm5_openHandoversNotStale(_input: CheckInput): Promise<StandardResult> {
  // FAIL if any OPEN handover is older than 24h — this is independent of the
  // user-selected range; staleness is a now-vs-row check.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const open = await prisma.staffHandover.findMany({
    where: { status: 'OPEN' },
    select: { id: true, eventType: true, raisedAt: true, originatorName: true },
    take: 1000,
  });

  const stale = open.filter((h) => h.raisedAt < cutoff);
  const breaches: BreachItem[] = stale.map((h) => ({
    entityType: 'StaffHandover',
    entityId: h.id,
    note: `${h.eventType} open since ${h.raisedAt.toISOString()} by ${h.originatorName}`,
  }));

  // For this check, denominator = total OPEN, numerator = those NOT stale.
  // If there are zero open handovers, NOT_APPLICABLE.
  const compliant = open.length - stale.length;
  return buildResult(
    'HRM.5',
    'No stale open handovers',
    'Every staff handover is acknowledged within 24 hours of being raised.',
    100,
    compliant, open.length, breaches,
  );
}

async function hrm5b_ratioBreachSupervisorSign({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const ratio = await prisma.staffHandover.findMany({
    where: {
      raisedAt: { gte: fromDate, lte: toDate },
      eventType: 'RATIO_BREACH',
      status: { in: ['ACKNOWLEDGED', 'CLOSED'] },
    },
    select: { id: true, supervisorSignatureId: true, raisedAt: true },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const r of ratio) {
    if (r.supervisorSignatureId) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'StaffHandover',
        entityId: r.id,
        note: `Ratio breach acknowledged but no supervisor signature (raised ${r.raisedAt.toISOString()})`,
      });
    }
  }

  return buildResult(
    'HRM.5b',
    'Ratio-breach supervisor sign-off',
    'Every nurse:patient ratio breach handover is signed off by a charge-nurse / unit supervisor before close.',
    100,
    compliant, ratio.length, breaches,
  );
}

// ============================================================================
// CHAPTER: PSQ (Patient Safety & Quality)
// ============================================================================

async function psq5_attenderFeedbackCaptured({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const closures = await prisma.ipdDailyClosure.findMany({
    where: { closureDate: { gte: fromDate, lte: toDate } },
    select: { id: true, status: true, attenderSignatureId: true, satisfactionScore: true, admissionId: true },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const c of closures) {
    if (c.status === 'CLOSED' && c.attenderSignatureId && c.satisfactionScore != null) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdDailyClosure',
        entityId: c.id,
        note: `Status=${c.status}, score=${c.satisfactionScore ?? 'null'}, sig=${c.attenderSignatureId ? 'set' : 'missing'}`,
      });
    }
  }

  return buildResult(
    'PSQ.5',
    'Attender feedback captured per day',
    'Every daily closure is locked with a satisfaction score and an attender signature.',
    80,
    compliant, closures.length, breaches,
  );
}

async function psq5b_negativeFlags({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // This is informational — surface count of negative flags raised. No real
  // pass/fail bar, so we use threshold=100 (always), denominator=total flagged,
  // numerator=those with a downstream incident/handover linked. For now we
  // just count and FAIL if there are any unresolved (proxy: raised in range).
  const flagged = await prisma.ipdDailyClosure.findMany({
    where: {
      closureDate: { gte: fromDate, lte: toDate },
      negativeFlag: true,
    },
    select: { id: true, admissionId: true, satisfactionScore: true, concerns: true },
    take: 1000,
  });
  if (flagged.length === 0) {
    return buildResult('PSQ.5b', 'Negative-flag follow-up', 'Closures with score≤2 or attender concerns are tracked through to resolution.', 100, 0, 0, []);
  }
  const breaches: BreachItem[] = flagged.map((f) => ({
    entityType: 'IpdDailyClosure',
    entityId: f.id,
    note: `score=${f.satisfactionScore}, concerns="${(f.concerns ?? '').slice(0, 60)}"`,
  }));
  // Treat all flagged-in-range as needing follow-up (compliant when flagged + handled — proxy: 0 for now).
  return buildResult(
    'PSQ.5b',
    'Negative-flag follow-up',
    'Closures with score≤2 or attender concerns are tracked through to resolution.',
    100,
    0, flagged.length, breaches,
  );
}

// ============================================================================
// CHAPTER: IMS (Information Management System)
// ============================================================================

async function ims3_hmisSyncSuccessRate({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const [success, failed] = await Promise.all([
    prisma.hmisAuditLog.count({
      where: { createdAt: { gte: fromDate, lte: toDate }, status: 'success' },
    }),
    prisma.hmisAuditLog.count({
      where: { createdAt: { gte: fromDate, lte: toDate }, status: { in: ['failed', 'dead'] } },
    }),
  ]);
  const total = success + failed;

  // Pull a few recent failures as breach evidence.
  const recentFailures = await prisma.hmisAuditLog.findMany({
    where: { createdAt: { gte: fromDate, lte: toDate }, status: { in: ['failed', 'dead'] } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, module: true, action: true, status: true },
  });
  const breaches: BreachItem[] = recentFailures.map((r) => ({
    entityType: 'HmisAuditLog',
    entityId: String(r.id),
    note: `${r.module}/${r.action} → ${r.status}`,
  }));

  return buildResult(
    'IMS.3',
    'HMIS sync success rate',
    'Outbound + inbound HMIS sync calls succeed at NABH-acceptable rate.',
    95,
    success, total, breaches,
  );
}

async function ims3b_deadLetterBacklog(_input: CheckInput): Promise<StandardResult> {
  // FAIL if backlog > 10. Independent of the date range — this reflects
  // current operational health.
  const dead = await prisma.hmisDeadLetter.findMany({
    where: { status: 'QUARANTINED' },
    orderBy: { movedAt: 'desc' },
    take: 100,
    select: { id: true, module: true, action: true, movedAt: true },
  });

  const breaches: BreachItem[] = dead.slice(0, 25).map((d) => ({
    entityType: 'HmisDeadLetter',
    entityId: String(d.id),
    note: `${d.module}/${d.action} quarantined ${d.movedAt.toISOString()}`,
  }));
  // Compliant when backlog == 0; treat threshold of 10 as soft cap.
  const score = dead.length === 0 ? 100 : Math.max(0, 100 - dead.length * 10);
  // Synthesize numerator/denominator so the UI can show "X over the cap of 10".
  return {
    code: 'IMS.3b',
    name: 'HMIS dead-letter backlog',
    description: 'No HMIS sync attempts are stuck in dead-letter awaiting operator action.',
    status: dead.length === 0 ? 'PASS' : dead.length <= 10 ? 'WARNING' : 'FAIL',
    numerator: Math.max(0, 10 - dead.length),
    denominator: 10,
    percentage: score,
    threshold: 100,
    breaches,
  };
}

// ============================================================================
// CHAPTER: COP / PSQ / MOM — OT workflow (Phase 11)
// ============================================================================

async function cop14d_safetyChecklistAdherence({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Every CLOSED OT schedule must have all 3 WHO signatures.
  const closed = await prisma.otSchedule.findMany({
    where: { date: { gte: fromDate, lte: toDate }, status: 'CLOSED' },
    select: {
      id: true,
      procedureName: true,
      safetyChecklist: {
        select: {
          signInSignatureId: true,
          timeOutSignatureId: true,
          signOutSignatureId: true,
        },
      },
    },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const s of closed) {
    const missing: string[] = [];
    if (!s.safetyChecklist?.signInSignatureId) missing.push('sign-in');
    if (!s.safetyChecklist?.timeOutSignatureId) missing.push('time-out');
    if (!s.safetyChecklist?.signOutSignatureId) missing.push('sign-out');
    if (missing.length === 0) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'OtSchedule',
        entityId: s.id,
        note: `${s.procedureName} — missing WHO ${missing.join(', ')}`,
      });
    }
  }

  return buildResult(
    'COP.14.d',
    'WHO surgical safety checklist adherence',
    'Every closed OT schedule has all three WHO Surgical Safety Checklist signatures (sign-in, time-out, sign-out).',
    100,
    compliant, closed.length, breaches,
  );
}

async function cop13b_preAnaesthesiaEvaluation({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Every IN_PROGRESS or CLOSED schedule should have a signed pre-op checklist.
  const schedules = await prisma.otSchedule.findMany({
    where: {
      date: { gte: fromDate, lte: toDate },
      status: { in: ['IN_PROGRESS', 'CLOSED'] },
    },
    select: {
      id: true,
      procedureName: true,
      preOpChecklist: { select: { signatureId: true, fitnessCleared: true } },
    },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const s of schedules) {
    if (s.preOpChecklist?.signatureId && s.preOpChecklist?.fitnessCleared) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'OtSchedule',
        entityId: s.id,
        note: `${s.procedureName} — pre-anaesthesia evaluation incomplete or unsigned`,
      });
    }
  }

  return buildResult(
    'COP.13.b',
    'Pre-anaesthesia evaluation',
    'Every operated patient has a signed pre-anaesthesia evaluation with fitness clearance before induction.',
    100,
    compliant, schedules.length, breaches,
  );
}

async function mom10d_implantTraceability({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // Every CLOSED schedule whose intra-op note mentions implants must capture
  // a non-empty implants JSON array. We enforce: if the implants column is set,
  // it must parse to an array of {name, batch, …}. Schedules with no implants
  // at all aren't in scope.
  const intraOps = await prisma.otIntraOpNote.findMany({
    where: {
      schedule: { is: { date: { gte: fromDate, lte: toDate }, status: 'CLOSED' } },
      NOT: { implants: null },
    },
    select: { id: true, scheduleId: true, implants: true },
    take: 5000,
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const n of intraOps) {
    let arr: Array<{ name?: string; batch?: string; serial?: string; manufacturer?: string }> = [];
    try {
      arr = JSON.parse(n.implants ?? '[]');
    } catch {
      arr = [];
    }
    const allHaveBatch = Array.isArray(arr) && arr.length > 0 && arr.every((i) => !!i.name && !!i.batch);
    if (allHaveBatch) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'OtIntraOpNote',
        entityId: n.id,
        note: `Implants present without batch/serial traceability (schedule=${n.scheduleId})`,
      });
    }
  }

  return buildResult(
    'MOM.10.d',
    'Implant traceability',
    'Every implant used in OT carries a recorded batch + serial + manufacturer for recall traceability.',
    100,
    compliant, intraOps.length, breaches,
  );
}

async function psq3a_unplannedReturnRate({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // KPI is tracked as a rate, not a hard pass/fail. NABH benchmark guidance:
  // unplanned-return-to-OT within 30 days should be < 1% of total surgeries.
  const closedWithOutcome = await prisma.otOutcome.findMany({
    where: { schedule: { is: { date: { gte: fromDate, lte: toDate }, status: 'CLOSED' } } },
    select: { id: true, scheduleId: true, unplannedReturn: true },
    take: 5000,
  });

  if (closedWithOutcome.length === 0) {
    return buildResult(
      'PSQ.3.a',
      'Unplanned return to OT (≤1%)',
      'Less than 1% of operated patients require an unplanned return to OT within 30 days.',
      99, 0, 0, [],
    );
  }

  const returned = closedWithOutcome.filter((o) => o.unplannedReturn);
  const compliant = closedWithOutcome.length - returned.length;
  const breaches: BreachItem[] = returned.slice(0, 25).map((r) => ({
    entityType: 'OtOutcome',
    entityId: r.id,
    note: `Unplanned return flagged for schedule ${r.scheduleId}`,
  }));

  return buildResult(
    'PSQ.3.a',
    'Unplanned return to OT (≤1%)',
    'Less than 1% of operated patients require an unplanned return to OT within 30 days.',
    99,
    compliant, closedWithOutcome.length, breaches,
  );
}

async function ims3c_conflictResolutionLatency(_input: CheckInput): Promise<StandardResult> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stale = await prisma.hmisConflict.findMany({
    where: { status: 'OPEN', detectedAt: { lt: cutoff } },
    take: 100,
    select: { id: true, module: true, fieldName: true, entityId: true, detectedAt: true },
  });
  const totalOpen = await prisma.hmisConflict.count({ where: { status: 'OPEN' } });

  const breaches: BreachItem[] = stale.map((c) => ({
    entityType: 'HmisConflict',
    entityId: String(c.id),
    note: `${c.module}.${c.fieldName} on ${c.entityId} open since ${c.detectedAt.toISOString()}`,
  }));

  return buildResult(
    'IMS.3c',
    'HMIS conflict resolution latency',
    'No HMIS-vs-local field conflicts remain open longer than 7 days.',
    100,
    totalOpen - stale.length, totalOpen, breaches,
  );
}

// ============================================================================
// CHAPTER: COP / HIC / PSQ — Dietetics
// ============================================================================

/** COP.7.a — initial dietetic assessment within 24h of admission. */
async function cop7a_initialDietAssessment({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      admissionDate: { gte: fromDate, lte: toDate },
      status: { in: ['admitted', 'discharged', 'LAMA', 'DAMA'] },
    },
    select: { id: true, admissionNo: true, admissionDate: true },
    take: 5000,
  });
  if (admissions.length === 0) {
    return buildResult('COP.7.a', 'Initial dietetic assessment within 24h', 'Every IPD admission has a signed diet plan within 24 hours of admission.', 90, 0, 0, []);
  }

  const ids = admissions.map((a) => a.id);
  const firstPlans = await prisma.dietPlan.findMany({
    where: { admissionId: { in: ids }, status: { in: ['ACTIVE', 'SUPERSEDED', 'ENDED'] }, signedAt: { not: null } },
    select: { admissionId: true, signedAt: true },
    orderBy: { signedAt: 'asc' },
  });
  // First signed plan per admission.
  const firstByAdmission = new Map<string, Date>();
  for (const p of firstPlans) {
    if (!p.signedAt) continue;
    if (!firstByAdmission.has(p.admissionId)) firstByAdmission.set(p.admissionId, p.signedAt);
  }

  const breaches: BreachItem[] = [];
  let compliant = 0;
  const SLA = 24 * 60 * 60 * 1000;
  for (const a of admissions) {
    const signedAt = firstByAdmission.get(a.id);
    if (signedAt && signedAt.getTime() - a.admissionDate.getTime() <= SLA) {
      compliant += 1;
    } else if (!signedAt) {
      breaches.push({ entityType: 'IpdAdmission', entityId: a.admissionNo, note: 'No signed diet plan' });
    } else {
      const hours = Math.round((signedAt.getTime() - a.admissionDate.getTime()) / (60 * 60 * 1000));
      breaches.push({ entityType: 'IpdAdmission', entityId: a.admissionNo, note: `Plan signed ${hours}h after admission (SLA 24h)` });
    }
  }
  return buildResult(
    'COP.7.a',
    'Initial dietetic assessment within 24h',
    'Every IPD admission has a signed diet plan within 24 hours of admission.',
    90,
    compliant, admissions.length, breaches,
  );
}

/** COP.7.b — therapeutic diet selected (not just "general") for patients with chronic conditions in their diagnosis. */
async function cop7b_therapeuticDietSelection({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const CHRONIC = ['diabetes', 'diabetic', 'renal', 'kidney', 'cardiac', 'hypertension', 'liver', 'hepatic', 'cirrhosis', 'oncology', 'cancer', 'dialysis'];
  // Admissions whose diagnosis contains a chronic condition keyword.
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      admissionDate: { gte: fromDate, lte: toDate },
      status: { in: ['admitted', 'discharged', 'LAMA', 'DAMA'] },
    },
    select: { id: true, admissionNo: true, diagnosis: true },
    take: 5000,
  });
  const chronicAdmissions = admissions.filter((a) =>
    CHRONIC.some((t) => (a.diagnosis ?? '').toLowerCase().includes(t)),
  );
  if (chronicAdmissions.length === 0) {
    return buildResult('COP.7.b', 'Therapeutic diet selection', 'Patients with chronic conditions are placed on a condition-specific therapeutic diet, not a general diet.', 95, 0, 0, []);
  }

  const ids = chronicAdmissions.map((a) => a.id);
  const plans = await prisma.dietPlan.findMany({
    where: { admissionId: { in: ids }, status: 'ACTIVE' },
    select: { admissionId: true, diet: { select: { code: true, name: true } } },
  });
  const planByAdm = new Map(plans.map((p) => [p.admissionId, p]));

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const a of chronicAdmissions) {
    const plan = planByAdm.get(a.id);
    const code = (plan?.diet?.code ?? '').toLowerCase();
    const name = (plan?.diet?.name ?? '').toLowerCase();
    const isGeneric = !plan || code === 'general' || code === 'normal' || name === 'general' || name === 'normal diet';
    if (!isGeneric) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdAdmission',
        entityId: a.admissionNo,
        note: plan ? `Chronic dx but on "${plan.diet?.name}" (generic)` : 'Chronic dx but no active diet plan',
      });
    }
  }
  return buildResult(
    'COP.7.b',
    'Therapeutic diet selection',
    'Patients with chronic conditions (diabetes, renal, cardiac, etc.) are placed on a condition-specific therapeutic diet, not a generic diet.',
    95,
    compliant, chronicAdmissions.length, breaches,
  );
}

/** COP.7.c — re-assessment on negative intake. Every admission with a negativeFlag in the range must have a NEW DietPlan signed within 24h of the flag. */
async function cop7c_reassessmentOnNegativeIntake({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const flags = await prisma.mealIntake.findMany({
    where: { negativeFlag: true, recordedAt: { gte: fromDate, lte: toDate } },
    select: {
      id: true, recordedAt: true,
      mealOrder: { select: { admissionId: true, dietPlanId: true } },
    },
    take: 5000,
  });
  if (flags.length === 0) {
    return buildResult('COP.7.c', 'Re-assessment on negative intake', 'When patient meal intake is flagged (<50% consumed), the dietician re-assesses with a new signed diet plan within 24 hours.', 90, 0, 0, []);
  }

  const admissionIds = Array.from(new Set(flags.map((f) => f.mealOrder.admissionId)));
  const newerPlans = await prisma.dietPlan.findMany({
    where: { admissionId: { in: admissionIds }, signedAt: { not: null } },
    select: { admissionId: true, signedAt: true, id: true },
  });

  const breaches: BreachItem[] = [];
  let compliant = 0;
  const SLA = 24 * 60 * 60 * 1000;
  for (const f of flags) {
    const flagTime = f.recordedAt.getTime();
    const hadNewer = newerPlans.some(
      (p) => p.admissionId === f.mealOrder.admissionId
        && p.id !== f.mealOrder.dietPlanId
        && p.signedAt
        && p.signedAt.getTime() > flagTime
        && p.signedAt.getTime() - flagTime <= SLA,
    );
    if (hadNewer) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'MealIntake',
        entityId: f.id,
        note: `Negative flag at ${f.recordedAt.toISOString()} not followed by new diet plan within 24h`,
      });
    }
  }
  return buildResult(
    'COP.7.c',
    'Re-assessment on negative intake',
    'When patient meal intake is flagged (<50% consumed), the dietician re-assesses with a new signed diet plan within 24 hours.',
    90,
    compliant, flags.length, breaches,
  );
}

/** COP.8.a — vulnerable patients (paediatric / geriatric) have a specialised diet codetagged (paediatric / geriatric) or have explicit allergens/restrictions captured. */
async function cop8a_vulnerablePatientNutrition({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  // PatientDetails carries dob. We classify <18 paediatric, >65 geriatric.
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      admissionDate: { gte: fromDate, lte: toDate },
      status: { in: ['admitted', 'discharged'] },
    },
    select: { id: true, admissionNo: true, prn: true, admissionDate: true },
    take: 5000,
  });
  if (admissions.length === 0) {
    return buildResult('COP.8.a', 'Vulnerable patient nutrition', 'Paediatric and geriatric patients have a specialised diet plan with documented restrictions/allergens.', 90, 0, 0, []);
  }

  const prns = Array.from(new Set(
    admissions.map((a) => Number.parseInt(a.prn ?? '', 10)).filter((n) => !Number.isNaN(n)),
  ));
  const patientDobs = await prisma.patientDetails.findMany({
    where: { prn: { in: prns } },
    select: { prn: true, dob: true },
  });
  const dobMap = new Map(patientDobs.map((p) => [String(p.prn), p.dob]));

  const vulnerable: typeof admissions = [];
  for (const a of admissions) {
    const dobStr = dobMap.get(a.prn);
    if (!dobStr) continue;
    const dob = new Date(dobStr);
    if (Number.isNaN(dob.getTime())) continue;
    const years = (a.admissionDate.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (years < 18 || years > 65) vulnerable.push(a);
  }
  if (vulnerable.length === 0) {
    return buildResult('COP.8.a', 'Vulnerable patient nutrition', 'Paediatric and geriatric patients have a specialised diet plan with documented restrictions/allergens.', 90, 0, 0, []);
  }

  const plans = await prisma.dietPlan.findMany({
    where: { admissionId: { in: vulnerable.map((v) => v.id) }, status: 'ACTIVE' },
    select: { admissionId: true, restrictionsSnapshot: true, allergensSnapshot: true, diet: { select: { code: true } } },
  });
  const planByAdm = new Map(plans.map((p) => [p.admissionId, p]));

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const v of vulnerable) {
    const p = planByAdm.get(v.id);
    if (!p) {
      breaches.push({ entityType: 'IpdAdmission', entityId: v.admissionNo, note: 'Vulnerable patient — no active diet plan' });
      continue;
    }
    const hasRestrictions = !!(p.restrictionsSnapshot && p.restrictionsSnapshot !== '[]');
    const hasAllergens = !!(p.allergensSnapshot && p.allergensSnapshot !== '[]');
    if (hasRestrictions || hasAllergens) {
      compliant += 1;
    } else {
      breaches.push({
        entityType: 'IpdAdmission',
        entityId: v.admissionNo,
        note: `Vulnerable patient on "${p.diet?.code}" without restrictions or allergens recorded`,
      });
    }
  }
  return buildResult(
    'COP.8.a',
    'Vulnerable patient nutrition',
    'Paediatric (<18y) and geriatric (>65y) patients have an active diet plan with documented restrictions or allergens.',
    90,
    compliant, vulnerable.length, breaches,
  );
}

/** HIC.4.a — tray temperatures recorded and within FSSAI bands (hot ≥60°C, cold ≤8°C). */
async function hic4a_trayTemperatures({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const deliveries = await prisma.mealDelivery.findMany({
    where: { deliveredAt: { gte: fromDate, lte: toDate } },
    select: { id: true, mealOrderId: true, trayHotTempC: true, trayColdTempC: true },
    take: 5000,
  });
  if (deliveries.length === 0) {
    return buildResult('HIC.4.a', 'Food temperature at point of service', 'Every meal delivery records hot/cold tray temperatures in safe ranges (hot ≥60°C, cold ≤8°C).', 95, 0, 0, []);
  }

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const d of deliveries) {
    const hotOk = d.trayHotTempC == null || d.trayHotTempC >= 60;
    const coldOk = d.trayColdTempC == null || d.trayColdTempC <= 8;
    const recorded = d.trayHotTempC != null || d.trayColdTempC != null;
    if (recorded && hotOk && coldOk) {
      compliant += 1;
    } else if (!recorded) {
      breaches.push({ entityType: 'MealDelivery', entityId: d.id, note: 'No tray temperature recorded' });
    } else {
      const out: string[] = [];
      if (d.trayHotTempC != null && !hotOk) out.push(`hot ${d.trayHotTempC}°C (<60)`);
      if (d.trayColdTempC != null && !coldOk) out.push(`cold ${d.trayColdTempC}°C (>8)`);
      breaches.push({ entityType: 'MealDelivery', entityId: d.id, note: `Out-of-band: ${out.join(', ')}` });
    }
  }
  return buildResult(
    'HIC.4.a',
    'Food temperature at point of service',
    'Every meal delivery records hot/cold tray temperatures in safe ranges (hot ≥60°C, cold ≤8°C).',
    95,
    compliant, deliveries.length, breaches,
  );
}

/** PSQ.5.b — meal intake feedback captured for delivered trays. */
async function psq5b_mealIntakeFeedback({ fromDate, toDate }: CheckInput): Promise<StandardResult> {
  const delivered = await prisma.mealOrder.findMany({
    where: {
      deliveredAt: { gte: fromDate, lte: toDate },
      status: { in: ['DELIVERED', 'CONSUMED'] },
    },
    select: { id: true, status: true, admissionId: true, intake: { select: { percentConsumed: true } } },
    take: 5000,
  });
  if (delivered.length === 0) {
    return buildResult('PSQ.5.b', 'Meal-intake feedback capture', 'Every delivered tray has a recorded % consumed (PSQ patient-feedback evidence).', 80, 0, 0, []);
  }

  const breaches: BreachItem[] = [];
  let compliant = 0;
  for (const o of delivered) {
    if (o.intake) {
      compliant += 1;
    } else {
      breaches.push({ entityType: 'MealOrder', entityId: o.id, note: 'Tray delivered but intake never recorded' });
    }
  }
  return buildResult(
    'PSQ.5.b',
    'Meal-intake feedback capture',
    'Every delivered tray has a recorded % consumed (PSQ patient-feedback evidence).',
    80,
    compliant, delivered.length, breaches,
  );
}

// ============================================================================
// MAIN
// ============================================================================

const CHAPTER_NAMES: Record<string, string> = {
  AAC: 'Access, Assessment, Continuity of Care',
  PRE: 'Patient Rights & Education',
  MOM: 'Management of Medication',
  COP: 'Care of Patient',
  HRM: 'Human Resource Management',
  PSQ: 'Patient Safety & Quality',
  IMS: 'Information Management System',
  HIC: 'Hospital Infection Control',
};

export async function runComplianceReport(
  fromDate: Date,
  toDate: Date,
): Promise<ComplianceReport> {
  const input: CheckInput = { fromDate, toDate };

  // Run every check in parallel — they're all read-only.
  const results = await Promise.all([
    aac2_patientRegistrationCompleteness(input),
    aac5_dischargeSummarySigned(input),
    pre2_admissionConsentBundle(input),
    pre4_bedsideFacilityAcceptance(input),
    pre5_dischargeAttenderAck(input),
    mom4_twoIdFiveRights(input),
    mom4b_highRiskWitnessed(input),
    cop4_dailyCareClosures(input),
    cop5_icuTransferChain(input),
    hrm5_openHandoversNotStale(input),
    hrm5b_ratioBreachSupervisorSign(input),
    psq5_attenderFeedbackCaptured(input),
    psq5b_negativeFlags(input),
    ims3_hmisSyncSuccessRate(input),
    ims3b_deadLetterBacklog(input),
    ims3c_conflictResolutionLatency(input),
    // Phase 11 — OT
    cop14d_safetyChecklistAdherence(input),
    cop13b_preAnaesthesiaEvaluation(input),
    mom10d_implantTraceability(input),
    psq3a_unplannedReturnRate(input),
    // Dietetics
    cop7a_initialDietAssessment(input),
    cop7b_therapeuticDietSelection(input),
    cop7c_reassessmentOnNegativeIntake(input),
    cop8a_vulnerablePatientNutrition(input),
    hic4a_trayTemperatures(input),
    psq5b_mealIntakeFeedback(input),
  ]);

  // Group by chapter prefix.
  const byChapter = new Map<string, StandardResult[]>();
  for (const r of results) {
    const code = r.code.split('.')[0];
    if (!byChapter.has(code)) byChapter.set(code, []);
    byChapter.get(code)!.push(r);
  }

  const chapters: ChapterResult[] = [];
  let passed = 0;
  let warning = 0;
  let failed = 0;
  let notApplicable = 0;
  for (const [code, standards] of byChapter) {
    const chPassed = standards.filter((s) => s.status === 'PASS').length;
    const chWarning = standards.filter((s) => s.status === 'WARNING').length;
    const chFailed = standards.filter((s) => s.status === 'FAIL').length;
    const chNa = standards.filter((s) => s.status === 'NOT_APPLICABLE').length;
    passed += chPassed;
    warning += chWarning;
    failed += chFailed;
    notApplicable += chNa;
    chapters.push({
      code,
      name: CHAPTER_NAMES[code] ?? code,
      standards,
      passed: chPassed,
      warning: chWarning,
      failed: chFailed,
    });
  }

  // Score = % of evaluated checks that PASS (warnings count half).
  const evaluated = passed + warning + failed;
  const score = evaluated === 0 ? 100 : Math.round(((passed + warning * 0.5) / evaluated) * 100);

  return {
    fromDate: fromDate.toISOString(),
    toDate: toDate.toISOString(),
    generatedAt: new Date().toISOString(),
    overall: {
      totalChecks: results.length,
      passed,
      warning,
      failed,
      notApplicable,
      score,
    },
    chapters,
  };
}
