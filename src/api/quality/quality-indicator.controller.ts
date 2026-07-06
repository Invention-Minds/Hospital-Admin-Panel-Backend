import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { QI_CATALOGUE, getQiDef } from './quality-indicator-catalogue';
import { evaluateForDef, shouldCreateRca } from './quality-status-engine';
import { runAutoSourceForPeriod, autoSourceCoverage } from './quality-indicator-auto.cron';
import { runDataQualitySweep } from './quality-data-quality';
import { ensureRcaForRecord, bridgeCriticalQiToIncident, checkTrendForRecord } from './quality-rca.controller';

// Phase 9.26 / Phase 1 — NABH/QCI Quality Indicator CRUD + capture.
//
// Read endpoints expose the indicator master + recent records. Write endpoints
// capture monthly numerator/denominator pairs and auto-evaluate Green/Amber/
// Red/Critical against the configured benchmark + direction (status engine).
//
// Auto-sourcing from Incident / Complaint / FeedbackSurvey is Phase 2 — for
// now everything is manual capture. The DB-backed QualityIndicator row mirrors
// the static catalogue so admins can disable/edit a row without code changes.

// ─── Period helpers ──────────────────────────────────────────────────────

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface PeriodWindow { period: string; periodStart: Date; periodEnd: Date }

function parsePeriod(raw: string | undefined): PeriodWindow | null {
  if (!raw) return null;
  const day = DAY_RE.exec(raw);
  if (day) {
    const [, yr, mo, d] = day;
    const start = new Date(Number(yr), Number(mo) - 1, Number(d), 0, 0, 0);
    const end = new Date(Number(yr), Number(mo) - 1, Number(d), 23, 59, 59, 999);
    return { period: raw, periodStart: start, periodEnd: end };
  }
  const month = MONTH_RE.exec(raw);
  if (month) {
    const [, yr, mo] = month;
    const start = new Date(Number(yr), Number(mo) - 1, 1, 0, 0, 0);
    const end = new Date(Number(yr), Number(mo), 0, 23, 59, 59, 999); // last day of month
    return { period: raw, periodStart: start, periodEnd: end };
  }
  return null;
}

// ─── List + detail ───────────────────────────────────────────────────────

export const listIndicators = async (req: Request, res: Response): Promise<void> => {
  try {
    const { chapter, department, active, search } = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = {};
    if (chapter) where['chapter'] = chapter;
    if (department) where['department'] = department;
    if (active === 'true') where['isActive'] = true;
    if (active === 'false') where['isActive'] = false;
    if (search) {
      where['OR'] = [
        { name: { contains: search } },
        { qiCode: { contains: search } },
      ];
    }

    const rows = await prisma.qualityIndicator.findMany({
      where,
      orderBy: [{ chapter: 'asc' }, { qiCode: 'asc' }],
    });

    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[quality-indicator] list failed:', error);
    res.status(500).json({ message: 'Failed to load indicators' });
  }
};

export const getIndicator = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qiCode } = req.params;
    const indicator = await prisma.qualityIndicator.findUnique({
      where: { qiCode },
      include: {
        records: { orderBy: { periodStart: 'desc' }, take: 12, include: { rca: true } },
      },
    });
    if (!indicator) {
      res.status(404).json({ message: 'Indicator not found' });
      return;
    }
    res.status(200).json({ data: indicator });
  } catch (error) {
    console.error('[quality-indicator] detail failed:', error);
    res.status(500).json({ message: 'Failed to load indicator' });
  }
};

// ─── Stats — chapter-level rollup for the dashboard tile ─────────────────

export const getIndicatorStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const indicators = await prisma.qualityIndicator.findMany({
      select: { id: true, qiCode: true, chapter: true, isActive: true, isCritical: true },
    });
    const total = indicators.length;
    const active = indicators.filter((i) => i.isActive).length;
    const critical = indicators.filter((i) => i.isCritical).length;

    const byChapter: Record<string, number> = {};
    for (const i of indicators) {
      byChapter[i.chapter] = (byChapter[i.chapter] ?? 0) + 1;
    }

    // Look at the most recent period actually captured — uses raw groupBy.
    const latest = await prisma.qualityIndicatorRecord.findFirst({
      orderBy: { periodStart: 'desc' },
      select: { period: true },
    });
    const recordsByStatus = latest
      ? await prisma.qualityIndicatorRecord.groupBy({
          by: ['status'],
          where: { period: latest.period },
          _count: { _all: true },
        })
      : [];

    res.status(200).json({
      total, active, critical,
      byChapter,
      latestPeriod: latest?.period ?? null,
      latestPeriodStatus: Object.fromEntries(recordsByStatus.map((g) => [g.status, g._count._all])),
    });
  } catch (error) {
    console.error('[quality-indicator] stats failed:', error);
    res.status(500).json({ message: 'Failed to load indicator stats' });
  }
};

