import type { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { raiseByRule } from '../incident/rule-catalogue';
import {
  findRelatedOpenIncidents, attachIncidentLinks, linkComplaintToIncident,
  createWithComplaintCode, deriveComplaintDepartment,
} from '../../service/incident-complaint-link';
import { generateOtp, otpExpiry, sendOtpSms } from '../../service/otp-sms.service';
import { getRegisteredNumber, last10 } from '../../service/record-access.service';
import { runFeedbackExpirySweep } from './feedback-expiry.cron';
import { runFeedbackReminderSweep } from './feedback-reminder.cron';
import { complaintHandlerUserIds } from './complaint-sla.cron';
import { notifyComplaintRaised } from './complaint.controller';
import { resolveUnitId } from '../../service/quality-escalation';
import { categoryFromRatings, complaintDueAt } from '../../service/complaint-sla';
import {
  surveyContext, getFeedbackThresholds, SURVEY_LANGUAGES, CHOICE_REASONS, type FeedbackThresholds,
} from '../../service/feedback-context';

// Phase 9.25 / Phase 4 — Feedback surveys.
//
// Surveys live behind a one-shot token: the URL /feedback/k/:token works on
// a phone or a kiosk without auth. submitByToken auto-raises a Complaint at
// NPS ≤ complaintMaxNps and also fires the LOW_NPS_PATIENT_FEEDBACK incident
// rule at ≤ incidentMaxNps (FeedbackConfig; defaults 6 / 3).

const VALID_TEMPLATES = ['opd-post-visit', 'ipd-discharge', 'er-discharge', 'day-care', 'general'] as const;
const VALID_CHANNELS = ['kiosk', 'sms', 'whatsapp', 'web', 'qr'] as const;
// Category keys accepted in satisfactionScores (1..5 each).
const SATISFACTION_KEYS = [
  'doctor', 'nursing', 'staff', 'cleanliness', 'waitingTime', 'billing', 'food', 'facilities', 'overall',
] as const;
const MAX_COMMENT = 2000;
const MAX_NAME = 120;

/** Complaint severity from NPS, using the configurable incident / complaint cut-offs. */
function severityFromNps(nps: number, t: FeedbackThresholds): 'low' | 'medium' | 'high' {
  if (nps <= t.incidentMaxNps) return 'high';
  if (nps <= t.complaintMaxNps) return 'medium';
  return 'low';
}

/** `YYYY-MM-DD` → local start/end of day; anything else parsed as-is. null = invalid. */
function parseDateParam(v: string, endOfDay: boolean): Date | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00'}`)
    : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parses optional from/to query params; sends 400 and returns null on bad input. */
function readRange(req: Request, res: Response): { from?: Date; to?: Date } | null {
  const { from, to } = req.query as Record<string, string | undefined>;
  const range: { from?: Date; to?: Date } = {};
  if (from) {
    const d = parseDateParam(from, false);
    if (!d) { res.status(400).json({ message: 'from must be a valid date' }); return null; }
    range.from = d;
  }
  if (to) {
    const d = parseDateParam(to, true);
    if (!d) { res.status(400).json({ message: 'to must be a valid date' }); return null; }
    range.to = d;
  }
  if (range.from && range.to && range.from > range.to) {
    res.status(400).json({ message: 'from must be before to' });
    return null;
  }
  return range;
}

const rangeFilter = (r: { from?: Date; to?: Date }) =>
  (r.from || r.to ? { ...(r.from && { gte: r.from }), ...(r.to && { lte: r.to }) } : undefined);

// ── Create (manual or system) ──────────────────────────────────────────

interface CreateSurveyBody {
  template?: string;
  patientPrn?: string | null;
  patientName?: string | null;
  appointmentId?: number | null;
  admissionId?: string | null;
  emergencyId?: number | null;
  encounterDate?: string | null;
  expiresInDays?: number;
}

export const createSurvey = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateSurveyBody;
    if (!body.template || !VALID_TEMPLATES.includes(body.template as typeof VALID_TEMPLATES[number])) {
      res.status(400).json({ message: `template must be one of: ${VALID_TEMPLATES.join(', ')}` });
      return;
    }
    const expiresInDays = body.expiresInDays ?? 14;
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 60) {
      res.status(400).json({ message: 'expiresInDays must be an integer between 1 and 60' });
      return;
    }
    let encounterDate: Date | null = null;
    if (body.encounterDate) {
      encounterDate = new Date(body.encounterDate);
      if (Number.isNaN(encounterDate.getTime())) {
        res.status(400).json({ message: 'encounterDate must be a valid date' });
        return;
      }
    }
    if ((body.patientName?.length ?? 0) > MAX_NAME || (body.patientPrn?.length ?? 0) > 32) {
      res.status(400).json({ message: 'patientName / patientPrn too long' });
      return;
    }
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const link = {
      appointmentId: body.appointmentId ?? null,
      admissionId: body.admissionId ?? null,
      emergencyId: body.emergencyId ?? null,
    };

    const survey = await prisma.feedbackSurvey.create({
      data: {
        token,
        template: body.template,
        patientPrn: body.patientPrn?.trim() || null,
        patientName: body.patientName?.trim() || null,
        ...link,
        ...(await surveyContext(link)),
        collectedById: typeof req.user?.id === 'number' ? req.user.id : null,
        encounterDate,
        status: 'pending',
        expiresAt,
      },
    });
    await auditLog(req, { module: 'feedback', action: 'CREATE', entityType: 'FeedbackSurvey', entityId: survey.id, payload: { template: survey.template } });
    res.status(201).json({ data: survey });
  } catch (error) {
    console.error('[feedback] createSurvey failed:', error);
    res.status(500).json({ message: 'Failed to create survey' });
  }
};

