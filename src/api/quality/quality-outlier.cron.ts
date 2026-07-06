import prisma from '../../service/prisma-client';
import { raiseByRule } from '../incident/rule-catalogue';

// Phase 9.26 / Phase 4 — single-case outlier scanner.
//
// Sweeps the last 24 hours of source data every 30 min, looking for individual
// cases that breach a *soft* outlier threshold for the time-based KPIs. Even
// when the monthly aggregate (PSQ-001 etc.) is green, a one-off bad case is
// still a performance drift worth surfacing.
//
// Phase 4 coverage:
//   • PSQ-001 — admissions whose consultant-signed initial assessment
//     completed > 120 min after ward arrival.
//
// Other minute-based KPIs (PSQ-005 ER triage, PSQ-013 door-to-doctor,
// PSQ-015 ICU TAT after decision) need ER / triage / ICU-decision timestamps
// that aren't in the schema today — deferred to Phase 5 instrumentation.
//
// Idempotent: raiseByRule has a 24h dedupe on (ruleKey + admissionId), so a
// stuck case won't re-raise on every sweep.

const PSQ_001_OUTLIER_MINUTES = 120;

interface RunOut { checked: number; raised: number }

async function runInitialAssessmentOutlier(): Promise<RunOut> {
  // Window: signed in the last 24 hours. Anything older is either already
  // flagged or out of the sweep horizon — the 24h hard-late rule catches that.
  const sinceCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      initialAssessment: {
        is: {
          status: 'CONSULTANT_SIGNED',
          consultantSignedAt: { gte: sinceCutoff },
        },
      },
    },
    select: {
      id: true, admissionNo: true, prn: true, department: true,
      admissionDate: true,
      ward: { select: { wardName: true } },
      initialAssessment: { select: { consultantSignedAt: true } },
    },
    take: 1000,
  });

  let raised = 0;
  for (const a of admissions) {
    const signedAt = a.initialAssessment?.consultantSignedAt;
    if (!signedAt) continue;
    const mins = (signedAt.getTime() - a.admissionDate.getTime()) / 60_000;
    if (mins <= PSQ_001_OUTLIER_MINUTES) continue;

    const result = await raiseByRule('QI_OUTLIER_INITIAL_ASSESSMENT', {
      admissionId: a.id,
      patientPrn: a.prn,
      department: a.department,
      ward: a.ward?.wardName ?? null,
      occurredAt: signedAt,
      extras: {
        admissionNo: a.admissionNo,
        minutesSince: Math.round(mins),
        thresholdMinutes: PSQ_001_OUTLIER_MINUTES,
        qiCode: 'PSQ-001',
      },
    });
    if (result?.created) raised += 1;
  }
  return { checked: admissions.length, raised };
}

export async function runAllOutlierScanners(): Promise<{ checked: number; raised: number }> {
  let checked = 0, raised = 0;
  try {
    const r = await runInitialAssessmentOutlier();
    checked += r.checked; raised += r.raised;
  } catch (err) {
    console.warn('[qi-outlier:initial-assessment] failed:', (err as Error).message);
  }
  return { checked, raised };
}

// ─── Cron registration ──────────────────────────────────────────────────

export const registerQualityOutlierCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('*/30 * * * *', async () => {
    if (isRunning) { console.log('[qi-outlier] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const { raised, checked } = await runAllOutlierScanners();
      if (raised > 0) {
        console.log(`[qi-outlier] sweep raised ${raised}/${checked} outlier incident(s)`);
      }
    } catch (err) {
      console.error('Error in qi-outlier cron:', err);
    } finally {
      isRunning = false;
    }
  });
  console.log('✅ Quality outlier scanner cron initialized (every 30 min)');
};
