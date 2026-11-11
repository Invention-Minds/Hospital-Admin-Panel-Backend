import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import {
  getFeedbackThresholds, thresholdsError, CHOICE_REASONS, doctorNameKey, type FeedbackThresholds,
} from '../../service/feedback-context';
import { categoryLabel } from '../../service/complaint-sla';

// Feedback analytics (eFeedor gap #2) + the editable thresholds.
//
//   GET /api/feedback/analytics?from&to&template&unitId   FEEDBACK_VIEWER
//   GET /api/feedback/config                             FEEDBACK_VIEWER
//   PUT /api/feedback/config                             Quality Manager
//
// Responses are counted on respondedAt; response rate on surveys created in
// the window. Everything is aggregated in memory over at most MAX_ROWS rows,
// which is plenty for one hospital's date window. No patient identifiers are
// returned — the low-score list carries only the comment and its context.

const TZ = 'Asia/Kolkata';
const MAX_ROWS = 20000;

interface Bucket {
  key: string;
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number;
  rated: number;          // responses that answered at least one question
  satisfied: number;      // of `rated`, those whose average rating ≥ threshold
  satisfiedPct: number | null;
  avgRating: number | null;
  ratingSum: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function newBucket(key: string): Bucket {
  return { key, responses: 0, promoters: 0, passives: 0, detractors: 0, nps: 0, rated: 0, satisfied: 0, satisfiedPct: null, avgRating: null, ratingSum: 0 };
}

function finish(b: Bucket): Bucket {
  b.nps = b.responses ? Math.round(((b.promoters - b.detractors) / b.responses) * 100) : 0;
  b.satisfiedPct = b.rated ? round1((b.satisfied / b.rated) * 100) : null;
  b.avgRating = b.rated ? round1(b.ratingSum / b.rated) : null;
  return b;
}

function parseScores(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, s]) => typeof s === 'number' && s >= 1 && s <= 5)) as Record<string, number>;
  } catch { return {}; }
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

function parseDay(v: string | undefined, end: boolean): Date | null | undefined {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const m = moment.tz(v, 'YYYY-MM-DD', true, TZ); // strict: 2026-13-01 is invalid
  if (!m.isValid()) return null;
  return (end ? m.endOf('day') : m.startOf('day')).toDate();
}