// ── List + stats ───────────────────────────────────────────────────────

export const listSurveys = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, template, patientPrn } = req.query as Record<string, string | undefined>;
    const range = readRange(req, res);
    if (!range) return;
    const rows = await prisma.feedbackSurvey.findMany({
      where: {
        ...(status && { status }),
        ...(template && { template }),
        ...(patientPrn && { patientPrn }),
        ...(rangeFilter(range) && { createdAt: rangeFilter(range) }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    // Tokens are only useful (and only safe to hand out) while the link is live.
    const data = rows.map(({ token, ...r }) =>
      (r.status === 'pending' || r.status === 'sent' ? { ...r, token } : r));
    res.status(200).json({ data });
  } catch (error) {
    console.error('[feedback] listSurveys failed:', error);
    res.status(500).json({ message: 'Failed to load surveys' });
  }
};

export const surveyStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = readRange(req, res);
    if (!range) return;
    const responded = rangeFilter(range);
    const created = rangeFilter(range);
    const [byStatus, byScore] = await Promise.all([
      prisma.feedbackSurvey.groupBy({
        by: ['status'],
        where: created ? { createdAt: created } : {},
        _count: { _all: true },
      }),
      prisma.feedbackSurvey.groupBy({
        by: ['npsScore'],
        where: { status: 'completed', npsScore: { not: null }, ...(responded && { respondedAt: responded }) },
        _count: { _all: true },
      }),
    ]);
    let promoters = 0, passives = 0, detractors = 0;
    for (const g of byScore) {
      const s = g.npsScore!;
      const n = g._count._all;
      if (s >= 9) promoters += n;
      else if (s >= 7) passives += n;
      else detractors += n;
    }
    const total = promoters + passives + detractors;
    const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
    res.status(200).json({
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      nps: { score: npsScore, promoters, passives, detractors, total },
    });
  } catch (error) {
    console.error('[feedback] surveyStats failed:', error);
    res.status(500).json({ message: 'Failed to load stats' });
  }
};

// ── Public (token-based) — no auth required ────────────────────────────

