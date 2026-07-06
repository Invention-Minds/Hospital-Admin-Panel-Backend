import crypto from 'crypto';
import prisma from '../../service/prisma-client';

// Phase 9.25 / Phase 4 — Survey-send cron.
//
// Every 30 minutes, finds recent encounters that should get a survey and
// creates a FeedbackSurvey row with a one-shot token. Actual SMS / WhatsApp
// delivery is a follow-up — for now the row exists and the kiosk URL is
// usable from any device. Idempotent: only one survey per encounter.

const SURVEY_EXPIRY_DAYS = 14;

function freshToken(): string { return crypto.randomBytes(16).toString('hex'); }

async function autoCreateOpdSurveys(): Promise<number> {
  // OPD: completed appointments from the last 24h with no survey yet.
  const sinceCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const minWait = new Date(Date.now() - 2 * 60 * 60 * 1000); // wait 2h after visit
  const appts = await prisma.appointment.findMany({
    where: {
      status: 'completed',
      date: { gte: sinceCutoff.toISOString().slice(0, 10) },
    },
    select: { id: true, prnNumber: true, patientName: true, date: true },
    take: 1000,
  }).catch(() => [] as Array<{ id: number; prnNumber: number; patientName: string; date: string }>);
  let created = 0;
  for (const a of appts) {
    const apptDate = new Date(a.date);
    if (apptDate > minWait) continue; // too soon
    const existing = await prisma.feedbackSurvey.findFirst({
      where: { appointmentId: a.id, template: 'opd-post-visit' },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.feedbackSurvey.create({
      data: {
        token: freshToken(),
        template: 'opd-post-visit',
        patientPrn: String(a.prnNumber),
        patientName: a.patientName,
        appointmentId: a.id,
        encounterDate: apptDate,
        status: 'pending',
        expiresAt: new Date(Date.now() + SURVEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    created += 1;
  }
  return created;
}

async function autoCreateIpdSurveys(): Promise<number> {
  // IPD: discharges from the last 3 days with no survey yet.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const discharges = await prisma.ipdDischarge.findMany({
    where: { dischargeDate: { gte: since } },
    select: {
      id: true, admissionId: true, dischargeDate: true,
      admission: { select: { prn: true } },
    },
    take: 500,
  }).catch(() => [] as Array<{ id: string; admissionId: string; dischargeDate: Date; admission: { prn: string } | null }>);
  let created = 0;
  for (const d of discharges) {
    const existing = await prisma.feedbackSurvey.findFirst({
      where: { admissionId: d.admissionId, template: 'ipd-discharge' },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.feedbackSurvey.create({
      data: {
        token: freshToken(),
        template: 'ipd-discharge',
        patientPrn: d.admission?.prn ?? null,
        patientName: null,
        admissionId: d.admissionId,
        encounterDate: d.dischargeDate,
        status: 'pending',
        expiresAt: new Date(Date.now() + SURVEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    created += 1;
  }
  return created;
}

async function autoCreateErSurveys(): Promise<number> {
  // ER: closed/discharged emergencies from the last 24h with no survey.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.emergency.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ['discharged', 'closed', 'CLOSED', 'DISCHARGED'] },
    },
    select: { id: true, patientPrn: true, patientName: true, createdAt: true },
    take: 500,
  }).catch(() => [] as Array<{ id: number; patientPrn: string | null; patientName: string; createdAt: Date }>);
  let created = 0;
  for (const e of rows) {
    const existing = await prisma.feedbackSurvey.findFirst({
      where: { emergencyId: e.id, template: 'er-discharge' },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.feedbackSurvey.create({
      data: {
        token: freshToken(),
        template: 'er-discharge',
        patientPrn: e.patientPrn,
        patientName: e.patientName,
        emergencyId: e.id,
        encounterDate: e.createdAt,
        status: 'pending',
        expiresAt: new Date(Date.now() + SURVEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    created += 1;
  }
  return created;
}

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
      const o = await autoCreateOpdSurveys().catch(() => 0);
      const i = await autoCreateIpdSurveys().catch(() => 0);
      const e = await autoCreateErSurveys().catch(() => 0);
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