export const feedbackAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const toQ = parseDay(q.to, true);
    const fromQ = parseDay(q.from, false);
    if (toQ === null || fromQ === null) { res.status(400).json({ message: 'from / to must be YYYY-MM-DD' }); return; }
    const to = toQ ?? moment.tz(TZ).endOf('day').toDate();
    const from = fromQ ?? moment.tz(to, TZ).subtract(29, 'days').startOf('day').toDate();
    if (from > to) { res.status(400).json({ message: 'from must be on or before to' }); return; }
    const template = q.template && q.template !== 'all' ? q.template : undefined;
    const unitId = q.unitId && /^\d+$/.test(q.unitId) ? Number(q.unitId) : undefined;
    const scope = { ...(template && { template }), ...(unitId && { unitId }) };

    const t: FeedbackThresholds = await getFeedbackThresholds();
    const [rows, created] = await Promise.all([
      prisma.feedbackSurvey.findMany({
        where: { status: 'completed', npsScore: { not: null }, respondedAt: { gte: from, lte: to }, ...scope },
        select: {
          id: true, template: true, npsScore: true, satisfactionScores: true, comments: true, respondedAt: true,
          respondedChannel: true, language: true, department: true, doctorId: true, doctorName: true, wardName: true, unitId: true,
          collectedById: true, choiceReasons: true,
        },
        orderBy: { respondedAt: 'desc' },
        take: MAX_ROWS,
      }),
      prisma.feedbackSurvey.count({ where: { createdAt: { gte: from, lte: to }, ...scope } }),
    ]);
    const reviewClicks = await prisma.feedbackSurvey.count({ where: { reviewClickedAt: { gte: from, lte: to }, ...scope } });

    const overall = newBucket('all');
    const groups: Record<string, Map<string, Bucket>> = {
      department: new Map(), doctor: new Map(), ward: new Map(), unit: new Map(),
      channel: new Map(), language: new Map(), collector: new Map(), template: new Map(),
    };
    const questions = new Map<string, { key: string; count: number; sum: number; satisfied: number }>();
    const doctorLabels = new Map<string, string>();
    const reasons = new Map<string, number>();
    const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
    const periodFmt = spanDays > 92 ? 'YYYY-MM' : 'GGGG-[W]WW';
    const trend = new Map<string, Bucket>();

    const add = (b: Bucket, nps: number, avg: number | null) => {
      b.responses += 1;
      if (nps >= 9) b.promoters += 1; else if (nps >= 7) b.passives += 1; else b.detractors += 1;
      if (avg !== null) { b.rated += 1; b.ratingSum += avg; if (avg >= t.satisfiedMinRating) b.satisfied += 1; }
    };
    const into = (dim: string, key: string | null | undefined, nps: number, avg: number | null) => {
      if (key === undefined) return;
      const k = key === null || key === '' ? '—' : String(key);
      const m = groups[dim];
      const b = m.get(k) ?? newBucket(k);
      add(b, nps, avg);
      m.set(k, b);
    };

    for (const r of rows) {
      const nps = r.npsScore as number;
      const scores = parseScores(r.satisfactionScores);
      const vals = Object.values(scores);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      add(overall, nps, avg);
      into('department', r.department, nps, avg);
      // Doctor: the Doctor record when linked, else the normalised free-text
      // name, so "Dr. Priya Sharma" and "priya sharma" are one row.
      const docKey = r.doctorId != null ? `id:${r.doctorId}` : r.doctorName ? `name:${doctorNameKey(r.doctorName)}` : null;
      if (docKey) {
        if (!doctorLabels.has(docKey) || r.doctorId != null) doctorLabels.set(docKey, r.doctorName ?? `Doctor ${r.doctorId}`);
        into('doctor', docKey, nps, avg);
      }
      if (r.wardName) into('ward', r.wardName, nps, avg);
      into('unit', r.unitId != null ? String(r.unitId) : null, nps, avg);
      into('channel', r.respondedChannel, nps, avg);
      into('language', r.language ?? 'en', nps, avg);
      if (r.collectedById != null) into('collector', String(r.collectedById), nps, avg);
      into('template', r.template, nps, avg);
      for (const [k, s] of Object.entries(scores)) {
        const qb = questions.get(k) ?? { key: k, count: 0, sum: 0, satisfied: 0 };
        qb.count += 1; qb.sum += s; if (s >= t.satisfiedMinRating) qb.satisfied += 1;
        questions.set(k, qb);
      }
      for (const reason of parseList(r.choiceReasons)) {
        if ((CHOICE_REASONS as readonly string[]).includes(reason)) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      const period = moment(r.respondedAt).tz(TZ).format(periodFmt);
      const tb = trend.get(period) ?? newBucket(period);
      add(tb, nps, avg);
      trend.set(period, tb);
    }

    // Names for unit / collector ids.
    const unitIds = [...groups.unit.keys()].filter((k) => /^\d+$/.test(k)).map(Number);
    const collectorIds = [...groups.collector.keys()].map(Number);
    const [units, users] = await Promise.all([
      unitIds.length ? prisma.hospitalUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [],
      collectorIds.length ? prisma.user.findMany({ where: { id: { in: collectorIds } }, select: { id: true, username: true, fullName: true } }) : [],
    ]);
    const unitName = new Map(units.map((u) => [String(u.id), u.name]));
    const userName = new Map(users.map((u) => [String(u.id), u.fullName || u.username]));
    const label = (dim: string, k: string) =>
      dim === 'unit' ? (k === '—' ? 'Not assigned' : unitName.get(k) ?? `Unit ${k}`)
        : dim === 'collector' ? userName.get(k) ?? `User ${k}`
          : dim === 'doctor' ? doctorLabels.get(k) ?? k : k;

    const breakdowns = Object.fromEntries(Object.entries(groups).map(([dim, m]) => [
      dim,
      [...m.values()].map((b) => ({ ...finish(b), label: label(dim, b.key) }))
        .sort((a, b) => b.responses - a.responses),
    ]));

    // Complaint handling per unit (complaints raised in the window).
    const complaints = await prisma.complaint.findMany({
      where: { raisedAt: { gte: from, lte: to }, ...(unitId && { unitId }) },
      select: { unitId: true, status: true, raisedAt: true, resolvedAt: true, category: true, slaDueAt: true },
      take: MAX_ROWS,
    });
    const cUnitIds = [...new Set(complaints.map((c) => c.unitId).filter((x): x is number => x != null))]
      .filter((id) => !unitName.has(String(id)));
    if (cUnitIds.length) {
      for (const u of await prisma.hospitalUnit.findMany({ where: { id: { in: cUnitIds } }, select: { id: true, name: true } })) {
        unitName.set(String(u.id), u.name);
      }
    }
    const cMap = new Map<string, { key: string; total: number; resolved: number; hoursSum: number }>();
    for (const c of complaints) {
      const k = c.unitId != null ? String(c.unitId) : '—';
      const e = cMap.get(k) ?? { key: k, total: 0, resolved: 0, hoursSum: 0 };
      e.total += 1;
      if (c.status === 'resolved' && c.resolvedAt) {
        e.resolved += 1;
        e.hoursSum += (c.resolvedAt.getTime() - c.raisedAt.getTime()) / 3_600_000;
      }
      cMap.set(k, e);
    }
    const complaintsByUnit = [...cMap.values()].map((e) => ({
      key: e.key, label: label('unit', e.key), total: e.total, resolved: e.resolved,
      resolutionRate: e.total ? round1((e.resolved / e.total) * 100) : 0,
      avgResolutionHours: e.resolved ? round1(e.hoursSum / e.resolved) : null,
    })).sort((a, b) => b.total - a.total);

    // Complaints by type — volume, resolution time and how many met their deadline.
    const tMap = new Map<string, { total: number; resolved: number; hoursSum: number; onTime: number; overdueOpen: number }>();
    const nowMs = Date.now();
    for (const c of complaints) {
      const k = c.category ?? '—';
      const e = tMap.get(k) ?? { total: 0, resolved: 0, hoursSum: 0, onTime: 0, overdueOpen: 0 };
      e.total += 1;
      if (c.status === 'resolved' && c.resolvedAt) {
        e.resolved += 1;
        e.hoursSum += (c.resolvedAt.getTime() - c.raisedAt.getTime()) / 3_600_000;
        if (!c.slaDueAt || c.resolvedAt <= c.slaDueAt) e.onTime += 1;
      } else if (c.slaDueAt && c.slaDueAt.getTime() < nowMs) {
        e.overdueOpen += 1;
      }
      tMap.set(k, e);
    }
    const complaintsByType = [...tMap.entries()].map(([key, e]) => ({
      key, label: key === '—' ? 'Not set' : categoryLabel(key) ?? key, total: e.total, resolved: e.resolved,
      avgResolutionHours: e.resolved ? round1(e.hoursSum / e.resolved) : null,
      onTimePct: e.resolved ? round1((e.onTime / e.resolved) * 100) : null,
      overdueOpen: e.overdueOpen,
    })).sort((a, b) => b.total - a.total);

    const lowScores = rows
      .filter((r) => (r.npsScore as number) <= t.complaintMaxNps && r.comments)
      .slice(0, 25)
      .map((r) => ({
        id: r.id, respondedAt: r.respondedAt, npsScore: r.npsScore, template: r.template,
        department: r.department, wardName: r.wardName, comment: r.comments,
      }));

    res.status(200).json({
      window: { from, to }, thresholds: t,
      summary: {
        ...finish(overall), surveysCreated: created,
        responseRate: created ? round1((rows.length / created) * 100) : null,
        truncated: rows.length >= MAX_ROWS,
        reviewClicks,
      },
      trend: [...trend.values()].map(finish).sort((a, b) => a.key.localeCompare(b.key)),
      byQuestion: [...questions.values()].map((qb) => ({
        key: qb.key, count: qb.count, avg: round1(qb.sum / qb.count), satisfiedPct: round1((qb.satisfied / qb.count) * 100),
      })).sort((a, b) => a.avg - b.avg),
      choiceReasons: CHOICE_REASONS.map((k) => ({ key: k, count: reasons.get(k) ?? 0 })).sort((a, b) => b.count - a.count),
      breakdowns,
      complaintsByUnit,
      complaintsByType,
      lowScores,
    });
  } catch (error) {
    console.error('[feedback] analytics failed:', error);
    res.status(500).json({ message: 'Failed to load feedback analytics' });
  }
};

