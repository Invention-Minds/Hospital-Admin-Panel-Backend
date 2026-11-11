import prisma from './prisma-client';
import { effectivenessScheduleDays } from './incident-harm';

// CAPA rules shared by the incident status flow and the CAPA action /
// effectiveness endpoints.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why the incident can't be closed yet, or null when its CAPA is complete:
 * a root cause, at least one corrective action (an action row, or the legacy
 * free-text correctiveActions on older CAPAs) and no action still open.
 */
export async function closureCapaProblem(incidentId: string): Promise<string | null> {
  const [capa, actions] = await Promise.all([
    prisma.incidentCapa.findUnique({ where: { incidentId }, select: { rootCause: true, correctiveActions: true } }),
    prisma.incidentCapaAction.findMany({ where: { incidentId }, select: { kind: true, status: true } }),
  ]);
  if (!capa?.rootCause?.trim()) return 'Record the root cause before closing';
  const hasCorrective = actions.some((a) => a.kind === 'corrective' && a.status !== 'dropped')
    || !!capa.correctiveActions?.trim();
  if (!hasCorrective) return 'Add at least one corrective action before closing';
  const open = actions.filter((a) => a.status === 'open').length;
  if (open > 0) return `${open} CAPA action(s) are still open — mark them done or dropped before closing`;
  return null;
}

/** On closure: replace any pending checks with a fresh 30/60/90 (or 30) schedule. */
export async function scheduleEffectivenessReviews(incidentId: string, severity: string, closedAt: Date): Promise<number> {
  await cancelPendingReviews(incidentId);
  const days = effectivenessScheduleDays(severity);
  await prisma.incidentEffectivenessReview.createMany({
    data: days.map((d) => ({ incidentId, dayOffset: d, dueAt: new Date(closedAt.getTime() + d * DAY_MS) })),
  });
  return days.length;
}

/** On reopen: the schedule restarts at the next closure. */
export async function cancelPendingReviews(incidentId: string): Promise<number> {
  const { count } = await prisma.incidentEffectivenessReview.updateMany({
    where: { incidentId, status: 'pending' }, data: { status: 'cancelled' },
  });
  return count;
}
