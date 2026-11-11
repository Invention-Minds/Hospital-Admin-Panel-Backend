import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { unitHeadUserIds } from '../../service/quality-escalation';
import { incidentManagerUserIds } from './incident.controller';

// Daily CAPA reminder (09:00 IST) — incident CAPA (below) and quality audits
// (runAuditReminderSweep).
//
//   - open CAPA actions due by the end of tomorrow → the action owner
//   - overdue actions (or due ones with no owner)  → also the unit HOD / deputy
//                                                    (Quality Managers when none)
//   - effectiveness checks due by end of tomorrow  → unit HOD / deputy + Quality
//                                                    Managers (closed incidents)
//
// One bell per (user, incident) per run, summarising the counts — not one per
// action — so a busy HOD gets a short list, not a flood. Runs daily, so the
// schedule itself is the dedupe.

const IST = 'Asia/Kolkata';

export interface CapaReminderReport {
  actionsDue: number;
  reviewsDue: number;
  bells: number;
}

type Line = { overdue: number; dueSoon: number; reviews: number };

export async function runCapaReminderSweep(
  now: Date = new Date(), opts: { incidentIds?: string[] } = {},
): Promise<CapaReminderReport> {
  const horizon = moment(now).tz(IST).add(1, 'day').endOf('day').toDate();
  const idFilter = opts.incidentIds ? { incidentId: { in: opts.incidentIds } } : {};

  const actions = await prisma.incidentCapaAction.findMany({
    where: {
      status: 'open', dueDate: { not: null, lte: horizon }, ...idFilter,
      incident: { status: { notIn: ['closed', 'cancelled'] } },
    },
    select: { incidentId: true, ownerId: true, dueDate: true, incident: { select: { code: true, unitId: true } } },
  });
  const reviews = await prisma.incidentEffectivenessReview.findMany({
    where: { status: 'pending', dueAt: { lte: horizon }, ...idFilter, incident: { status: 'closed' } },
    select: { incidentId: true, incident: { select: { code: true, unitId: true } } },
  });

  // userId → incidentId → counts
  const plan = new Map<number, Map<string, Line>>();
  const codes = new Map<string, string>();
  const add = (userIds: number[], incidentId: string, k: keyof Line) => {
    for (const u of new Set(userIds)) {
      const perUser = plan.get(u) ?? new Map<string, Line>();
      const line = perUser.get(incidentId) ?? { overdue: 0, dueSoon: 0, reviews: 0 };
      line[k] += 1;
      perUser.set(incidentId, line);
      plan.set(u, perUser);
    }
  };

  const headsCache = new Map<number | null, number[]>();
  let managers: number[] | null = null;
  const escalationTargets = async (unitId: number | null): Promise<number[]> => {
    if (!headsCache.has(unitId)) headsCache.set(unitId, await unitHeadUserIds(unitId));
    const heads = headsCache.get(unitId) as number[];
    if (heads.length > 0) return heads;
    managers ??= await incidentManagerUserIds();
    return managers;
  };

  for (const a of actions) {
    codes.set(a.incidentId, a.incident.code);
    const overdue = (a.dueDate as Date).getTime() < now.getTime();
    const k: keyof Line = overdue ? 'overdue' : 'dueSoon';
    if (a.ownerId) add([a.ownerId], a.incidentId, k);
    if (overdue || !a.ownerId) add(await escalationTargets(a.incident.unitId), a.incidentId, k);
  }
  for (const r of reviews) {
    codes.set(r.incidentId, r.incident.code);
    managers ??= await incidentManagerUserIds();
    add([...(await escalationTargets(r.incident.unitId)), ...managers], r.incidentId, 'reviews');
  }

  const data: Array<{
    type: string; title: string; message: string; status: string; isCritical: boolean;
    entityId: number; entityType: string; userId: number;
  }> = [];
  for (const [userId, perUser] of plan) {
    for (const [incidentId, l] of perUser) {
      const parts = [
        l.overdue && `${l.overdue} CAPA action(s) overdue`,
        l.dueSoon && `${l.dueSoon} CAPA action(s) due by tomorrow`,
        l.reviews && `${l.reviews} effectiveness check(s) due`,
      ].filter(Boolean);
      data.push({
        type: l.reviews && !l.overdue && !l.dueSoon ? 'effectiveness_review_due' : 'capa_action_due',
        title: `CAPA follow-up · ${codes.get(incidentId)}`,
        message: `${parts.join(' · ')} — open the incident to update.`,
        status: 'unread',
        isCritical: l.overdue > 0,
        entityId: 0,
        entityType: `Incident:${incidentId}`,
        userId,
      });
    }
  }
  if (data.length > 0) await prisma.notification.createMany({ data });
  return { actionsDue: actions.length, reviewsDue: reviews.length, bells: data.length };
}

export interface AuditReminderReport { auditsDue: number; actionsDue: number; bells: number }

