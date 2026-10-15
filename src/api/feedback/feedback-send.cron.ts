import crypto from 'crypto';
import prisma from '../../service/prisma-client';

// Phase 9.25 / Phase 4 — Survey-send cron.
//
// Every 30 minutes, finds recent encounters that should get a survey and
// creates a FeedbackSurvey row with a one-shot token. Actual SMS / WhatsApp
// delivery is a follow-up — for now the row exists and the kiosk URL is
// usable from any device. Idempotent: only one survey per encounter.

const SURVEY_EXPIRY_DAYS = 14;
const HOUR = 60 * 60 * 1000;

function freshToken(): string { return crypto.randomBytes(16).toString('hex'); }
const expiry = (): Date => new Date(Date.now() + SURVEY_EXPIRY_DAYS * 24 * HOUR);

/** Local (server TZ) YYYY-MM-DD — Appointment.date is a local date string. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function autoCreateOpdSurveys(): Promise<number> {
  // OPD: appointments completed 2h–24h ago with no survey yet. The visit's
  // end is the consultation-end / checkout timestamp, not the date-only `date`.
  const now = Date.now();
  const sinceCutoff = new Date(now - 24 * HOUR);
  const minWait = new Date(now - 2 * HOUR);
  const appts = await prisma.appointment.findMany({
    where: {
      status: 'completed',
      date: { gte: localDate(new Date(now - 48 * HOUR)) },
    },
    select: {
      id: true, prnNumber: true, patientName: true,
      endConsultationTime: true, checkedOutTime: true, updated_at: true,
    },
    take: 2000,
  });
  const due = appts
    .map((a) => ({ ...a, completedAt: a.endConsultationTime ?? a.checkedOutTime ?? a.updated_at }))
    .filter((a) => a.completedAt >= sinceCutoff && a.completedAt <= minWait);
  if (!due.length) return 0;

  const existing = await prisma.feedbackSurvey.findMany({
    where: { appointmentId: { in: due.map((a) => a.id) }, template: 'opd-post-visit' },
    select: { appointmentId: true },
  });
  const done = new Set(existing.map((s) => s.appointmentId));
  let created = 0;
  for (const a of due) {
    if (done.has(a.id)) continue;
    await prisma.feedbackSurvey.create({
      data: {
        token: freshToken(),
        template: 'opd-post-visit',
        patientPrn: a.prnNumber != null ? String(a.prnNumber) : null,
        patientName: a.patientName,
        appointmentId: a.id,
        encounterDate: a.completedAt,
        status: 'pending',
        expiresAt: expiry(),
      },
    });
    created += 1;
  }
  return created;
}

async function autoCreateIpdSurveys(): Promise<number> {
  // IPD: discharges from the last 3 days with no survey yet.
  const since = new Date(Date.now() - 3 * 24 * HOUR);
  const discharges = await prisma.ipdDischarge.findMany({
    where: { dischargeDate: { gte: since } },
    select: {
      id: true, admissionId: true, dischargeDate: true,
      admission: { select: { prn: true } },
    },
    take: 500,
  });
  if (!discharges.length) return 0;

  const existing = await prisma.feedbackSurvey.findMany({
    where: { admissionId: { in: discharges.map((d) => d.admissionId) }, template: 'ipd-discharge' },
    select: { admissionId: true },
  });
  const done = new Set(existing.map((s) => s.admissionId));
  let created = 0;
  for (const d of discharges) {
    if (done.has(d.admissionId)) continue;
    await prisma.feedbackSurvey.create({
      data: {
        token: freshToken(),
        template: 'ipd-discharge',
        patientPrn: d.admission?.prn ?? null,
        patientName: null,
        admissionId: d.admissionId,
        encounterDate: d.dischargeDate,
        status: 'pending',
        expiresAt: expiry(),
      },
    });
    created += 1;
  }
  return created;
}

async function autoCreateErSurveys(): Promise<number> {
  // ER: visits closed/discharged in the last 24h with no survey. Emergency has
  // no dedicated discharge timestamp, so updatedAt (bumped by the status
  // change) is the closure proxy; createdAt bounds it to recent visits.
  const now = Date.now();
  const rows = await prisma.emergency.findMany({
    where: {
      updatedAt: { gte: new Date(now - 24 * HOUR) },
      createdAt: { gte: new Date(now - 7 * 24 * HOUR) },
      status: { in: ['discharged', 'closed', 'CLOSED', 'DISCHARGED'] },
    },
    select: { id: true, patientPrn: true, patientName: true, updatedAt: true },
    take: 500,
  });
  if (!rows.length) return 0;

  const existing = await prisma.feedbackSurvey.findMany({
    where: { emergencyId: { in: rows.map((e) => e.id) }, template: 'er-discharge' },
    select: { emergencyId: true },
  });
  const done = new Set(existing.map((s) => s.emergencyId));
  let created = 0;
  for (const e of rows) {
    if (done.has(e.id)) continue;
    await prisma.feedbackSurvey.create({
      data: {
        token: freshToken(),
        template: 'er-discharge',
        patientPrn: e.patientPrn,
        patientName: e.patientName,
        emergencyId: e.id,
        encounterDate: e.updatedAt,
        status: 'pending',
        expiresAt: expiry(),
      },
    });
    created += 1;
  }
  return created;
}

const logged = (label: string) => (err: unknown): number => {
  console.error(`[feedback-send] ${label} failed:`, (err as Error).message);
  return 0;
};

export const registerFeedbackSendCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  // Re-entry guard — the OPD loop can iterate thousands of completed visits
  // on a busy day; a previous run still finishing would otherwise stack.
  let isRunning = false;
  cron.schedule('*/30 * * * *', async () => {
    if (isRunning) { console.log('[feedback-send] previous run still in progress — skipping this tick'); return; }
    isRunning = true;
    try {
      const o = await autoCreateOpdSurveys().catch(logged('OPD'));
      const i = await autoCreateIpdSurveys().catch(logged('IPD'));
      const e = await autoCreateErSurveys().catch(logged('ER'));
      const total = o + i + e;
      if (total > 0) console.log(`[feedback-send] created ${total} surveys (OPD=${o}, IPD=${i}, ER=${e})`);
    } catch (err) {
      console.error('Error in feedback-send cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Feedback-send cron job initialized (runs every 30 min)');
};
