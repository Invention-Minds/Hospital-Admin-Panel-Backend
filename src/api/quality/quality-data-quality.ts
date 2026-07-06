import prisma from '../../service/prisma-client';
import { resolveTargetRole } from '../../service/role-alias';

// Phase 9.26 / Phase 4 — data-quality sweep.
//
// Walks every active monthly indicator and checks whether a record exists
// for the previous completed month. If not, fires a 'qi_data_missing'
// notification to the escalation owner. Acts as the "no one captured this"
// safety net — auto-sourced indicators self-populate, but the ~94 manual
// ones can silently rot otherwise.
//
// Grace window: we skip the sweep during the first 5 days of a new month so
// nobody gets pinged before the QI committee has had a chance to capture.

const GRACE_DAYS_INTO_MONTH = 5;
const NOTIFICATION_DEDUPE_KEY_PREFIX = 'qi_data_missing';

export interface DqReport {
  period: string;
  total: number;
  missing: number;
  skippedManual: number;
  notifiedFresh: number;
  notifiedAlreadyOpen: number;
  skippedReason?: string;
  details: Array<{ qiCode: string; chapter: string; escalationOwner: string }>;
}

function previousCompletedMonth(): { period: string; year: number; month: number } {
  const now = new Date();
  // previous month's year/month (zero-indexed in JS, so we subtract 1 then format)
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    year: d.getFullYear(),
    month: d.getMonth() + 1,
  };
}

export async function runDataQualitySweep(opts?: { force?: boolean }): Promise<DqReport> {
  const { period } = previousCompletedMonth();

  const dayOfMonth = new Date().getDate();
  if (!opts?.force && dayOfMonth <= GRACE_DAYS_INTO_MONTH) {
    return {
      period,
      total: 0, missing: 0, skippedManual: 0,
      notifiedFresh: 0, notifiedAlreadyOpen: 0,
      skippedReason: `Within ${GRACE_DAYS_INTO_MONTH}-day grace window — pass force=true to run anyway.`,
      details: [],
    };
  }

  // Only "Monthly" indicators warrant a "missing" alert. Event-based ones
  // (e.g. PSQ-029 sentinel count) can legitimately have no row when nothing
  // happened — and the auto-source cron already writes a 0 for sentinel.
  const indicators = await prisma.qualityIndicator.findMany({
    where: { isActive: true, frequency: { contains: 'Monthly' } },
    select: {
      id: true, qiCode: true, chapter: true, escalationOwner: true,
    },
  });

  const report: DqReport = {
    period,
    total: indicators.length, missing: 0, skippedManual: 0,
    notifiedFresh: 0, notifiedAlreadyOpen: 0,
    details: [],
  };

  for (const ind of indicators) {
    const hasRecord = await prisma.qualityIndicatorRecord.findUnique({
      where: { indicatorId_period: { indicatorId: ind.id, period } },
      select: { id: true, autoCalculated: true },
    });
    if (hasRecord) {
      if (!hasRecord.autoCalculated) report.skippedManual += 1;
      continue;
    }

    report.missing += 1;
    report.details.push({ qiCode: ind.qiCode, chapter: ind.chapter, escalationOwner: ind.escalationOwner });

    // De-dupe by entityType — one open 'qi_data_missing' notification per
    // (indicator, period) at a time. The bell row pattern from the incident
    // module uses entityType="<Model>:<id>" so we follow it.
    const entityType = `${NOTIFICATION_DEDUPE_KEY_PREFIX}:${ind.qiCode}:${period}`;
    const existingBell = await prisma.notification.findFirst({
      where: { entityType, status: { not: 'read' } },
      select: { id: true },
    }).catch(() => null);

    if (existingBell) {
      report.notifiedAlreadyOpen += 1;
      continue;
    }

    try {
      const targetRole = await resolveTargetRole(ind.escalationOwner);
      await prisma.notification.create({
        data: {
          type: 'qi_data_missing',
          title: `Missing QI capture · ${ind.qiCode}`,
          message: `No record captured for ${ind.qiCode} (${ind.chapter}) in ${period}. Please record the numerator / denominator or mark the indicator inactive.`,
          status: 'unread',
          targetRole,
          isCritical: false,
          entityId: 0,
          entityType,
        },
      });
      report.notifiedFresh += 1;
    } catch (err) {
      console.warn('[qi-dq:notify] failed:', (err as Error).message);
    }
  }

  return report;
}

// ─── Cron registration — weekly, Mondays at 09:00 ───────────────────────

export const registerQualityDataQualityCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('0 9 * * 1', async () => {
    if (isRunning) { console.log('[qi-dq] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const report = await runDataQualitySweep();
      console.log(
        `[qi-dq] ${report.period} — missing ${report.missing}/${report.total}, ` +
        `notified ${report.notifiedFresh} fresh + ${report.notifiedAlreadyOpen} already open` +
        (report.skippedReason ? ` · ${report.skippedReason}` : ''),
      );
    } catch (err) {
      console.error('Error in qi-dq cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Quality data-quality sweep cron initialized (weekly, Mondays 09:00)');
};