/** Google review link must be a plain https URL (it is opened from a public page). */
function reviewUrlError(v: unknown): string | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 500) return 'googleReviewUrl must be a link of at most 500 characters';
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? null : 'googleReviewUrl must start with https://';
  } catch { return 'googleReviewUrl is not a valid link'; }
}

export const getFeedbackConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.feedbackConfig.findUnique({ where: { id: 1 }, select: { googleReviewUrl: true } });
    res.status(200).json({ data: { ...(await getFeedbackThresholds()), googleReviewUrl: row?.googleReviewUrl ?? null } });
  } catch (error) {
    console.error('[feedback] getConfig failed:', error);
    res.status(500).json({ message: 'Failed to load feedback settings' });
  }
};

export const updateFeedbackConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const before = await getFeedbackThresholds();
    const b = req.body ?? {};
    const next: FeedbackThresholds = {
      satisfiedMinRating: b.satisfiedMinRating ?? before.satisfiedMinRating,
      complaintMaxNps: b.complaintMaxNps ?? before.complaintMaxNps,
      incidentMaxNps: b.incidentMaxNps ?? before.incidentMaxNps,
    };
    const err = thresholdsError(next);
    if (err) { res.status(400).json({ message: err }); return; }
    const urlErr = b.googleReviewUrl !== undefined ? reviewUrlError(b.googleReviewUrl) : null;
    if (urlErr) { res.status(400).json({ message: urlErr }); return; }
    const reviewPatch = b.googleReviewUrl !== undefined ? { googleReviewUrl: (b.googleReviewUrl as string | null)?.trim() || null } : {};
    const updatedById = typeof req.user?.id === 'number' ? req.user.id : null;
    const row = await prisma.feedbackConfig.upsert({
      where: { id: 1 }, create: { id: 1, ...next, ...reviewPatch, updatedById }, update: { ...next, ...reviewPatch, updatedById },
    });
    await auditLog(req, { module: 'feedback', action: 'UPDATE', entityType: 'FeedbackConfig', entityId: '1', payload: { before, after: next, ...reviewPatch } });
    res.status(200).json({ data: { ...next, googleReviewUrl: row.googleReviewUrl } });
  } catch (error) {
    console.error('[feedback] updateConfig failed:', error);
    res.status(500).json({ message: 'Failed to save feedback settings' });
  }
};
