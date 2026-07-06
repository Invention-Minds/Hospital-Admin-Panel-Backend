import type { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { raiseByRule } from '../incident/rule-catalogue';
import {
  findRelatedOpenIncidents, attachIncidentLinks, linkComplaintToIncident,
} from '../../service/incident-complaint-link';
import { runFeedbackExpirySweep } from './feedback-expiry.cron';
import { runFeedbackReminderSweep } from './feedback-reminder.cron';

// Phase 9.25 / Phase 4 — Feedback surveys.
//
// Surveys live behind a one-shot token: the URL /feedback/k/:token works on
// a phone or a kiosk without auth. submitByToken auto-raises a Complaint when
// NPS ≤ 6 and also fires the LOW_NPS_PATIENT_FEEDBACK incident rule at ≤ 3.

const VALID_TEMPLATES = ['opd-post-visit', 'ipd-discharge', 'er-discharge', 'day-care', 'general'] as const;

function nextComplaintCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `COMP-${year}-`;
  return prisma.complaint.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  }).then((last) => {
    const lastSeq = last ? parseInt(last.code.split('-').pop() || '0', 10) : 0;
    return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
  });
}

/** Severity buckets driven by NPS (industry-standard NPS classification). */
function severityFromNps(nps: number): 'low' | 'medium' | 'high' {
  if (nps <= 3) return 'high';
  if (nps <= 6) return 'medium';
  return 'low';
}

/** Hours of SLA on the auto-complaint. */
function slaHoursFor(severity: 'low' | 'medium' | 'high'): number {
  return severity === 'high' ? 24 : severity === 'medium' ? 72 : 168;
}

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
    const token = crypto.randomBytes(16).toString('hex');
    const expiresInDays = body.expiresInDays ?? 14;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const survey = await prisma.feedbackSurvey.create({
      data: {
        token,
        template: body.template,
        patientPrn: body.patientPrn ?? null,
        patientName: body.patientName ?? null,
        appointmentId: body.appointmentId ?? null,
        admissionId: body.admissionId ?? null,
        emergencyId: body.emergencyId ?? null,
        encounterDate: body.encounterDate ? new Date(body.encounterDate) : null,
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
    const from = req.query.from ? new Date(req.query.from as string) : null;
    const to = req.query.to ? new Date(req.query.to as string) : null;
    const rows = await prisma.feedbackSurvey.findMany({
      where: {
        ...(status && { status }),
        ...(template && { template }),
        ...(patientPrn && { patientPrn }),
        ...((from || to) && {
          createdAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[feedback] listSurveys failed:', error);
    res.status(500).json({ message: 'Failed to load surveys' });
  }
};

export const surveyStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const byStatus = await prisma.feedbackSurvey.groupBy({ by: ['status'], _count: { _all: true } });
    // NPS distribution among completed surveys.
    const completed = await prisma.feedbackSurvey.findMany({
      where: { status: 'completed', npsScore: { not: null } },
      select: { npsScore: true },
      take: 5000,
    });
    let promoters = 0, passives = 0, detractors = 0;
    for (const r of completed) {
      const s = r.npsScore!;
      if (s >= 9) promoters += 1;
      else if (s >= 7) passives += 1;
      else detractors += 1;
    }
    const total = completed.length;
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
        status: true, expiresAt: true, respondedAt: true,
        npsScore: true, comments: true,
      },
    });
    if (!row) { res.status(404).json({ message: 'Survey not found' }); return; }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This survey link has expired' });
      return;
    }
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[feedback] getSurveyByToken failed:', error);
    res.status(500).json({ message: 'Failed to fetch survey' });
  }
};

interface SubmitBody {
  npsScore?: number;
  satisfactionScores?: Record<string, number>;
  comments?: string;
  channel?: string;
}

