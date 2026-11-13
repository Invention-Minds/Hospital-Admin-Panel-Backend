import prisma from '../../service/prisma-client';
import { isPushEnabled, pushOnce } from '../../service/mobile-push';
import { qualityCapabilitiesFor } from '../quality/quality-mobile.controller';

// Push dispatcher for the mobile app. Instead of hooking into the live web
// handlers, it looks back over recent rows every minute and pushes anything
// new; MobilePushLog guarantees each alert goes out once. Off unless
// MOBILE_PUSH_ENABLED=true.

const LOOKBACK_MS = 15 * 60 * 1000;
const ACTIVE_IPD = ['admitted', 'transferred'];

async function userIdsForDoctors(doctorIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(doctorIds)];
  if (!ids.length) return new Map();
  const rows = await prisma.doctor.findMany({ where: { id: { in: ids }, userId: { not: null } }, select: { id: true, userId: true } });
  return new Map(rows.map((d) => [d.id, d.userId as number]));
}

/** Critical results not yet acknowledged → the ordering doctor and the admitting doctor. */
export async function dispatchCriticalResults(since: Date): Promise<number> {
  const rows = await prisma.investigationResult.findMany({
    where: { criticalFlag: true, acknowledgedAt: null, isDeleted: false, createdAt: { gte: since } },
    select: { id: true, orderId: true, prn: true, order: { select: { doctorId: true } } },
    take: 200,
  });
  if (!rows.length) return 0;
  const admissions = await prisma.ipdAdmission.findMany({
    where: { prn: { in: [...new Set(rows.map((r) => r.prn))] }, status: { in: ACTIVE_IPD }, admittingDoctorId: { not: null } },
    select: { prn: true, admittingDoctorId: true },
  });
  const users = await userIdsForDoctors([...rows.map((r) => r.order.doctorId), ...admissions.map((a) => a.admittingDoctorId as number)]);
  let sent = 0;
  for (const r of rows) {
    const recipients = new Set<number>();
    const orderer = users.get(r.order.doctorId);
    if (orderer) recipients.add(orderer);
    for (const a of admissions) if (a.prn === r.prn) {
      const u = users.get(a.admittingDoctorId as number);
      if (u) recipients.add(u);
    }
    for (const userId of recipients) {
      if (await pushOnce({ userId, kind: 'critical_result', entityId: String(r.id), path: `/reports/${r.orderId}` })) sent++;
    }
  }
  return sent;
}

/** A patient wrote and is now waiting → the query's doctor; one alert per waiting episode. */
export async function dispatchPatientQueries(since: Date): Promise<number> {
  const recent = await prisma.whatsappQueryMessage.findMany({
    where: { direction: 'IN', created_at: { gte: since }, query: { status: { not: 'closed' } } },
    select: { queryId: true },
    distinct: ['queryId'],
    take: 200,
  });
  if (!recent.length) return 0;
  const queries = await prisma.whatsappQuery.findMany({
    where: { id: { in: recent.map((r) => r.queryId) } },
    select: { id: true, doctorId: true, messages: { orderBy: { created_at: 'asc' }, select: { id: true, direction: true } } },
  });
  const users = await userIdsForDoctors(queries.map((q) => q.doctorId));
  let sent = 0;
  for (const q of queries) {
    const msgs = q.messages;
    if (!msgs.length || msgs[msgs.length - 1].direction !== 'IN') continue; // doctor already replied
    let i = msgs.length - 1;
    while (i > 0 && msgs[i - 1].direction === 'IN') i--;
    const userId = users.get(q.doctorId);
    if (userId && (await pushOnce({ userId, kind: 'patient_query', entityId: `${q.id}:${msgs[i].id}`, path: `/queries/${q.id}` }))) sent++;
  }
  return sent;
}

/** A discharge summary was just drafted → the admitting doctor. */
export async function dispatchDischargeDrafts(since: Date): Promise<number> {
  const rows = await prisma.ipdDischarge.findMany({
    where: { aiDraftedAt: { gte: since }, summaryStatus: 'DRAFTED' },
    select: { id: true, admissionId: true, admission: { select: { admittingDoctorId: true } } },
    take: 100,
  });
  const users = await userIdsForDoctors(rows.map((r) => r.admission.admittingDoctorId).filter((x): x is number => x != null));
  let sent = 0;
  for (const r of rows) {
    const userId = r.admission.admittingDoctorId != null ? users.get(r.admission.admittingDoctorId) : undefined;
    if (userId && (await pushOnce({ userId, kind: 'discharge_ready', entityId: r.id, path: `/rounds/${r.admissionId}/discharge` }))) sent++;
  }
  return sent;
}

/** 08:00 — everyone with Quality access and the app installed gets the digest nudge. */
export async function dispatchQualityDigest(today: string): Promise<number> {
  const devices = await prisma.mobilePushDevice.findMany({ where: { disabledAt: null }, select: { userId: true }, distinct: ['userId'] });
  let sent = 0;
  for (const { userId } of devices) {
    const caps = await qualityCapabilitiesFor(userId);
    if (caps?.canSeeQuality && (await pushOnce({ userId, kind: 'quality_digest', entityId: today, path: '/quality' }))) sent++;
  }
  return sent;
}

export const registerMobilePushCron = (): void => {
  if (!isPushEnabled()) {
    console.log('[mobile-push] MOBILE_PUSH_ENABLED is not true — dispatcher off');
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let running = false;
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const since = new Date(Date.now() - LOOKBACK_MS);
      const [c, q, d] = await Promise.all([dispatchCriticalResults(since), dispatchPatientQueries(since), dispatchDischargeDrafts(since)]);
      if (c + q + d) console.log(`[mobile-push] sent critical ${c} · query ${q} · discharge ${d}`);
    } catch (err) {
      console.error('[mobile-push] dispatch failed:', err);
    } finally {
      running = false;
    }
  });
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const n = await dispatchQualityDigest(today);
        if (n) console.log(`[mobile-push] morning digest sent to ${n} user(s)`);
      } catch (err) {
        console.error('[mobile-push] digest failed:', err);
      }
    },
    { timezone: 'Asia/Kolkata' },
  );
};