// ─── Capture a record ────────────────────────────────────────────────────

interface CaptureBody {
  period?: string;
  numerator?: number;
  denominator?: number;
  remarks?: string;
  criticalTriggered?: boolean;
  evidenceLinks?: Array<{ label: string; url: string }>;
  benchmarkOverride?: number | null;
}

export const captureRecord = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qiCode } = req.params;
    const body = (req.body ?? {}) as CaptureBody;

    const indicator = await prisma.qualityIndicator.findUnique({ where: { qiCode } });
    if (!indicator) {
      res.status(404).json({ message: 'Indicator not found' });
      return;
    }
    if (!indicator.isActive) {
      res.status(400).json({ message: 'Indicator is inactive — enable it before capturing records' });
      return;
    }

    const window = parsePeriod(body.period);
    if (!window) {
      res.status(400).json({ message: "Field 'period' must be YYYY-MM or YYYY-MM-DD" });
      return;
    }
    if (typeof body.numerator !== 'number' || typeof body.denominator !== 'number') {
      res.status(400).json({ message: "Fields 'numerator' and 'denominator' are required and must be numbers" });
      return;
    }
    if (body.denominator < 0 || body.numerator < 0) {
      res.status(400).json({ message: 'Numerator and denominator must be non-negative' });
      return;
    }

    // Resolve catalogue def for status evaluation (DB row may have been edited).
    const def = getQiDef(qiCode);
    if (!def) {
      res.status(500).json({ message: 'Indicator definition missing from catalogue — seed mismatch' });
      return;
    }

    const benchmarkToUse = body.benchmarkOverride !== undefined
      ? body.benchmarkOverride
      : indicator.defaultBenchmark;

    const evalResult = evaluateForDef(
      def,
      body.numerator,
      body.denominator,
      benchmarkToUse ?? null,
      body.criticalTriggered === true,
    );

    const username = req.user?.username ?? null;
    const userId = typeof req.user?.id === 'number' ? req.user.id : null;

    const record = await prisma.qualityIndicatorRecord.upsert({
      where: { indicatorId_period: { indicatorId: indicator.id, period: window.period } },
      create: {
        indicatorId: indicator.id,
        qiCode: indicator.qiCode,
        period: window.period,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        numerator: body.numerator,
        denominator: body.denominator,
        calculatedValue: Number.isFinite(evalResult.value) ? evalResult.value : 0,
        benchmarkUsed: benchmarkToUse,
        status: evalResult.status,
        severity: evalResult.severity,
        autoCalculated: false,
        capturedBy: username,
        capturedById: userId,
        remarks: body.remarks ?? null,
        evidenceLinks: body.evidenceLinks ? JSON.stringify(body.evidenceLinks) : null,
      },
      update: {
        numerator: body.numerator,
        denominator: body.denominator,
        calculatedValue: Number.isFinite(evalResult.value) ? evalResult.value : 0,
        benchmarkUsed: benchmarkToUse,
        status: evalResult.status,
        severity: evalResult.severity,
        capturedBy: username,
        capturedById: userId,
        remarks: body.remarks ?? null,
        evidenceLinks: body.evidenceLinks ? JSON.stringify(body.evidenceLinks) : null,
      },
    });

    await auditLog(req, {
      module: 'quality-indicator', action: 'CAPTURE', entityType: 'QualityIndicatorRecord',
      entityId: String(record.id),
      payload: {
        qiCode, period: window.period, value: evalResult.value,
        status: evalResult.status, benchmark: benchmarkToUse,
      },
    });

    // Phase 3 — auto-RCA on red/critical (per the indicator's rcaRequiredRule).
    if (shouldCreateRca(indicator.rcaRequiredRule as never, evalResult.status)) {
      void ensureRcaForRecord({
        recordId: record.id,
        qiCode: indicator.qiCode,
        escalationOwner: indicator.escalationOwner,
      });
    }

    // Phase 4 — trend check: 2 consecutive Red/Critical → trend-class RCA.
    void checkTrendForRecord({
      indicatorId: indicator.id,
      qiCode: indicator.qiCode,
      recordId: record.id,
      recordStatus: evalResult.status,
      period: window.period,
      rcaRequiredRule: indicator.rcaRequiredRule,
      escalationOwner: indicator.escalationOwner,
    });

    // Phase 3 — critical-tier capture also raises an incident (zero-tolerance).
    if (evalResult.status === 'critical') {
      void bridgeCriticalQiToIncident({
        qiCode: indicator.qiCode,
        chapter: indicator.chapter as never,
        indicatorName: indicator.name,
        period: window.period,
        calculatedValue: evalResult.value,
        unit: indicator.unit,
        nabhClause: indicator.nabhClause,
        criticalRule: indicator.criticalRule,
      });
    }

    res.status(201).json({ data: record });
  } catch (error) {
    console.error('[quality-indicator] capture failed:', error);
    res.status(500).json({ message: 'Failed to capture indicator record' });
  }
};