export const submitSurveyByToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token;
    const body = req.body as SubmitBody;
    if (typeof body.npsScore !== 'number' || body.npsScore < 0 || body.npsScore > 10) {
      res.status(400).json({ message: 'npsScore must be a number 0..10' });
      return;
    }

    const existing = await prisma.feedbackSurvey.findUnique({ where: { token } });
    if (!existing) { res.status(404).json({ message: 'Survey not found' }); return; }
    if (existing.status === 'completed') { res.status(409).json({ message: 'Survey already submitted' }); return; }
    if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'Survey link expired' });
      return;
    }

    const willFlag = body.npsScore <= 6;
    const updated = await prisma.feedbackSurvey.update({
      where: { token },
      data: {
        npsScore: body.npsScore,
        satisfactionScores: body.satisfactionScores ? JSON.stringify(body.satisfactionScores) : null,
        comments: body.comments?.trim() || null,
        complaintFlag: willFlag,
        status: 'completed',
        respondedAt: new Date(),
        respondedChannel: body.channel || 'kiosk',
      },
    });

    // Phase 6 — capture the new Complaint.id so the auto-raised incident can
    // back-link to it (Option A: link, don't dedupe).
    let createdComplaintId: string | null = null;

    // Auto-raise a complaint when NPS ≤ 6.
    if (willFlag) {
      try {
        const severity = severityFromNps(body.npsScore);
        const slaDueAt = new Date(Date.now() + slaHoursFor(severity) * 60 * 60 * 1000);
        const code = await nextComplaintCode();
        const complaint = await prisma.complaint.create({
          data: {
            code,
            patientPrn: updated.patientPrn,
            patientName: updated.patientName,
            channel: 'survey-auto',
            source: 'survey',
            feedbackSurveyId: updated.id,
            description: `Auto-raised from feedback survey (NPS ${body.npsScore}). ${body.comments?.trim() ? 'Patient comment: "' + body.comments.trim() + '"' : 'No comment provided.'}`,
            severity,
            status: 'open',
            slaDueAt,
            // Phase 6 / Concern #4 — copy encounter FKs from the survey so the
            // dedup helper can find this complaint when a manual one lands.
            appointmentId: updated.appointmentId,
            admissionId: updated.admissionId,
            emergencyId: updated.emergencyId,
          },
        });
        createdComplaintId = complaint.id;
      } catch (e) {
        console.warn('[feedback] auto-complaint failed:', (e as Error).message);
      }
    }

    // Very low NPS — also fire the incident rule (Patient Experience review).
    // Phase 6 / Option A — wait for the rule to return so we can attach links
    // back to the survey + complaint + any pre-existing open incidents.
    if (body.npsScore <= 3) {
      try {
        const result = await raiseByRule('LOW_NPS_PATIENT_FEEDBACK', {
          patientPrn: updated.patientPrn,
          patientName: updated.patientName,
          appointmentId: updated.appointmentId,
          admissionId: updated.admissionId,
          emergencyId: updated.emergencyId,
          extras: { npsScore: body.npsScore, template: updated.template, surveyId: updated.id },
        });
        // Whether the rule created a fresh incident or matched an existing
        // one (24h dedup), we still link the new survey + auto-complaint to
        // *that* incident so the investigator sees them together.
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
        console.warn('[feedback] LOW_NPS incident linking failed:', (err as Error).message);
      }
    }

    res.status(200).json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    console.error('[feedback] submitSurveyByToken failed:', error);
    res.status(500).json({ message: 'Failed to submit survey' });
  }
};

// ── Phase 6 — Walk-up kiosk start. Patient scans a poster QR pointed at
// /feedback/new, enters their name (and optionally PRN), and the server
// mints a fresh FeedbackSurvey with a one-shot token. The FE then forwards
// the patient to /feedback/k/:token to actually fill it.
//
// Public (no auth). Lightly rate-limited by walking up to a kiosk being
// physically impractical at scale; for an internet-exposed deploy add IP
// rate limiting at the reverse proxy.

interface WalkUpBody {
  patientName?: string;
  patientPrn?: string | null;
  visitType?: string;   // opd | ipd | er | day-care | general
}

const VISIT_TO_TEMPLATE: Record<string, typeof VALID_TEMPLATES[number]> = {
  opd: 'opd-post-visit',
  ipd: 'ipd-discharge',
  er: 'er-discharge',
  'day-care': 'day-care',
  general: 'general',
};

export const walkUpStartSurvey = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as WalkUpBody;
    const name = (body.patientName || '').trim();
    if (name.length < 2) {
      res.status(400).json({ message: 'Please tell us your name.' });
      return;
    }
    const template = VISIT_TO_TEMPLATE[body.visitType || 'general'] || 'general';
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // walk-up tokens expire same-day

    const survey = await prisma.feedbackSurvey.create({
      data: {
        token,
        template,
        patientPrn: body.patientPrn?.trim() || null,
        patientName: name,
        status: 'pending',
        expiresAt,
        respondedChannel: 'walk-up',
      },
    });
    // No auditLog — no req.user on a public endpoint; the row itself is the trail.
    res.status(201).json({ data: { token: survey.token, id: survey.id } });
  } catch (error) {
    console.error('[feedback] walkUpStartSurvey failed:', error);
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
