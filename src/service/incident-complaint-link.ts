import prisma from './prisma-client';

// Phase 6 / Concern #4 + Option A — cross-module linkage helpers.
//
// When the feedback module auto-raises a Complaint + Incident from a low NPS
// score, we link them to the original FeedbackSurvey and to any *existing*
// open incidents on the same patient (last 30 days) so the investigator gets
// the full picture instead of three orphan rows.

const RELATED_WINDOW_DAYS = 30;

function parseList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
  } catch { return []; }
}

function stringifyUnique(ids: string[]): string {
  return JSON.stringify(Array.from(new Set(ids.filter(Boolean))));
}

/**
 * Find non-closed incidents for the same patient within the relate-window.
 * Used to surface "related" siblings to a newly-raised incident.
 */
export async function findRelatedOpenIncidents(opts: {
  patientPrn: string | null;
  excludeIncidentId?: string;
}): Promise<Array<{ id: string; code: string; category: string; severity: string }>> {
  if (!opts.patientPrn) return [];
  const since = new Date(Date.now() - RELATED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return prisma.incident.findMany({
    where: {
      patientPrn: opts.patientPrn,
      status: { notIn: ['closed', 'cancelled'] },
      reportedAt: { gte: since },
      ...(opts.excludeIncidentId ? { id: { not: opts.excludeIncidentId } } : {}),
    },
    select: { id: true, code: true, category: true, severity: true },
    orderBy: { reportedAt: 'desc' },
    take: 10,
  });
}

/**
 * Set Incident.{feedbackSurveyId, complaintId, relatedIncidentIds} on the
 * newly-raised incident AND append the new incident's id into each related
 * sibling's relatedIncidentIds JSON array (reciprocal link).
 */
export async function attachIncidentLinks(opts: {
  incidentId: string;
  feedbackSurveyId?: string | null;
  complaintId?: string | null;
  relatedIds?: string[];
}): Promise<void> {
  try {
    const related = opts.relatedIds ?? [];
    await prisma.incident.update({
      where: { id: opts.incidentId },
      data: {
        feedbackSurveyId: opts.feedbackSurveyId ?? undefined,
        complaintId: opts.complaintId ?? undefined,
        relatedIncidentIds: related.length > 0 ? stringifyUnique(related) : undefined,
      },
    });
    // Reciprocal back-link on each existing sibling.
    for (const sibId of related) {
      try {
        const sib = await prisma.incident.findUnique({
          where: { id: sibId },
          select: { relatedIncidentIds: true },
        });
        const merged = stringifyUnique([...parseList(sib?.relatedIncidentIds), opts.incidentId]);
        await prisma.incident.update({
          where: { id: sibId },
          data: { relatedIncidentIds: merged },
        });
      } catch (err) {
        console.warn('[incident-link] reciprocal update failed for', sibId, '—', (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[incident-link] attach failed:', (err as Error).message);
  }
}

/**
 * Attach Complaint.relatedIncidentIds = [<incidentId>].
 */
export async function linkComplaintToIncident(complaintId: string, incidentId: string): Promise<void> {
  try {
    const cur = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { relatedIncidentIds: true },
    });
    const merged = stringifyUnique([...parseList(cur?.relatedIncidentIds), incidentId]);
    await prisma.complaint.update({
      where: { id: complaintId },
      data: { relatedIncidentIds: merged },
    });
  } catch (err) {
    console.warn('[incident-link] complaint link failed:', (err as Error).message);
  }
}

/**
 * Dedup search: given an encounter (admissionId/appointmentId/emergencyId/prn),
 * find existing open complaints that probably describe the same event. Used
 * by the manual complaint-create flow to surface "Possible duplicate of …"
 * without blocking the create.
 */
export async function findPossibleDuplicateComplaints(opts: {
  patientPrn?: string | null;
  admissionId?: string | null;
  appointmentId?: number | null;
  emergencyId?: number | null;
}): Promise<Array<{ id: string; code: string; status: string; raisedAt: Date }>> {
  const orClauses: Array<Record<string, unknown>> = [];
  if (opts.admissionId) orClauses.push({ admissionId: opts.admissionId });
  if (opts.appointmentId) orClauses.push({ appointmentId: opts.appointmentId });
  if (opts.emergencyId) orClauses.push({ emergencyId: opts.emergencyId });
  // Fallback to PRN match when no encounter is given.
  if (orClauses.length === 0 && opts.patientPrn) orClauses.push({ patientPrn: opts.patientPrn });
  if (orClauses.length === 0) return [];

  const since = new Date(Date.now() - RELATED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return prisma.complaint.findMany({
    where: {
      OR: orClauses,
      status: { in: ['open', 'acknowledged'] },
      raisedAt: { gte: since },
    },
    select: { id: true, code: true, status: true, raisedAt: true },
    orderBy: { raisedAt: 'desc' },
    take: 5,
  });
}
