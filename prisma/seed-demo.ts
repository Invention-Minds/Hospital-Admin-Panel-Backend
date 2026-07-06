/// <reference path="../global.d.ts" />

/**
 * seed-demo.ts — Cross-module demo fixture for Feedback, Complaint, Incident
 * and Quality (NABH 108-indicator framework).
 *
 * What it does
 * ─────────────
 * Loads a deterministic, idempotent set of rows that exercises every
 * lifecycle state across the four modules:
 *
 *   • Feedback : pending / sent (recent) / sent (>72h, reminder bait) /
 *                completed promoter / completed detractor (auto-complaint) /
 *                completed critical (auto-complaint + incident) / expired
 *   • Complaint: every channel + every status + an SLA-breached cron bait row
 *   • Incident : every status + a full CAPA + a fall + a PSQ-017 medication
 *                error + an auto-rule sentinel
 *   • Quality  : a Red record + an open RCA + a hand-hygiene + MRD audit
 *                observation cluster + monthly denominator for PSQ-017 +
 *                surveillance HAI + device-day counts + CSSD cycle +
 *                TAT event + critical drug + stock-out + ambulance call +
 *                maintenance complaint + lab amendment + equipment + PM event
 *
 * Idempotency
 * ────────────
 * Every record keyed on a stable unique constraint (qiCode, code, alias,
 * @@unique tuples) is upserted. Rows that have no natural unique key
 * (e.g. QualityAuditObservation, QualityTatEvent) are first cleaned by a
 * synthetic marker — a `notes` field tag of `[seed-demo]` — and recreated.
 *
 * Run
 * ────
 *   npx ts-node prisma/seed-demo.ts
 *   (or: npm run seed:demo)
 *
 * Prerequisites
 * ─────────────
 *   • Schema migrations applied (npx prisma migrate deploy)
 *   • Catalogue seeds already run:
 *       npx ts-node prisma/seed-quality-indicators.ts
 *       npx ts-node prisma/seed-incident-rules.ts
 *       npx ts-node prisma/seed-role-aliases.ts
 *     (this file will fill gaps but assumes the catalogues are present.)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────────────────────
// Time helpers — all computed once at seed start for deterministic offsets.
// ──────────────────────────────────────────────────────────────────────
const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * MIN);
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * HOUR);
const hoursFromNow = (h: number): Date => new Date(NOW.getTime() + h * HOUR);
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * DAY);
const daysFromNow = (d: number): Date => new Date(NOW.getTime() + d * DAY);

// Period helpers — "YYYY-MM"
const periodOf = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthStart = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthEnd = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));

const CURR_PERIOD = periodOf(NOW);
const PREV_MONTH_DATE = new Date(NOW.getTime() - 30 * DAY);
const PREV_PERIOD = periodOf(PREV_MONTH_DATE);
const PREV2_MONTH_DATE = new Date(NOW.getTime() - 60 * DAY);
const PREV2_PERIOD = periodOf(PREV2_MONTH_DATE);

// Deterministic token — predictable URLs for the kiosk demo.
const demoToken = (slug: string): string =>
  `seedtok-${slug.replace(/[^a-z0-9]/gi, '').slice(0, 24).padEnd(24, '0')}`;

const SEED_MARKER = '[seed-demo]';

// ──────────────────────────────────────────────────────────────────────
// 1. FEEDBACK — FeedbackSurvey lifecycle coverage
// ──────────────────────────────────────────────────────────────────────
async function seedFeedback(): Promise<{ critical: string; detractor: string }> {
  console.log('\n▶ Seeding Feedback surveys...');

  // 1a. PENDING — fresh auto-create from feedback-send cron, not yet delivered.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('pending-opd-1') },
    update: {},
    create: {
      token: demoToken('pending-opd-1'),
      template: 'opd-post-visit',
      patientPrn: 'PRN001',
      patientName: 'Anita Sharma',
      encounterDate: hoursAgo(4),
      status: 'pending',
      expiresAt: daysFromNow(14),
    },
  });

  // 1b. SENT recent — within 24h, reminder cron must skip (sentAt > now-72h).
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('sent-recent-1') },
    update: {},
    create: {
      token: demoToken('sent-recent-1'),
      template: 'opd-post-visit',
      patientPrn: 'PRN002',
      patientName: 'Rakesh Kumar',
      encounterDate: hoursAgo(36),
      status: 'sent',
      sentAt: hoursAgo(12),
      sentChannel: 'sms',
      expiresAt: daysFromNow(13),
    },
  });

  // 1c. SENT, REMINDER DUE — sentAt 80h ago, lastReminderAt null. Next
  //     feedback-reminder.cron tick will pick this up.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('reminder-due-1') },
    update: {},
    create: {
      token: demoToken('reminder-due-1'),
      template: 'ipd-discharge',
      patientPrn: 'PRN003',
      patientName: 'Mohammed Iqbal',
      encounterDate: hoursAgo(110),
      status: 'sent',
      sentAt: hoursAgo(80),
      sentChannel: 'sms',
      expiresAt: daysFromNow(11),
    },
  });

  // 1d. SENT, ALREADY REMINDED — lastReminderAt populated; cron must skip.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('reminded-1') },
    update: {},
    create: {
      token: demoToken('reminded-1'),
      template: 'er-discharge',
      patientPrn: 'PRN004',
      patientName: 'Priya Nair',
      encounterDate: hoursAgo(150),
      status: 'sent',
      sentAt: hoursAgo(100),
      sentChannel: 'whatsapp',
      lastReminderAt: hoursAgo(20),
      expiresAt: daysFromNow(10),
    },
  });

  // 1e. COMPLETED — PROMOTER (NPS 9). No complaint, no incident.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('completed-promoter-1') },
    update: {},
    create: {
      token: demoToken('completed-promoter-1'),
      template: 'opd-post-visit',
      patientPrn: 'PRN005',
      patientName: 'Vikram Singh',
      encounterDate: daysAgo(3),
      status: 'completed',
      sentAt: daysAgo(3),
      sentChannel: 'sms',
      respondedAt: daysAgo(2),
      respondedChannel: 'kiosk',
      npsScore: 9,
      satisfactionScores: JSON.stringify({ doctor: 5, nursing: 5, facility: 4, billing: 5 }),
      comments: 'Excellent service, very satisfied.',
      complaintFlag: false,
      expiresAt: daysFromNow(11),
    },
  });

  // 1f. COMPLETED — PASSIVE (NPS 8). No auto-complaint.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('completed-passive-1') },
    update: {},
    create: {
      token: demoToken('completed-passive-1'),
      template: 'opd-post-visit',
      patientPrn: 'PRN006',
      patientName: 'Sneha Patil',
      encounterDate: daysAgo(2),
      status: 'completed',
      sentAt: daysAgo(2),
      sentChannel: 'sms',
      respondedAt: daysAgo(1),
      respondedChannel: 'kiosk',
      npsScore: 8,
      satisfactionScores: JSON.stringify({ doctor: 4, nursing: 4, facility: 3, billing: 4 }),
      comments: 'Good but waiting time was long.',
      complaintFlag: false,
      expiresAt: daysFromNow(12),
    },
  });

  // 1g. COMPLETED — DETRACTOR (NPS 5). Auto-complaint at severity='medium'.
  const detractorSurvey = await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('completed-detractor-1') },
    update: {},
    create: {
      token: demoToken('completed-detractor-1'),
      template: 'ipd-discharge',
      patientPrn: 'PRN007',
      patientName: 'Sunita Reddy',
      encounterDate: daysAgo(2),
      status: 'completed',
      sentAt: daysAgo(2),
      sentChannel: 'sms',
      respondedAt: hoursAgo(18),
      respondedChannel: 'kiosk',
      npsScore: 5,
      satisfactionScores: JSON.stringify({ doctor: 3, nursing: 2, facility: 3, billing: 4 }),
      comments: 'Room cleanliness was poor and discharge took too long.',
      complaintFlag: true,
      expiresAt: daysFromNow(12),
    },
  });

  // 1h. COMPLETED — CRITICAL (NPS 2). Auto-complaint severity='high' +
  //                LOW_NPS_PATIENT_FEEDBACK incident.
  const criticalSurvey = await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('completed-critical-1') },
    update: {},
    create: {
      token: demoToken('completed-critical-1'),
      template: 'ipd-discharge',
      patientPrn: 'PRN008',
      patientName: 'Lakshmi Iyer',
      encounterDate: daysAgo(1),
      status: 'completed',
      sentAt: daysAgo(1),
      sentChannel: 'sms',
      respondedAt: hoursAgo(3),
      respondedChannel: 'kiosk',
      npsScore: 2,
      satisfactionScores: JSON.stringify({ doctor: 2, nursing: 1, facility: 2, billing: 3 }),
      comments: 'Nursing unresponsive at night, medication delayed by 4 hours.',
      complaintFlag: true,
      expiresAt: daysFromNow(13),
    },
  });

  // 1i. EXPIRED — past expiresAt, never completed.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('expired-1') },
    update: {},
    create: {
      token: demoToken('expired-1'),
      template: 'opd-post-visit',
      patientPrn: 'PRN009',
      patientName: 'Arjun Mehta',
      encounterDate: daysAgo(20),
      status: 'expired',
      sentAt: daysAgo(15),
      sentChannel: 'sms',
      expiresAt: daysAgo(2),
    },
  });

  // 1j. EXPIRY CRON BAIT — sent + past expiresAt + still status='sent'.
  await prisma.feedbackSurvey.upsert({
    where: { token: demoToken('expiry-bait-1') },
    update: {},
    create: {
      token: demoToken('expiry-bait-1'),
      template: 'ipd-discharge',
      patientPrn: 'PRN010',
      patientName: 'Geetha Krishnan',
      encounterDate: daysAgo(15),
      status: 'sent',
      sentAt: daysAgo(14),
      sentChannel: 'sms',
      lastReminderAt: daysAgo(7),
      expiresAt: hoursAgo(1),
    },
  });

  console.log('  ✓ 10 feedback surveys upserted');
  return { critical: criticalSurvey.id, detractor: detractorSurvey.id };
}

// ──────────────────────────────────────────────────────────────────────
// 2. COMPLAINT — every channel + every status + SLA-breach bait
// ──────────────────────────────────────────────────────────────────────
async function seedComplaints(linked: { critical: string; detractor: string }): Promise<void> {
  console.log('\n▶ Seeding Complaints...');

  // 2a. COMP-2026-0001 — fresh open, low severity, in-person.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0001' },
    update: {},
    create: {
      code: 'COMP-2026-0001',
      channel: 'in-person',
      source: 'manual',
      severity: 'low',
      status: 'open',
      patientName: 'Walk-in: Suresh K',
      description: 'Parking lot signage unclear — patient missed entry gate.',
      raisedAt: hoursAgo(2),
      slaDueAt: hoursFromNow(166),
    },
  });

  // 2b. COMP-2026-0002 — acknowledged medium, phone.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0002' },
    update: {},
    create: {
      code: 'COMP-2026-0002',
      channel: 'phone',
      source: 'manual',
      severity: 'medium',
      status: 'acknowledged',
      assignedTo: 'patient-experience',
      patientPrn: 'PRN011',
      patientName: 'Rita Joseph',
      description: 'Long wait at billing counter, over 90 minutes.',
      raisedAt: daysAgo(1),
      slaDueAt: hoursFromNow(48),
    },
  });

  // 2c. COMP-2026-0003 — resolved high, whatsapp.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0003' },
    update: {},
    create: {
      code: 'COMP-2026-0003',
      channel: 'whatsapp',
      source: 'manual',
      severity: 'high',
      status: 'resolved',
      assignedTo: 'nursing-supervisor',
      patientPrn: 'PRN012',
      patientName: 'Deepak Rao',
      description: 'Medication delivery delayed by 2 hours in IPD 5B.',
      resolutionNotes: 'Apology issued; medication delivery process retrained.',
      resolvedAt: daysAgo(1),
      resolvedBy: 'grievance.officer',
      raisedAt: daysAgo(2),
      slaDueAt: hoursFromNow(-20),
    },
  });

  // 2d. COMP-2026-0004 — SLA BREACH BAIT — open + slaDueAt in past +
  //     escalatedAt null. Next */15 sweep flips this to escalated.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0004' },
    update: {},
    create: {
      code: 'COMP-2026-0004',
      channel: 'sms',
      source: 'manual',
      severity: 'high',
      status: 'open',
      assignedTo: 'fnb-supervisor',
      patientPrn: 'PRN013',
      patientName: 'Anita Desai',
      description: 'Cold meal delivered to room 312 IPD, three nights in a row.',
      raisedAt: daysAgo(2),
      slaDueAt: hoursAgo(24),
    },
  });

  // 2e. COMP-2026-0005 — already auto-escalated by a prior cron run.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0005' },
    update: {},
    create: {
      code: 'COMP-2026-0005',
      channel: 'kiosk',
      source: 'manual',
      severity: 'medium',
      status: 'escalated',
      assignedTo: 'opd-manager',
      patientPrn: 'PRN014',
      patientName: 'Mahesh Kumar',
      description: 'OPD reception staff was rude when asked for clarification.',
      raisedAt: daysAgo(4),
      slaDueAt: daysAgo(1),
      escalatedAt: hoursAgo(18),
    },
  });

  // 2f. COMP-2026-0006 — survey-auto, NPS=2 sentinel, high, linked to 1h.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0006' },
    update: {},
    create: {
      code: 'COMP-2026-0006',
      channel: 'survey-auto',
      source: 'survey',
      feedbackSurveyId: linked.critical,
      severity: 'high',
      status: 'open',
      patientPrn: 'PRN008',
      patientName: 'Lakshmi Iyer',
      description:
        'Auto-raised from feedback survey (NPS 2). Patient comment: "Nursing unresponsive at night, medication delayed by 4 hours."',
      raisedAt: hoursAgo(3),
      slaDueAt: hoursFromNow(21),
    },
  });

  // 2g. COMP-2026-0007 — survey-auto, NPS=5, medium, linked to 1g.
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0007' },
    update: {},
    create: {
      code: 'COMP-2026-0007',
      channel: 'survey-auto',
      source: 'survey',
      feedbackSurveyId: linked.detractor,
      severity: 'medium',
      status: 'acknowledged',
      assignedTo: 'patient-experience',
      patientPrn: 'PRN007',
      patientName: 'Sunita Reddy',
      description:
        'Auto-raised from feedback survey (NPS 5). Patient comment: "Room cleanliness was poor and discharge took too long."',
      raisedAt: hoursAgo(18),
      slaDueAt: hoursFromNow(54),
    },
  });

  // 2h. COMP-2026-0008 — bulk-status bait (open low, ready for bulk ack).
  await prisma.complaint.upsert({
    where: { code: 'COMP-2026-0008' },
    update: {},
    create: {
      code: 'COMP-2026-0008',
      channel: 'sms',
      source: 'manual',
      severity: 'low',
      status: 'open',
      patientPrn: 'PRN015',
      patientName: 'Ravi Verma',
      description: 'Wi-Fi password change was not communicated to patients.',
      raisedAt: hoursAgo(6),
      slaDueAt: hoursFromNow(162),
    },
  });

  console.log('  ✓ 8 complaints upserted');
}