export const getSurveyByToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token;
    const row = await prisma.feedbackSurvey.findUnique({
      where: { token },
      select: {
        id: true, template: true, patientName: true, encounterDate: true,
        status: true, expiresAt: true, patientPrn: true,
      },
    });
    if (!row) { res.status(404).json({ message: 'Survey not found' }); return; }
    if (row.status === 'completed') {
      res.status(200).json({ data: { id: row.id, status: row.status } });
      return;
    }
    if (row.status === 'expired' || (row.expiresAt && row.expiresAt.getTime() < Date.now())) {
      res.status(410).json({ message: 'This survey link has expired' });
      return;
    }
    // The page opens in the patient's preferred language when we know it.
    const { patientPrn, ...publicRow } = row;
    let preferredLanguage: string | null = null;
    if (patientPrn && /^\d+$/.test(patientPrn)) {
      const p = await prisma.patientDetails.findUnique({ where: { prn: Number(patientPrn) }, select: { preferredLanguage: true } }).catch(() => null);
      const lang = p?.preferredLanguage?.trim().toLowerCase() ?? '';
      preferredLanguage = (SURVEY_LANGUAGES as readonly string[]).includes(lang) ? lang : null;
    }
    res.status(200).json({ data: { ...publicRow, preferredLanguage } });
  } catch (error) {
    console.error('[feedback] getSurveyByToken failed:', error);
    res.status(500).json({ message: 'Failed to fetch survey' });
  }
};

interface SubmitBody {
  npsScore?: unknown;
  satisfactionScores?: unknown;
  comments?: unknown;
  channel?: unknown;
  language?: unknown;      // en | kn | ml | hi — the language the patient answered in
  choiceReasons?: unknown; // CHOICE_REASONS keys
}

/** Validates satisfactionScores; returns an error message or null. */
function satisfactionError(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'satisfactionScores must be an object';
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > SATISFACTION_KEYS.length) return 'satisfactionScores has too many keys';
  for (const [k, s] of entries) {
    if (!SATISFACTION_KEYS.includes(k as typeof SATISFACTION_KEYS[number])) {
      return `satisfactionScores keys must be one of: ${SATISFACTION_KEYS.join(', ')}`;
    }
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 5) {
      return 'satisfactionScores values must be integers 1..5';
    }
  }
  return null;
}

