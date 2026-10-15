import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { QI_INDEX, getQiDef } from './quality-indicator-catalogue';
import { evaluateForDef, shouldCreateRca } from './quality-status-engine';
import { AUTO_SOURCE_REGISTRY, AUTO_SOURCE_CODES, QI_TZ, monthWindow } from './quality-indicator-auto-source';
import { ensureRcaForRecord, bridgeCriticalQiToIncident, checkTrendForRecord } from './quality-rca.controller';

// Phase 9.26 / Phase 2 — monthly auto-source cron for derivable QI records.
//
// Strategy:
//   • Cron fires 02:00 on the 1st of each month, computes the previous month.
//   • For each indicator in AUTO_SOURCE_REGISTRY, runs the source fn, evaluates
//     status via the engine, upserts a QualityIndicatorRecord.
//   • Manual captures win: if a row exists with autoCalculated=false, we skip
//     to preserve the human entry. autoCalculated=true rows are overwritten
//     (re-runs are safe).
//   • Re-entry guarded — a stuck sweep won't stack.

// ─── Period helpers ──────────────────────────────────────────────────────

export interface PeriodWindow { period: string; periodStart: Date; periodEnd: Date }

/** Resolve 'YYYY-MM' (default: previous month) to hospital-local (IST) start/end. */
export function resolveMonth(period?: string): PeriodWindow {
  const key = period && monthWindow(period)
    ? period
    : moment.tz(QI_TZ).subtract(1, 'month').format('YYYY-MM');
  return { period: key, ...monthWindow(key)! };
}

// ─── Runner ──────────────────────────────────────────────────────────────

export interface AutoSourceReport {
  period: string;
  processed: number;
  written: number;
  skippedManual: number;
  skippedNoData: number;
  failed: number;
  details: Array<{ qiCode: string; outcome: 'written' | 'skipped-manual' | 'skipped-no-data' | 'failed'; status?: string; value?: number; error?: string }>;
}

type Detail = AutoSourceReport['details'][number];