// ──────────────────────────────────────────────────────────────────────
// 3. INCIDENT — every status + CAPA + fall + PSQ-017 + sentinel auto-rule
// ──────────────────────────────────────────────────────────────────────
async function seedIncidents(): Promise<void> {
  console.log('\n▶ Seeding Incidents...');

  // 3a. INC-2026-0001 — manual, open, fall (feeds PSQ-024 fall rate).
  await prisma.incident.upsert({
    where: { code: 'INC-2026-0001' },
    update: {},
    create: {
      code: 'INC-2026-0001',
      category: 'fall',
      severity: 'minor',
      source: 'manual',
      title: 'Patient slipped near nurse station 4B',
      description: 'Wet floor with no signage. Patient stable, no injury.',
      patientPrn: 'PRN016',
      ward: 'Ward-4B',
      department: 'Medicine',
      reportedBy: 'nurse.anita',
      reportedAt: hoursAgo(6),
      occurredAt: hoursAgo(7),
      status: 'open',
    },
  });

  // 3b. INC-2026-0002 — manual, triaged, medication (PSQ-017).
  await prisma.incident.upsert({
    where: { code: 'INC-2026-0002' },
    update: {},
    create: {
      code: 'INC-2026-0002',
      category: 'medication',
      severity: 'moderate',
      source: 'manual',
      title: 'Wrong-strength insulin dispensed',
      description: 'Caught by bedside nurse before administration.',
      patientPrn: 'PRN017',
      department: 'Endocrine',
      qiCode: 'PSQ-017',
      nabhClause: 'COP.10',
      reportedBy: 'nurse.geetha',
      reportedAt: hoursAgo(20),
      occurredAt: hoursAgo(22),
      status: 'triaged',
      assignedTo: 'dr.kumar',
      triagedAt: hoursAgo(10),
      triagedBy: 'qm.lead',
    },
  });

  // 3c. INC-2026-0003 — investigated with evidence link.
  await prisma.incident.upsert({
    where: { code: 'INC-2026-0003' },
    update: {},
    create: {
      code: 'INC-2026-0003',
      category: 'clinical',
      severity: 'major',
      severityFinal: 'major',
      source: 'manual',
      title: 'Delayed Code Blue response',
      description: 'Code Blue response > 5 minutes in ICU-2 due to mislocated panel.',
      patientPrn: 'PRN018',
      ward: 'ICU-2',
      nabhClause: 'COP.13',
      evidenceLinks: JSON.stringify([
        {
          label: 'Crash cart log',
          url: 'https://storage.googleapis.com/demo-bucket/incidents/seed/cart-log.pdf',
          uploadedBy: 'dr.iyer',
          uploadedAt: daysAgo(2).toISOString(),
        },
      ]),
      reportedBy: 'dr.iyer',
      reportedAt: daysAgo(3),
      occurredAt: daysAgo(3),
      status: 'investigated',
      triagedAt: daysAgo(2),
      triagedBy: 'qm.lead',
    },
  });

  // 3d. INC-2026-0004 — capa_in_progress + full 5-Why CAPA upserted below.
  const capaIncident = await prisma.incident.upsert({
    where: { code: 'INC-2026-0004' },
    update: {},
    create: {
      code: 'INC-2026-0004',
      category: 'infection',
      severity: 'major',
      severityFinal: 'moderate',
      source: 'manual',
      title: 'Cluster of CLABSI in ICU-1',
      description: '3 central-line bloodstream infections in 7 days.',
      patientPrn: 'PRN019',
      ward: 'ICU-1',
      nabhClause: 'HIC.5',
      qiCode: 'PSQ-008',
      reportedBy: 'icn.priya',
      reportedAt: daysAgo(5),
      occurredAt: daysAgo(5),
      status: 'capa_in_progress',
      triagedAt: daysAgo(4),
      triagedBy: 'qm.lead',
    },
  });

  await prisma.incidentCapa.upsert({
    where: { incidentId: capaIncident.id },
    update: {},
    create: {
      incidentId: capaIncident.id,
      immediateActions: 'Cohort isolation; line audit on all ICU-1 patients.',
      why1: 'Multiple central lines >7 days',
      why2: 'No daily line-necessity review',
      why3: 'Workflow not built into rounds',
      why4: 'Rounding checklist outdated',
      why5: 'No ICN representation in checklist update committee',
      rootCause: 'Missing daily line-necessity protocol embedded in ICU rounds.',
      correctiveActions: 'Daily line-review checklist added to EMR rounding view.',
      preventiveActions: 'Quarterly ICN audit on line necessity compliance.',
      owner: 'icu.lead',
      dueDate: daysFromNow(20),
    },
  });

  // 3e. INC-2026-0005 — closed with effectiveness review.
  const closedIncident = await prisma.incident.upsert({
    where: { code: 'INC-2026-0005' },
    update: {},
    create: {
      code: 'INC-2026-0005',
      category: 'documentation',
      severity: 'minor',
      severityFinal: 'near_miss',
      source: 'manual',
      title: 'Consent form filed in wrong chart',
      description: 'Recovered same day; no patient harm.',
      patientPrn: 'PRN020',
      reportedBy: 'mrd.officer',
      reportedAt: daysAgo(20),
      occurredAt: daysAgo(20),
      status: 'closed',
      closedAt: daysAgo(12),
      closedBy: 'qm.lead',
      closureNotes: 'Process retrained, no recurrence.',
    },
  });
  await prisma.incidentCapa.upsert({
    where: { incidentId: closedIncident.id },
    update: {},
    create: {
      incidentId: closedIncident.id,
      immediateActions: 'Chart recovered, patient notified.',
      rootCause: 'Trainee filed at wrong station.',
      correctiveActions: 'Barcode-scan-to-file workflow rolled out.',
      preventiveActions: 'Refresher training quarterly.',
      owner: 'mrd.head',
      completedAt: daysAgo(13),
      effectivenessReview: 'Zero misfilings in 30-day audit window.',
      effectivenessReviewAt: daysAgo(10),
    },
  });

  // 3f. INC-2026-0006 — cancelled (duplicate).
  await prisma.incident.upsert({
    where: { code: 'INC-2026-0006' },
    update: {},
    create: {
      code: 'INC-2026-0006',
      category: 'other',
      severity: 'near_miss',
      source: 'manual',
      title: 'Duplicate fall report',
      description: 'Already raised as INC-2026-0001.',
      reportedBy: 'nurse.anita',
      reportedAt: hoursAgo(5),
      status: 'cancelled',
      closedAt: hoursAgo(4),
      closedBy: 'qm.lead',
      closureNotes: 'Duplicate.',
    },
  });

  // 3g. INC-2026-0007 — sentinel, critical QI breach (auto-rule).
  await prisma.incident.upsert({
    where: { code: 'INC-2026-0007' },
    update: {},
    create: {
      code: 'INC-2026-0007',
      category: 'clinical',
      severity: 'sentinel',
      source: 'auto-rule',
      ruleKey: 'QI_CRITICAL_BREACH',
      title: 'Critical QI breach — PSQ-001 initial assessment outlier',
      description: 'Indicator PSQ-001 captured value 145 minutes (zero-tolerance tier).',
      nabhClause: 'PSQ.4',
      qiCode: 'PSQ-001',
      reportedBy: 'system',
      reportedAt: hoursAgo(8),
      occurredAt: hoursAgo(10),
      status: 'open',
    },
  });

  // 3h. INC-2026-0008 — auto-rule, low NPS (links to critical feedback).
  await prisma.incident.upsert({
    where: { code: 'INC-2026-0008' },
    update: {},
    create: {
      code: 'INC-2026-0008',
      category: 'behavioural',
      severity: 'moderate',
      source: 'auto-rule',
      ruleKey: 'LOW_NPS_PATIENT_FEEDBACK',
      title: 'Critical patient feedback (NPS 2) — Lakshmi Iyer',
      description:
        'Auto-raised from feedback survey NPS=2: "Nursing unresponsive at night."',
      patientPrn: 'PRN008',
      patientName: 'Lakshmi Iyer',
      nabhClause: 'CQI.6',
      reportedBy: 'system',
      reportedAt: hoursAgo(3),
      status: 'triaged',
      assignedTo: 'patient-experience',
      triagedAt: hoursAgo(1),
      triagedBy: 'qm.lead',
    },
  });

  console.log('  ✓ 8 incidents + 2 CAPAs upserted');
}