export const submitSurveyByToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token;
    const body = (req.body ?? {}) as SubmitBody;
    const nps = body.npsScore;
    if (typeof nps !== 'number' || !Number.isInteger(nps) || nps < 0 || nps > 10) {
      res.status(400).json({ message: 'npsScore must be an integer 0..10' });
      return;
    }
    if (body.comments != null && typeof body.comments !== 'string') {
      res.status(400).json({ message: 'comments must be text' });
      return;
    }
    const comments = (body.comments as string | undefined)?.trim() || null;
    if (comments && comments.length > MAX_COMMENT) {
      res.status(400).json({ message: `comments must be at most ${MAX_COMMENT} characters` });
      return;
    }
    const satErr = satisfactionError(body.satisfactionScores);
    if (satErr) { res.status(400).json({ message: satErr }); return; }
    if (body.language != null && !(SURVEY_LANGUAGES as readonly unknown[]).includes(body.language)) {
      res.status(400).json({ message: `language must be one of: ${SURVEY_LANGUAGES.join(', ')}` });
      return;
    }
    let choiceReasons: string[] | null = null;
    if (body.choiceReasons != null) {
      if (!Array.isArray(body.choiceReasons) || body.choiceReasons.length > CHOICE_REASONS.length ||
          body.choiceReasons.some((r) => !(CHOICE_REASONS as readonly unknown[]).includes(r))) {
        res.status(400).json({ message: `choiceReasons must be a list of: ${CHOICE_REASONS.join(', ')}` });
        return;
      }
      choiceReasons = [...new Set(body.choiceReasons as string[])];
    }
    const existing = await prisma.feedbackSurvey.findUnique({ where: { token } });
    if (!existing) { res.status(404).json({ message: 'Survey not found' }); return; }
    // Explicit channel from the link wins; otherwise the channel the link was
    // delivered on, else a desk QR (the only other way to reach a token).
    const channel = VALID_CHANNELS.includes(body.channel as typeof VALID_CHANNELS[number])
      ? (body.channel as string)
      : (existing.sentChannel && VALID_CHANNELS.includes(existing.sentChannel as typeof VALID_CHANNELS[number])
        ? existing.sentChannel : 'qr');

    const now = new Date();
    const thresholds = await getFeedbackThresholds();
    const willFlag = nps <= thresholds.complaintMaxNps;
    // Atomic completion — only one concurrent submit can flip the row.
    const { count } = await prisma.feedbackSurvey.updateMany({
      where: {
        token,
        status: { notIn: ['completed', 'expired'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        npsScore: nps,
        satisfactionScores: body.satisfactionScores ? JSON.stringify(body.satisfactionScores) : null,
        comments,
        complaintFlag: willFlag,
        language: (body.language as string | undefined) ?? null,
        choiceReasons: choiceReasons && choiceReasons.length ? JSON.stringify(choiceReasons) : null,
        status: 'completed',
        respondedAt: now,
        respondedChannel: existing.respondedChannel === 'walk-up' ? 'walk-up' : channel,
      },
    });
    if (count !== 1) {
      const fresh = await prisma.feedbackSurvey.findUnique({ where: { token }, select: { status: true } });
      if (fresh?.status === 'completed') res.status(409).json({ message: 'Survey already submitted' });
      else res.status(410).json({ message: 'Survey link expired' });
      return;
    }
    const updated = existing;

    // Phase 6 — capture the new Complaint.id so the auto-raised incident can
    // back-link to it (Option A: link, don't dedupe).
    let createdComplaintId: string | null = null;

    // Auto-raise a complaint at or below the configured NPS cut-off (default 6).
    // The survey is already completed, so a transient failure here would lose
    // the grievance — retry, and if it still fails tell the handlers so it's
    // raised by hand.
    if (willFlag) {
      const severity = severityFromNps(nps, thresholds);
      for (let attempt = 1; attempt <= 3 && !createdComplaintId; attempt++) {
      try {
        const department = await deriveComplaintDepartment({
          appointmentId: updated.appointmentId,
          admissionId: updated.admissionId,
          emergencyId: updated.emergencyId,
        });
        const unitId = await resolveUnitId({ admissionId: updated.admissionId, department });
        // Type = the patient's lowest-rated (1–2★) question, if any.
        const category = categoryFromRatings(body.satisfactionScores as Record<string, number> | undefined);
        const slaDueAt = await complaintDueAt(new Date(), { unitId, category, severity });
        const complaint = await createWithComplaintCode((code) => prisma.complaint.create({
          data: {
            code,
            department,
            patientPrn: updated.patientPrn,
            patientName: updated.patientName,
            channel: 'survey-auto',
            source: 'survey',
            feedbackSurveyId: updated.id,
            description: `Auto-raised from feedback survey (NPS ${nps}). ${comments ? 'Patient comment: "' + comments + '"' : 'No comment provided.'}`,
            severity,
            category,
            status: 'open',
            slaDueAt,
            raisedById: null,
            // Phase 6 / Concern #4 — copy encounter FKs from the survey so the
            // dedup helper can find this complaint when a manual one lands.
            appointmentId: updated.appointmentId,
            admissionId: updated.admissionId,
            emergencyId: updated.emergencyId,
            unitId,
            escalationStartAt: new Date(),
          },
        }));
        createdComplaintId = complaint.id;
        void notifyComplaintRaised(complaint);
      } catch (e) {
        console.warn(`[feedback] auto-complaint attempt ${attempt} failed:`, (e as Error).message);
      }
      }
      if (!createdComplaintId) {
        console.error(`[feedback] auto-complaint FAILED for survey ${updated.id} (NPS ${nps}) — alerting handlers`);
        try {
          const handlerIds = await complaintHandlerUserIds();
          if (handlerIds.length > 0) {
            await prisma.notification.createMany({
              data: handlerIds.map((userId) => ({
                type: 'feedback_reminder', // routes to the feedback inbox
                title: `Low-score survey needs a manual complaint (NPS ${nps})`,
                message: `Auto-complaint creation failed for survey ${updated.id}${updated.patientPrn ? ' · PRN ' + updated.patientPrn : ''}. Raise it from the complaints inbox.`,
                status: 'unread',
                isCritical: true,
                entityId: 0,
                entityType: `FeedbackSurvey:${updated.id}`,
                userId,
              })),
            });
          }
        } catch (err) {
          console.error('[feedback] auto-complaint fallback alert failed:', (err as Error).message);
        }
      }
    }

    // Very low NPS (default ≤ 3) — also fire the incident rule (Patient
    // Experience review). Phase 6 / Option A — wait for the rule to return so
    // we can attach links back to the survey + complaint + open incidents.
    if (nps <= thresholds.incidentMaxNps) {
      try {
        const result = await raiseByRule('LOW_NPS_PATIENT_FEEDBACK', {
          patientPrn: updated.patientPrn,
          patientName: updated.patientName,
          appointmentId: updated.appointmentId,
          admissionId: updated.admissionId,
          emergencyId: updated.emergencyId,
          extras: { npsScore: nps, template: updated.template, surveyId: updated.id },
        });
        // Whether the rule created a fresh incident or matched an existing
        // active one (dedup), we still link the new survey + auto-complaint to
        // *that* incident. attachIncidentLinks merges — it never overwrites
        // an existing survey/complaint link on a deduped incident.
        if (result?.incidentId) {
          const siblings = await findRelatedOpenIncidents({
            patientPrn: updated.patientPrn,
            excludeIncidentId: result.incidentId,
          });
          await attachIncidentLinks({
            incidentId: result.incidentId,
            feedbackSurveyId: updated.id,
            complaintId: createdComplaintId,
            relatedIds: siblings.map((s) => s.id),
          });
          if (createdComplaintId) {
            await linkComplaintToIncident(createdComplaintId, result.incidentId);
          }
        }
      } catch (err) {
        console.error('[feedback] LOW_NPS incident linking failed:', err);
      }
    }

    // Offer the Google review page to every respondent (never only happy ones —
    // selectively soliciting positive reviews breaks Google's review policy).
    const review = await prisma.feedbackConfig.findUnique({ where: { id: 1 }, select: { googleReviewUrl: true } }).catch(() => null);
    res.status(200).json({ data: { id: updated.id, status: 'completed', reviewUrl: review?.googleReviewUrl ?? null } });
  } catch (error) {
    console.error('[feedback] submitSurveyByToken failed:', error);
    res.status(500).json({ message: 'Failed to submit survey' });
  }
};