/** Run one auto-sourced indicator for a resolved month. Never throws. */
async function runOne(qiCode: string, window: PeriodWindow): Promise<Detail> {
  try {
    const def = getQiDef(qiCode);
    const sourceFn = AUTO_SOURCE_REGISTRY[qiCode];
    if (!def || !sourceFn) return { qiCode, outcome: 'failed', error: 'catalogue def or source missing' };

    const indicator = await prisma.qualityIndicator.findUnique({ where: { qiCode } });
    if (!indicator) return { qiCode, outcome: 'failed', error: 'DB row missing — run seed' };
    if (!indicator.isActive) return { qiCode, outcome: 'skipped-no-data', error: 'indicator inactive' };

    // Honour manual captures — never clobber a row a human entered.
    const existing = await prisma.qualityIndicatorRecord.findUnique({
      where: { indicatorId_period: { indicatorId: indicator.id, period: window.period } },
      select: { id: true, autoCalculated: true },
    });
    if (existing && !existing.autoCalculated) return { qiCode, outcome: 'skipped-manual' };

    const source = await sourceFn(window.periodStart, window.periodEnd);
    if (!source) return { qiCode, outcome: 'skipped-no-data' };

    const evalResult = evaluateForDef(
      def,
      source.numerator,
      source.denominator,
      indicator.defaultBenchmark ?? null,
      false,
      indicator.amberThresholdPct,
    );

    const recordRow = await prisma.qualityIndicatorRecord.upsert({
      where: { indicatorId_period: { indicatorId: indicator.id, period: window.period } },
      create: {
        indicatorId: indicator.id,
        qiCode: indicator.qiCode,
        period: window.period,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        numerator: source.numerator,
        denominator: source.denominator,
        calculatedValue: Number.isFinite(evalResult.value) ? evalResult.value : 0,
        benchmarkUsed: indicator.defaultBenchmark,
        status: evalResult.status,
        severity: evalResult.severity,
        autoCalculated: true,
        capturedBy: 'system-auto-source',
        capturedById: null,
        remarks: null,
      },
      update: {
        numerator: source.numerator,
        denominator: source.denominator,
        calculatedValue: Number.isFinite(evalResult.value) ? evalResult.value : 0,
        benchmarkUsed: indicator.defaultBenchmark,
        status: evalResult.status,
        severity: evalResult.severity,
        autoCalculated: true,
        capturedBy: 'system-auto-source',
      },
    });

    // Phase 3 — auto-RCA + critical-tier incident bridge.
    if (shouldCreateRca(indicator.rcaRequiredRule as never, evalResult.status)) {
      await ensureRcaForRecord({
        recordId: recordRow.id,
        qiCode: indicator.qiCode,
        escalationOwner: indicator.escalationOwner,
      });
    }
    await checkTrendForRecord({
      indicatorId: indicator.id,
      qiCode: indicator.qiCode,
      recordId: recordRow.id,
      recordStatus: evalResult.status,
      period: window.period,
      rcaRequiredRule: indicator.rcaRequiredRule,
      escalationOwner: indicator.escalationOwner,
    });

    if (evalResult.status === 'critical') {
      await bridgeCriticalQiToIncident({
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

    return { qiCode, outcome: 'written', status: evalResult.status, value: evalResult.value };
  } catch (err) {
    console.warn(`[qi-auto-source:${qiCode}] failed:`, (err as Error).message);
    return { qiCode, outcome: 'failed', error: (err as Error).message };
  }
}

function tally(report: AutoSourceReport, d: Detail): void {
  report.processed += 1;
  if (d.outcome === 'written') report.written += 1;
  else if (d.outcome === 'skipped-manual') report.skippedManual += 1;
  else if (d.outcome === 'skipped-no-data') report.skippedNoData += 1;
  else report.failed += 1;
  report.details.push(d);
}

export async function runAutoSourceForPeriod(period?: string, qiCodes?: string[]): Promise<AutoSourceReport> {
  const window = resolveMonth(period);
  const report: AutoSourceReport = {
    period: window.period,
    processed: 0, written: 0, skippedManual: 0, skippedNoData: 0, failed: 0,
    details: [],
  };
  const codes = qiCodes ? qiCodes.filter((c) => AUTO_SOURCE_REGISTRY[c]) : AUTO_SOURCE_CODES;
  for (const qiCode of codes) {
    tally(report, await runOne(qiCode, window));
  }
  return report;
}

/** Indicators whose auto-source reads the manual denominator for `qiCode` (keyed 1-1). */
export function indicatorsUsingDenominator(qiCode: string): string[] {
  return AUTO_SOURCE_REGISTRY[qiCode] ? [qiCode] : [];
}

// Light no-op so a future caller can check the registry without hitting DB.
export function autoSourceCoverage(): { total: number; codes: string[]; missingInCatalogue: string[] } {
  const missing = AUTO_SOURCE_CODES.filter((c) => !QI_INDEX[c]);
  return { total: AUTO_SOURCE_CODES.length, codes: AUTO_SOURCE_CODES, missingInCatalogue: missing };
}

// ─── Cron registration (mirrors registerIncidentRulesCron) ───────────────

export const registerQualityAutoSourceCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  // 02:00 on the 1st of every month — computes the previous month.
  cron.schedule('0 2 1 * *', async () => {
    if (isRunning) { console.log('[qi-auto-source] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const report = await runAutoSourceForPeriod();
      console.log(
        `[qi-auto-source] ${report.period} — written ${report.written}, ` +
        `skipped(manual) ${report.skippedManual}, skipped(no-data) ${report.skippedNoData}, ` +
        `failed ${report.failed}, processed ${report.processed}`,
      );
    } catch (err) {
      console.error('Error in qi-auto-source cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Quality indicator auto-source cron initialized (monthly, 02:00 on the 1st)');
};