// ──────────────────────────────────────────────────────────────────────
// 4. QUALITY — Red record + RCA + audit obs + denominator + surveillance +
//             device-days + sterilization + TAT + drug stock + ambulance +
//             maintenance + lab event + equipment + PM event
// ──────────────────────────────────────────────────────────────────────
async function seedQuality(): Promise<void> {
  console.log('\n▶ Seeding Quality fixtures...');

  // 4a. Ensure the QualityIndicators we reference exist. The full catalogue
  //     should be seeded by seed-quality-indicators.ts, but we upsert minimal
  //     rows here so this file is self-contained.
  type MinimalIndicator = {
    qiCode: string;
    chapter: string;
    name: string;
    nabhRef: string;
    department: string;
    indicatorType: string;
    numeratorDef: string;
    denominatorDef: string;
    multiplier: string;
    unit: string;
    frequency: string;
    direction: string;
    defaultBenchmark: number | null;
    isCritical: boolean;
    escalationOwner: string;
    rcaRequiredRule: string;
    nabhClause: string | null;
  };

  const indicatorsToEnsure: MinimalIndicator[] = [
    {
      qiCode: 'ICO-006',
      chapter: 'ICO',
      name: 'Hand Hygiene Compliance',
      nabhRef: 'ICO 5',
      department: 'Hospital-wide',
      indicatorType: 'Process',
      numeratorDef: 'Number of compliant hand-hygiene opportunities observed',
      denominatorDef: 'Total hand-hygiene opportunities observed',
      multiplier: '100',
      unit: '%',
      frequency: 'Monthly',
      direction: 'lower-is-bad',
      defaultBenchmark: 85,
      isCritical: false,
      escalationOwner: 'Infection Control Officer',
      rcaRequiredRule: 'red-2-consecutive',
      nabhClause: 'HIC.2',
    },
    {
      qiCode: 'PSQ-017',
      chapter: 'PSQ',
      name: 'Medication Prescription Error Rate',
      nabhRef: 'PSQ 4',
      department: 'Hospital-wide',
      indicatorType: 'Outcome',
      numeratorDef: 'Number of prescription errors',
      denominatorDef: 'Total prescriptions audited',
      multiplier: '100',
      unit: '%',
      frequency: 'Monthly',
      direction: 'higher-is-bad',
      defaultBenchmark: 0.2,
      isCritical: true,
      escalationOwner: 'Pharmacy Head',
      rcaRequiredRule: 'always',
      nabhClause: 'PSQ.4',
    },
    {
      qiCode: 'PSQ-007',
      chapter: 'PSQ',
      name: 'OPD waiting time',
      nabhRef: 'PSQ 3',
      department: 'OPD',
      indicatorType: 'Process',
      numeratorDef: 'Sum of OPD wait times (minutes)',
      denominatorDef: 'OPD visits',
      multiplier: 'NA',
      unit: 'Minutes',
      frequency: 'Monthly',
      direction: 'higher-is-bad',
      defaultBenchmark: 30,
      isCritical: false,
      escalationOwner: 'Patient Experience Manager',
      rcaRequiredRule: 'red-2-consecutive',
      nabhClause: 'PSQ.3',
    },
    {
      qiCode: 'MRD-001',
      chapter: 'MRD',
      name: 'Incomplete Medical Records',
      nabhRef: 'MRD 1',
      department: 'MRD',
      indicatorType: 'Process',
      numeratorDef: 'Number of incomplete records',
      denominatorDef: 'Total records audited',
      multiplier: '100',
      unit: '%',
      frequency: 'Monthly',
      direction: 'higher-is-bad',
      defaultBenchmark: 5,
      isCritical: false,
      escalationOwner: 'MRD Head',
      rcaRequiredRule: 'red-2-consecutive',
      nabhClause: 'MRD.1',
    },
    {
      qiCode: 'ICO-001',
      chapter: 'ICO',
      name: 'Hospital-Acquired Infection (HAI) Rate',
      nabhRef: 'ICO 1',
      department: 'Hospital-wide',
      indicatorType: 'Outcome',
      numeratorDef: 'Number of HAI cases',
      denominatorDef: 'Total inpatient days',
      multiplier: '1000',
      unit: 'Per 1000 patient days',
      frequency: 'Monthly',
      direction: 'higher-is-bad',
      defaultBenchmark: 5,
      isCritical: true,
      escalationOwner: 'Infection Control Officer',
      rcaRequiredRule: 'always',
      nabhClause: 'HIC.1',
    },
  ];

  for (const def of indicatorsToEnsure) {
    await prisma.qualityIndicator.upsert({
      where: { qiCode: def.qiCode },
      update: {},
      create: {
        qiCode: def.qiCode,
        chapter: def.chapter,
        nabhRef: def.nabhRef,
        department: def.department,
        name: def.name,
        indicatorType: def.indicatorType,
        numeratorDef: def.numeratorDef,
        denominatorDef: def.denominatorDef,
        multiplier: def.multiplier,
        unit: def.unit,
        frequency: def.frequency,
        direction: def.direction,
        defaultBenchmark: def.defaultBenchmark,
        amberThresholdPct: 80,
        isCritical: def.isCritical,
        escalationOwner: def.escalationOwner,
        rcaRequiredRule: def.rcaRequiredRule,
        nabhClause: def.nabhClause,
        isActive: true,
      },
    });
  }

  // 4b. Manual RED record — ICO-006 hand-hygiene at 72.5% vs 85% benchmark.
  const ico006 = await prisma.qualityIndicator.findUnique({
    where: { qiCode: 'ICO-006' },
  });
  if (!ico006) throw new Error('ICO-006 indicator missing — run seed-quality-indicators.ts first');

  const redRecord = await prisma.qualityIndicatorRecord.upsert({
    where: {
      indicatorId_period: { indicatorId: ico006.id, period: PREV_PERIOD },
    },
    update: {},
    create: {
      indicatorId: ico006.id,
      qiCode: 'ICO-006',
      period: PREV_PERIOD,
      periodStart: monthStart(PREV_MONTH_DATE),
      periodEnd: monthEnd(PREV_MONTH_DATE),
      numerator: 145,
      denominator: 200,
      calculatedValue: 72.5,
      benchmarkUsed: 85,
      status: 'red',
      severity: 'high',
      autoCalculated: false,
      capturedBy: 'qm.lead',
      remarks: 'Hand-hygiene compliance below benchmark, trending down.',
    },
  });

  // Second consecutive red — sets up red-2-consecutive trend.
  await prisma.qualityIndicatorRecord.upsert({
    where: {
      indicatorId_period: { indicatorId: ico006.id, period: PREV2_PERIOD },
    },
    update: {},
    create: {
      indicatorId: ico006.id,
      qiCode: 'ICO-006',
      period: PREV2_PERIOD,
      periodStart: monthStart(PREV2_MONTH_DATE),
      periodEnd: monthEnd(PREV2_MONTH_DATE),
      numerator: 152,
      denominator: 210,
      calculatedValue: 72.4,
      benchmarkUsed: 85,
      status: 'red',
      severity: 'high',
      autoCalculated: false,
      capturedBy: 'qm.lead',
    },
  });

  // 4c. RCA — open, owned by Infection Control Officer.
  await prisma.qualityIndicatorRca.upsert({
    where: { recordId: redRecord.id },
    update: {},
    create: {
      recordId: redRecord.id,
      immediateActions: 'Daily HH reinforcement at ICU huddle.',
      owner: 'Infection Control Officer',
      status: 'open',
      dueDate: daysFromNow(30),
    },
  });

  // 4d. Audit observations — hand-hygiene + MRD. Synthetic marker so we can
  //     safely re-seed.
  await prisma.qualityAuditObservation.deleteMany({
    where: {
      notes: { startsWith: SEED_MARKER },
      qiCode: { in: ['ICO-006', 'MRD-001'] },
    },
  });
  const auditObsBatch = [
    { qiCode: 'ICO-006', compliant: true,  location: 'ICU-1',   checkpointKey: 'moment-1', checkpointLabel: 'Before patient contact' },
    { qiCode: 'ICO-006', compliant: false, location: 'ICU-1',   checkpointKey: 'moment-2', checkpointLabel: 'Before aseptic task' },
    { qiCode: 'ICO-006', compliant: true,  location: 'Ward-5',  checkpointKey: 'moment-3', checkpointLabel: 'After body-fluid exposure' },
    { qiCode: 'MRD-001', compliant: false, location: 'Ward-4B', checkpointKey: 'discharge-summary', checkpointLabel: 'Discharge summary present' },
    { qiCode: 'MRD-001', compliant: true,  location: 'Ward-5',  checkpointKey: 'consent-signed',    checkpointLabel: 'Consent form signed' },
  ];
  for (const obs of auditObsBatch) {
    await prisma.qualityAuditObservation.create({
      data: {
        qiCode: obs.qiCode,
        observedAt: hoursAgo(24),
        period: CURR_PERIOD,
        location: obs.location,
        checkpointKey: obs.checkpointKey,
        checkpointLabel: obs.checkpointLabel,
        compliant: obs.compliant,
        notes: `${SEED_MARKER} ${obs.checkpointLabel}`,
        auditor: 'icn.priya',
      },
    });
  }

  // 4e. Monthly denominator for PSQ-017 (prescription error rate). Drives
  //     auto-source: numerator = incidents qiCode='PSQ-017', denominator from
  //     this row.
  await prisma.qualityMonthlyDenominator.upsert({
    where: { qiCode_period: { qiCode: 'PSQ-017', period: PREV_PERIOD } },
    update: { value: 12000 },
    create: {
      qiCode: 'PSQ-017',
      period: PREV_PERIOD,
      value: 12000,
      notes: `${SEED_MARKER} total prescriptions audited (manual capture)`,
      capturedBy: 'qm.lead',
    },
  });

  // 4f. Surveillance event — HAI in ICU-1.
  await prisma.qualitySurveillanceEvent.deleteMany({
    where: { notes: { startsWith: SEED_MARKER } },
  });
  await prisma.qualitySurveillanceEvent.create({
    data: {
      type: 'HAI',
      patientPrn: 'PRN019',
      ward: 'ICU-1',
      organism: 'Klebsiella pneumoniae',
      deviceRelated: false,
      observedAt: daysAgo(4),
      period: CURR_PERIOD,
      notes: `${SEED_MARKER} HAI case identified during weekly surveillance round.`,
      reporter: 'icn.priya',
    },
  });

  // 4g. Device-day counts — 3 wards × device types.
  const deviceDayDate = daysAgo(1);
  const ddDateOnly = new Date(
    Date.UTC(
      deviceDayDate.getUTCFullYear(),
      deviceDayDate.getUTCMonth(),
      deviceDayDate.getUTCDate(),
    ),
  );
  const deviceDayRows: Array<{ ward: string; deviceType: string; count: number }> = [
    { ward: 'ICU-1', deviceType: 'ventilator',   count: 8 },
    { ward: 'ICU-2', deviceType: 'ventilator',   count: 6 },
    { ward: 'ICU-1', deviceType: 'central_line', count: 5 },
  ];
  for (const row of deviceDayRows) {
    await prisma.qualityDeviceDayCount.upsert({
      where: {
        date_ward_deviceType: {
          date: ddDateOnly,
          ward: row.ward,
          deviceType: row.deviceType,
        },
      },
      update: { count: row.count },
      create: {
        date: ddDateOnly,
        ward: row.ward,
        deviceType: row.deviceType,
        count: row.count,
        capturedBy: 'icu.nurse.charge',
      },
    });
  }

  // 4h. Sterilization cycle — failed run with reason.
  await prisma.qualitySterilizationCycle.deleteMany({
    where: { failureReason: { startsWith: SEED_MARKER } },
  });
  await prisma.qualitySterilizationCycle.create({
    data: {
      batchCode: 'CSSD-DEMO-001',
      runAt: daysAgo(2),
      passed: false,
      failureReason: `${SEED_MARKER} Bowie-Dick test failed — re-run required.`,
      capturedBy: 'cssd.tech',
    },
  });

  // 4i. TAT event — PSQ-007 OPD waiting time within target.
  await prisma.qualityTatEvent.deleteMany({
    where: { notes: { startsWith: SEED_MARKER } },
  });
  const tatStart = hoursAgo(3);
  const tatEnd = minutesAgo(155);
  await prisma.qualityTatEvent.create({
    data: {
      qiCode: 'PSQ-007',
      startedAt: tatStart,
      endedAt: tatEnd,
      durationMinutes: 25,
      withinTarget: true,
      location: 'OPD-counter-2',
      notes: `${SEED_MARKER} OPD waiting time within 30-min target.`,
      capturedBy: 'front.office',
    },
  });

  // 4j. Critical drug + stock-out event.
  const adrenaline = await prisma.pharmacyCriticalDrug.upsert({
    where: { code: 'DRG-CRIT-001' },
    update: {},
    create: {
      code: 'DRG-CRIT-001',
      name: 'Adrenaline 1mg/ml inj',
      category: 'Emergency',
      isCritical: true,
    },
  });

  await prisma.pharmacyStockEvent.deleteMany({
    where: {
      drugId: adrenaline.id,
      notes: { startsWith: SEED_MARKER },
    },
  });
  await prisma.pharmacyStockEvent.create({
    data: {
      drugId: adrenaline.id,
      drugCodeSnapshot: adrenaline.code,
      drugNameSnapshot: adrenaline.name,
      eventType: 'stock_out',
      occurredAt: hoursAgo(5),
      quantity: 0,
      notes: `${SEED_MARKER} Stock-out detected during evening shift.`,
      reporter: 'pharmacy.head',
    },
  });

  // 4k. Ambulance call exceeding 8-min target.
  await prisma.facilityAmbulanceCall.deleteMany({
    where: { notes: { startsWith: SEED_MARKER } },
  });
  const calledAt = hoursAgo(6);
  await prisma.facilityAmbulanceCall.create({
    data: {
      calledAt,
      dispatchedAt: new Date(calledAt.getTime() + 2 * MIN),
      arrivedAt: new Date(calledAt.getTime() + 14 * MIN),
      responseTimeMinutes: 14,
      withinTarget: false,
      notes: `${SEED_MARKER} Cardiac emergency — response exceeded 8-min target.`,
      reporter: 'ambulance.dispatch',
    },
  });

  // 4l. Maintenance complaint past SLA.
  await prisma.facilityMaintenanceComplaint.deleteMany({
    where: { notes: { startsWith: SEED_MARKER } },
  });
  await prisma.facilityMaintenanceComplaint.create({
    data: {
      type: 'electrical',
      location: 'Ward-5 corridor',
      notes: `${SEED_MARKER} Two corridor lights out for 36 hours.`,
      raisedAt: hoursAgo(36),
      slaDueAt: hoursAgo(12),
      status: 'open',
      reporter: 'ward.5.charge',
    },
  });

  // 4m. Lab amendment event.
  await prisma.qualityLabRadEvent.deleteMany({
    where: { reason: { startsWith: SEED_MARKER } },
  });
  await prisma.qualityLabRadEvent.create({
    data: {
      eventType: 'lab_amended',
      observedAt: daysAgo(3),
      period: CURR_PERIOD,
      prn: 'PRN017',
      testName: 'Serum K+',
      reason: `${SEED_MARKER} Result amended — original entered against wrong patient ID label.`,
      reporter: 'lab.tech',
    },
  });

  // 4n. Equipment + PM event.
  const ventilator = await prisma.facilityEquipment.upsert({
    where: { code: 'EQ-VENT-DEMO-001' },
    update: {},
    create: {
      code: 'EQ-VENT-DEMO-001',
      name: 'Ventilator Hamilton C3 (demo)',
      type: 'ventilator',
      isCritical: true,
      location: 'ICU-1',
      department: 'ICU',
      status: 'operational',
    },
  });
  await prisma.facilityEquipmentEvent.deleteMany({
    where: { equipmentId: ventilator.id, notes: { startsWith: SEED_MARKER } },
  });
  await prisma.facilityEquipmentEvent.create({
    data: {
      equipmentId: ventilator.id,
      eventType: 'pm',
      dueAt: daysAgo(10),
      occurredAt: daysAgo(9),
      resolvedAt: daysAgo(9),
      performedBy: 'biomed.engineer',
      notes: `${SEED_MARKER} Quarterly PM completed.`,
    },
  });

  console.log('  ✓ Quality: 1 red record + 1 RCA + 5 audit obs + 1 denominator');
  console.log('         + 1 HAI + 3 device-day counts + 1 sterilization cycle');
  console.log('         + 1 TAT event + 1 stock-out + 1 ambulance call');
  console.log('         + 1 maintenance complaint + 1 lab amendment + 1 PM event');
}

// ──────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`seed-demo.ts — running at ${NOW.toISOString()}`);
  console.log(`  period (current): ${CURR_PERIOD}`);
  console.log(`  period (prev):    ${PREV_PERIOD}`);
  console.log(`  period (prev-2):  ${PREV2_PERIOD}`);

  try {
    const linked = await seedFeedback();
    await seedComplaints(linked);
    await seedIncidents();
    await seedQuality();

    console.log('\n✓ seed-demo complete.');
    console.log('  Try POST /api/complaints/sla-sweep to escalate COMP-2026-0004.');
    console.log('  Try POST /api/feedback/surveys/reminder-sweep to flush reminder bait.');
    console.log('  Try POST /api/feedback/surveys/expiry-sweep to clean expiry bait.');
  } catch (err) {
    console.error('seed-demo failed:', err);
    process.exitCode = 1;
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