/**
 * Same sweep for quality audits: audits due by tomorrow → the auditor (or the
 * unit HOD / Quality Managers when unassigned; overdue ones always also go to
 * them); finding actions due by tomorrow → owner, overdue → also HOD / QM.
 * One bell per (user, audit).
 */
export async function runAuditReminderSweep(
  now: Date = new Date(), opts: { runIds?: string[] } = {},
): Promise<AuditReminderReport> {
  const horizon = moment(now).tz(IST).add(1, 'day').endOf('day').toDate();
  const runs = await prisma.auditRun.findMany({
    where: { status: { in: ['scheduled', 'in_progress'] }, dueDate: { not: null, lte: horizon }, ...(opts.runIds && { id: { in: opts.runIds } }) },
    select: { id: true, code: true, unitId: true, auditorId: true, dueDate: true, checklist: { select: { name: true } } },
  });
  const actions = await prisma.auditFindingAction.findMany({
    where: { status: 'open', dueDate: { not: null, lte: horizon }, ...(opts.runIds && { runId: { in: opts.runIds } }) },
    select: { runId: true, ownerId: true, dueDate: true, run: { select: { code: true, unitId: true, checklist: { select: { name: true } } } } },
  });

  let managers: number[] | null = null;
  const heads = new Map<number | null, number[]>();
  const escalation = async (unitId: number | null) => {
    if (!heads.has(unitId)) heads.set(unitId, await unitHeadUserIds(unitId));
    const h = heads.get(unitId) as number[];
    if (h.length) return h;
    managers ??= await incidentManagerUserIds();
    return managers;
  };
  type Line = { auditDue: boolean; auditOverdue: boolean; overdue: number; dueSoon: number; code: string; name: string };
  const plan = new Map<string, Line>(); // `${userId}|${runId}`
  const add = (users: number[], runId: string, code: string, name: string, f: (l: Line) => void) => {
    for (const u of new Set(users)) {
      const k = `${u}|${runId}`;
      const l = plan.get(k) ?? { auditDue: false, auditOverdue: false, overdue: 0, dueSoon: 0, code, name };
      f(l);
      plan.set(k, l);
    }
  };
  for (const r of runs) {
    const overdue = (r.dueDate as Date).getTime() < now.getTime();
    const users = [...(r.auditorId ? [r.auditorId] : []), ...((overdue || !r.auditorId) ? await escalation(r.unitId) : [])];
    add(users, r.id, r.code, r.checklist.name, (l) => { if (overdue) l.auditOverdue = true; else l.auditDue = true; });
  }
  for (const a of actions) {
    const overdue = (a.dueDate as Date).getTime() < now.getTime();
    const users = [...(a.ownerId ? [a.ownerId] : []), ...((overdue || !a.ownerId) ? await escalation(a.run.unitId) : [])];
    add(users, a.runId, a.run.code, a.run.checklist.name, (l) => { if (overdue) l.overdue += 1; else l.dueSoon += 1; });
  }
  const data = [...plan.entries()].map(([k, l]) => {
    const [userId, runId] = k.split('|');
    const parts = [
      l.auditOverdue && 'audit overdue', l.auditDue && 'audit due by tomorrow',
      l.overdue && `${l.overdue} finding action(s) overdue`, l.dueSoon && `${l.dueSoon} finding action(s) due by tomorrow`,
    ].filter(Boolean);
    return {
      type: l.auditDue || l.auditOverdue ? 'audit_due' : 'audit_action_due',
      title: `Audit follow-up · ${l.code}`,
      message: `${l.name}: ${parts.join(' · ')}.`,
      status: 'unread', isCritical: l.auditOverdue || l.overdue > 0,
      entityId: 0, entityType: `AuditRun:${runId}`, userId: Number(userId),
    };
  });
  if (data.length) await prisma.notification.createMany({ data });
  return { auditsDue: runs.length, actionsDue: actions.length, bells: data.length };
}

export const registerCapaReminderCron = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cron = require('node-cron');
  let isRunning = false;
  cron.schedule('0 9 * * *', async () => {
    if (isRunning) { console.log('[capa-reminder] previous sweep still running — skipping this tick'); return; }
    isRunning = true;
    try {
      const r = await runCapaReminderSweep();
      if (r.bells > 0) console.log(`[capa-reminder] ${r.actionsDue} action(s), ${r.reviewsDue} check(s) → ${r.bells} bell(s)`);
      const a = await runAuditReminderSweep();
      if (a.bells > 0) console.log(`[capa-reminder] audits: ${a.auditsDue} due, ${a.actionsDue} action(s) → ${a.bells} bell(s)`);
    } catch (err) {
      console.error('Error in capa-reminder cron:', err);
    } finally {
      isRunning = false;
    }
  }, { timezone: IST });
  console.log('✅ CAPA action / effectiveness-check reminder cron initialized (daily 09:00 IST)');
};
