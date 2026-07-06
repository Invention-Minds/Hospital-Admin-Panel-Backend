import prisma from '../../service/prisma-client';
import { QI_INDEX, getQiDef } from './quality-indicator-catalogue';
import { evaluateForDef, shouldCreateRca } from './quality-status-engine';
import { AUTO_SOURCE_REGISTRY, AUTO_SOURCE_CODES } from './quality-indicator-auto-source';
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

/** Resolve 'YYYY-MM' (default: previous month) to start/end timestamps. */
export function resolveMonth(period?: string): PeriodWindow {
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const [yr, mo] = period.split('-').map(Number);
    return {
      period,
      periodStart: new Date(yr, mo - 1, 1, 0, 0, 0),
      periodEnd: new Date(yr, mo, 0, 23, 59, 59, 999),
    };
  }
  // Default: previous calendar month.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const periodStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  return { period: periodStr, periodStart: start, periodEnd: end };
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

export async function runAutoSourceForPeriod(period?: string): Promise<AutoSourceReport> {
  const window = resolveMonth(period);
  const report: AutoSourceReport = {
    period: window.period,
    processed: 0, written: 0, skippedManual: 0, skippedNoData: 0, failed: 0,
    details: [],
  };

  for (const qiCode of AUTO_SOURCE_CODES) {
    report.processed += 1;
    try {
      const def = getQiDef(qiCode);
      if (!def) {
        report.failed += 1;
        report.details.push({ qiCode, outcome: 'failed', error: 'catalogue def missing' });
        continue;
      }

      const indicator = await prisma.qualityIndicator.findUnique({ where: { qiCode } });
      if (!indicator) {
        report.failed += 1;
        report.details.push({ qiCode, outcome: 'failed', error: 'DB row missing — run seed' });
        continue;
      }
      if (!indicator.isActive) {
        report.skippedNoData += 1;
        report.details.push({ qiCode, outcome: 'skipped-no-data', error: 'indicator inactive' });
        continue;
      }

      // Honour manual captures — never clobber a row a human entered.
      const existing = await prisma.qualityIndicatorRecord.findUnique({
        where: { indicatorId_period: { indicatorId: indicator.id, period: window.period } },
        select: { id: true, autoCalculated: true },
      });
      if (existing && !existing.autoCalculated) {
        report.skippedManual += 1;
        report.details.push({ qiCode, outcome: 'skipped-manual' });
        continue;
      }

      const sourceFn = AUTO_SOURCE_REGISTRY[qiCode];
      const source = await sourceFn(window.periodStart, window.periodEnd);
      if (!source) {
        report.skippedNoData += 1;
        report.details.push({ qiCode, outcome: 'skipped-no-data' });
        continue;
      }

      const evalResult = evaluateForDef(
        def,
        source.numerator,
        source.denominator,
        indicator.defaultBenchmark ?? null,
        false,
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

      report.written += 1;
      report.details.push({ qiCode, outcome: 'written', status: evalResult.status, value: evalResult.value });

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
    } catch (err) {
      report.failed += 1;
      report.details.push({ qiCode, outcome: 'failed', error: (err as Error).message });
      console.warn(`[qi-auto-source:${qiCode}] failed:`, (err as Error).message);
    }
  }
  return report;
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
