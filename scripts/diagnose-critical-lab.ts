/// <reference path="../global.d.ts" />
/**
 * Diagnose + trigger the CRITICAL_LAB_NOT_ACKNOWLEDGED rule for PRN 9900001.
 *
 * Why the cron may quietly skip the result:
 *   • InvestigationResult.acknowledgedAt is set (a doctor / staff acked it)
 *   • InvestigationResult.isDeleted = true (soft-deleted)
 *   • InvestigationResult.reportedAt is within the last 30 min (still too new)
 *   • InvestigationResult.criticalFlag = false
 * Why the rule may run but still raise no incident:
 *   • An existing open incident matches the dedup OR (ruleKey + patientPrn +
 *     reportedAt within 24h). Cancelled status means dedup skips it.
 *
 * This script prints the state of each gate, then calls runAllCronRules() so
 * you don't have to wait for the *​/15 cron tick. Run:
 *
 *   npx ts-node scripts/diagnose-critical-lab.ts
 */

import { PrismaClient } from '@prisma/client';
import { runAllCronRules } from '../src/api/incident/rule-catalogue';

const prisma = new PrismaClient();
const TARGET_PRN = '9900001';

async function main(): Promise<void> {
  console.log('[diagnose-critical-lab] starting…\n');

  // 1. Critical lab results for the patient.
  const results = await prisma.investigationResult.findMany({
    where: { prn: TARGET_PRN, criticalFlag: true },
    select: {
      id: true, testName: true, status: true, criticalFlag: true,
      isDeleted: true, acknowledgedAt: true, reportedAt: true, department: true,
    },
    orderBy: { reportedAt: 'desc' },
  });
  console.log(`📋 Critical lab results for PRN ${TARGET_PRN}: ${results.length} row(s)`);
  for (const r of results) {
    const mins = r.reportedAt ? Math.floor((Date.now() - r.reportedAt.getTime()) / 60_000) : null;
    const gates: string[] = [];
    if (r.isDeleted) gates.push('isDeleted=true ❌');
    if (r.acknowledgedAt) gates.push(`acknowledgedAt=${r.acknowledgedAt.toISOString()} ❌`);
    if (mins !== null && mins < 30) gates.push(`reportedAt too recent (${mins} min < 30 min cutoff) ❌`);
    if (!r.criticalFlag) gates.push('criticalFlag=false ❌');
    const eligible = gates.length === 0;
    console.log(`  • ${r.testName} (id=${r.id}) — reportedAt ${r.reportedAt?.toISOString() ?? 'null'} ` +
      `(${mins ?? '?'} min ago), status=${r.status} ${eligible ? '✅ eligible' : '⛔ skipped: ' + gates.join(', ')}`);
  }

  // 2. Matching active admission (the rule's IPD lookup).
  const admission = await prisma.ipdAdmission.findFirst({
    where: { prn: TARGET_PRN, status: { in: ['admitted', 'BED_ACCEPTED'] } },
    select: { id: true, admissionNo: true, admissionDate: true, status: true, department: true },
    orderBy: { admissionDate: 'desc' },
  });
  console.log(`\n🏥 Active admission for PRN ${TARGET_PRN}: ${admission ? admission.admissionNo : '(none)'}`);
  if (admission) {
    console.log(`  admissionDate=${admission.admissionDate.toISOString()}, status=${admission.status}`);
    for (const r of results) {
      if (!r.reportedAt) continue;
      const passes = admission.admissionDate.getTime() <= r.reportedAt.getTime();
      console.log(`  vs result ${r.testName} reportedAt=${r.reportedAt.toISOString()} ` +
        `→ admissionDate <= reportedAt? ${passes ? '✅' : '❌ (admission is newer than result; lookup fails)'}`);
    }
  }

  // 3. Existing incidents for this PRN + rule that may block dedup.
  const incidents = await prisma.incident.findMany({
    where: { patientPrn: TARGET_PRN, ruleKey: 'CRITICAL_LAB_NOT_ACKNOWLEDGED' },
    select: { id: true, code: true, status: true, reportedAt: true, admissionId: true, appointmentId: true },
    orderBy: { reportedAt: 'desc' },
    take: 5,
  });
  console.log(`\n🗂  Existing CRITICAL_LAB_NOT_ACKNOWLEDGED incidents for PRN ${TARGET_PRN}: ${incidents.length}`);
  for (const i of incidents) {
    const ageH = Math.floor((Date.now() - i.reportedAt.getTime()) / 3_600_000);
    const blocksDedup = ['open', 'triaged', 'investigated', 'capa_in_progress'].includes(i.status) && ageH < 24;
    console.log(`  • ${i.code} status=${i.status} age=${ageH}h admissionId=${i.admissionId ?? 'null'} ` +
      `appointmentId=${i.appointmentId ?? 'null'} ${blocksDedup ? '⛔ blocks dedup' : '✅ no dedup conflict'}`);
  }

  // 4. Run the cron sweep right now.
  console.log('\n⏵ Running runAllCronRules() now…');
  const summary = await runAllCronRules();
  console.log(`✓ Sweep done — checked=${summary.checked}, raised=${summary.raised}`);

  // 5. Show the newest incident for this PRN after the sweep.
  const latest = await prisma.incident.findFirst({
    where: { patientPrn: TARGET_PRN, ruleKey: 'CRITICAL_LAB_NOT_ACKNOWLEDGED' },
    orderBy: { reportedAt: 'desc' },
    select: { id: true, code: true, status: true, reportedAt: true, admissionId: true, appointmentId: true, title: true },
  });
  console.log('\n🎯 Latest incident after sweep:');
  if (latest) {
    console.log(`  ${latest.code} — "${latest.title}"`);
    console.log(`  status=${latest.status} reportedAt=${latest.reportedAt.toISOString()}`);
    console.log(`  admissionId=${latest.admissionId ?? 'null'} appointmentId=${latest.appointmentId ?? 'null'}`);
    if (latest.admissionId) console.log(`  → UI should render the IPD chip ✅`);
    else if (latest.appointmentId) console.log(`  → UI should render the OPD chip ✅`);
    else console.log(`  → No encounter FK populated; chip will be hidden ❌`);
  } else {
    console.log('  (none)');
  }
}

main()
  .catch((err) => { console.error('[diagnose-critical-lab] failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