// ─── Admin edits (toggle active, override benchmark) ─────────────────────

interface UpdateIndicatorBody {
  isActive?: boolean;
  defaultBenchmark?: number | null;
  amberThresholdPct?: number;
  escalationOwner?: string;
  notes?: string | null;
}

export const updateIndicator = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qiCode } = req.params;
    const body = (req.body ?? {}) as UpdateIndicatorBody;

    const indicator = await prisma.qualityIndicator.findUnique({ where: { qiCode } });
    if (!indicator) {
      res.status(404).json({ message: 'Indicator not found' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (typeof body.isActive === 'boolean') data['isActive'] = body.isActive;
    if (body.defaultBenchmark !== undefined) data['defaultBenchmark'] = body.defaultBenchmark;
    if (typeof body.amberThresholdPct === 'number') {
      if (body.amberThresholdPct < 0 || body.amberThresholdPct > 100) {
        res.status(400).json({ message: 'amberThresholdPct must be between 0 and 100' });
        return;
      }
      data['amberThresholdPct'] = body.amberThresholdPct;
    }
    if (typeof body.escalationOwner === 'string') data['escalationOwner'] = body.escalationOwner;
    if (body.notes !== undefined) data['notes'] = body.notes;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ message: 'No editable fields provided' });
      return;
    }

    const updated = await prisma.qualityIndicator.update({ where: { qiCode }, data });

    await auditLog(req, {
      module: 'quality-indicator', action: 'UPDATE', entityType: 'QualityIndicator',
      entityId: String(updated.id), payload: { qiCode, ...data },
    });

    res.status(200).json({ data: updated });
  } catch (error) {
    console.error('[quality-indicator] update failed:', error);
    res.status(500).json({ message: 'Failed to update indicator' });
  }
};

// ─── Catalogue resync — surfaces any new indicators added in code ────────

// ─── Phase 2 — manual trigger for the auto-source cron ──────────────────

interface AutoSourceBody { period?: string }

export const triggerAutoSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as AutoSourceBody;
    if (body.period && !/^\d{4}-\d{2}$/.test(body.period)) {
      res.status(400).json({ message: "Field 'period' must be YYYY-MM" });
      return;
    }
    const report = await runAutoSourceForPeriod(body.period);

    await auditLog(req, {
      module: 'quality-indicator', action: 'AUTO_SOURCE', entityType: 'QualityIndicatorRecord',
      entityId: report.period,
      payload: { period: report.period, written: report.written, failed: report.failed },
    });

    res.status(200).json({ data: report });
  } catch (error) {
    console.error('[quality-indicator] auto-source failed:', error);
    res.status(500).json({ message: 'Auto-source run failed' });
  }
};

export const autoSourceInfo = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ data: autoSourceCoverage() });
};

// Phase 4 — manual data-quality sweep.

interface DqBody { force?: boolean }

export const triggerDataQualitySweep = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as DqBody;
    const report = await runDataQualitySweep({ force: body.force === true });
    await auditLog(req, {
      module: 'quality-indicator', action: 'DQ_SWEEP', entityType: 'QualityIndicator',
      entityId: report.period,
      payload: { period: report.period, missing: report.missing, notifiedFresh: report.notifiedFresh },
    });
    res.status(200).json({ data: report });
  } catch (error) {
    console.error('[quality-indicator] data-quality sweep failed:', error);
    res.status(500).json({ message: 'Data-quality sweep failed' });
  }
};

export const catalogueSummary = async (_req: Request, res: Response): Promise<void> => {
  try {
    const dbCodes = new Set(
      (await prisma.qualityIndicator.findMany({ select: { qiCode: true } })).map((r) => r.qiCode),
    );
    const catalogueCodes = QI_CATALOGUE.map((d) => d.qiCode);
    const missingInDb = catalogueCodes.filter((c) => !dbCodes.has(c));
    res.status(200).json({
      catalogueCount: catalogueCodes.length,
      dbCount: dbCodes.size,
      missingInDb,
      note: missingInDb.length > 0
        ? 'Run `npm run seed:quality-indicators` to sync the missing rows.'
        : 'Catalogue and DB are in sync.',
    });
  } catch (error) {
    console.error('[quality-indicator] catalogue summary failed:', error);
    res.status(500).json({ message: 'Failed to summarise catalogue' });
  }
};