/** Public: the patient tapped "Share on Google" after submitting. First tap is counted; never errors loudly. */
export const recordReviewClick = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.feedbackSurvey.updateMany({
      where: { token: req.params.token, status: 'completed', reviewClickedAt: null },
      data: { reviewClickedAt: new Date() },
    });
    res.status(204).end();
  } catch (error) {
    console.error('[feedback] recordReviewClick failed:', error);
    res.status(204).end();
  }
};

// ── Walk-up kiosk. Patient scans a poster QR pointed at /feedback/new and
// enters their PRN; we SMS an OTP to the phone on record and only mint a
// survey once it's verified. The FE then forwards to /feedback/k/:token.

const VISIT_TO_TEMPLATE: Record<string, typeof VALID_TEMPLATES[number]> = {
  opd: 'opd-post-visit',
  ipd: 'ipd-discharge',
  er: 'er-discharge',
  'day-care': 'day-care',
  general: 'general',
};

const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_PER_PRN = 3;
const OTP_MAX_PER_IP = 10;
const OTP_MAX_ATTEMPTS = 5;
const WALKUP_SURVEY_WINDOW_MS = 24 * 60 * 60 * 1000;
const WALKUP_GENERIC = 'If this PRN is registered, an OTP has been sent to the phone on record.';

// `trust proxy` is set in index.ts, so req.ip is the proxy-reported client
// address — never read X-Forwarded-For directly (spoofable).
const requestIp = (req: Request): string => req.ip || req.socket?.remoteAddress || 'unknown';
const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

async function patientForPrn(prn: number): Promise<{ name: string; phone: string | null } | null> {
  const [pd, p] = await Promise.all([
    prisma.patientDetails.findUnique({ where: { prn }, select: { name: true } }),
    prisma.patient.findUnique({ where: { prn }, select: { name: true } }),
  ]);
  const name = (pd?.name || p?.name || '').trim();
  if (!pd && !p) return null;
  return { name: name.slice(0, MAX_NAME) || 'Patient', phone: await getRegisteredNumber(prn) };
}

export const requestWalkUpOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = String((req.body as { patientPrn?: unknown })?.patientPrn ?? '').trim();
    const prn = Number(raw);
    if (!/^\d{1,10}$/.test(raw) || prn < 1 || prn > 2147483647) {
      res.status(400).json({ message: 'Please enter a valid PRN (numbers only).' });
      return;
    }
    const patientPrn = String(prn);
    const ip = requestIp(req);
    const since = new Date(Date.now() - OTP_WINDOW_MS);

    const [byIp, byPrn] = await Promise.all([
      prisma.feedbackWalkUpOtp.count({ where: { requestIp: ip, createdAt: { gte: since } } }),
      prisma.feedbackWalkUpOtp.count({ where: { patientPrn, createdAt: { gte: since } } }),
    ]);
    if (byIp >= OTP_MAX_PER_IP || byPrn >= OTP_MAX_PER_PRN) {
      res.status(429).json({ message: 'Too many OTP requests. Please wait a few minutes or ask a staff member for help.' });
      return;
    }

    const patient = await patientForPrn(prn);
    const phone = patient?.phone ?? null;
    const otp = generateOtp();
    // A row is written for every request (unknown PRNs get an unusable hash)
    // so the per-IP / per-PRN throttles count lookups, not just sends.
    const challenge = await prisma.feedbackWalkUpOtp.create({
      data: {
        patientPrn,
        phoneLast4: phone ? last10(phone).slice(-4) : null,
        codeHash: phone ? sha256(otp) : sha256(crypto.randomBytes(32).toString('hex')),
        expiresAt: otpExpiry(),
        requestIp: ip.slice(0, 64),
      },
    });
    if (!patient || !phone) {
      res.status(200).json({ data: { message: WALKUP_GENERIC } });
      return;
    }
    const sent = await sendOtpSms(phone, patient.name, otp, 'Patient Feedback');
    if (!sent) {
      res.status(502).json({ message: 'We could not send the OTP right now. Please ask a staff member for help.' });
      return;
    }
    res.status(200).json({
      data: {
        message: WALKUP_GENERIC,
        challengeId: challenge.id,
        phoneLast4: challenge.phoneLast4,
        expiresAt: challenge.expiresAt,
      },
    });
  } catch (error) {
    console.error('[feedback] requestWalkUpOtp failed:', error);
    res.status(500).json({ message: 'Could not start your feedback — please ask a staff member for help.' });
  }
};

export const verifyWalkUpOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { challengeId?: unknown; otp?: unknown; visitType?: unknown };
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
    const otp = typeof body.otp === 'string' ? body.otp.trim() : String(body.otp ?? '');
    if (!challengeId || challengeId.length > 64 || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ message: 'Please enter the 6-digit OTP.' });
      return;
    }

    const row = await prisma.feedbackWalkUpOtp.findUnique({ where: { id: challengeId } });
    if (!row) { res.status(400).json({ message: 'This OTP is not valid. Please request a new one.' }); return; }
    if (row.consumedAt) { res.status(410).json({ message: 'This OTP has already been used. Please request a new one.' }); return; }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ message: 'Too many wrong attempts. Please request a new OTP.' });
      return;
    }
    if (row.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This OTP has expired. Please request a new one.' });
      return;
    }

    // Reserve an attempt atomically so parallel guesses can't exceed the cap.
    const reserved = await prisma.feedbackWalkUpOtp.updateMany({
      where: { id: row.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      res.status(429).json({ message: 'Too many wrong attempts. Please request a new OTP.' });
      return;
    }

    const given = Buffer.from(sha256(otp), 'hex');
    const stored = Buffer.from(row.codeHash, 'hex');
    const match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
    if (!match) {
      const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
      if (left <= 0) {
        res.status(429).json({ message: 'Too many wrong attempts. Please request a new OTP.' });
      } else {
        res.status(400).json({ message: `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`, attemptsLeft: left });
      }
      return;
    }

    const now = new Date();
    const consumed = await prisma.feedbackWalkUpOtp.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
      data: { verifiedAt: now, consumedAt: now },
    });
    if (consumed.count !== 1) {
      res.status(410).json({ message: 'This OTP has expired or was already used. Please request a new one.' });
      return;
    }

    // One walk-up survey per patient per 24h: resume a still-open one, refuse
    // a second submission (each low score raises a complaint + incident).
    const recent = await prisma.feedbackSurvey.findFirst({
      where: {
        patientPrn: row.patientPrn,
        respondedChannel: 'walk-up',
        createdAt: { gte: new Date(Date.now() - WALKUP_SURVEY_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, status: true, expiresAt: true },
    });
    if (recent?.status === 'completed') {
      res.status(429).json({ message: 'You have already shared your feedback today. Thank you!' });
      return;
    }
    if (recent && recent.status !== 'expired' && (!recent.expiresAt || recent.expiresAt > now)) {
      res.status(201).json({ data: { token: recent.token, id: recent.id } });
      return;
    }

    const patient = await patientForPrn(Number(row.patientPrn));
    const visitType = typeof body.visitType === 'string' ? body.visitType : 'general';
    const template = VISIT_TO_TEMPLATE[visitType] || 'general';
    const survey = await prisma.feedbackSurvey.create({
      data: {
        token: crypto.randomBytes(16).toString('hex'),
        template,
        patientPrn: row.patientPrn,
        patientName: patient?.name ?? null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // walk-up tokens expire same-day
        respondedChannel: 'walk-up',
      },
    });
    // No auditLog — no req.user on a public endpoint; the OTP + survey rows are the trail.
    res.status(201).json({ data: { token: survey.token, id: survey.id } });
  } catch (error) {
    console.error('[feedback] verifyWalkUpOtp failed:', error);
    res.status(500).json({ message: 'Could not start your feedback — please ask a staff member for help.' });
  }
};

// Phase 6d — manual triggers for the two new feedback crons.

export const triggerExpirySweep = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await runFeedbackExpirySweep();
    await auditLog(req, {
      module: 'feedback', action: 'EXPIRY_SWEEP', entityType: 'FeedbackSurvey',
      entityId: 'bulk', payload: { expired: report.expired },
    });
    res.status(200).json({ data: report });
  } catch (error) {
    console.error('[feedback] expiry-sweep failed:', error);
    res.status(500).json({ message: 'Expiry sweep failed' });
  }
};

export const triggerReminderSweep = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await runFeedbackReminderSweep();
    await auditLog(req, {
      module: 'feedback', action: 'REMINDER_SWEEP', entityType: 'FeedbackSurvey',
      entityId: 'bulk',
      payload: { checked: report.checked, reminded: report.reminded, failed: report.failed },
    });
    res.status(200).json({ data: report });
  } catch (error) {
    console.error('[feedback] reminder-sweep failed:', error);
    res.status(500).json({ message: 'Reminder sweep failed' });
  }
};
