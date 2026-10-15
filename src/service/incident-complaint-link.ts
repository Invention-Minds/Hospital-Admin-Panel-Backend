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
 * Merge links into the incident (which may be a pre-existing, deduped one):
 * relatedIncidentIds is appended to, feedbackSurveyId / complaintId are only
 * filled when still empty. Also appends the incident's id into each related
 * sibling's relatedIncidentIds JSON array (reciprocal link).
 */
export async function attachIncidentLinks(opts: {
  incidentId: string;
  feedbackSurveyId?: string | null;
  complaintId?: string | null;
  relatedIds?: string[];
}): Promise<void> {
  try {
    const related = (opts.relatedIds ?? []).filter((id) => id !== opts.incidentId);
    const cur = await prisma.incident.findUnique({
      where: { id: opts.incidentId },
      select: { feedbackSurveyId: true, complaintId: true, relatedIncidentIds: true },
    });
    if (!cur) { console.warn('[incident-link] incident not found:', opts.incidentId); return; }

    // complaintId is unique on Incident — skip if another incident already owns it.
    let complaintId: string | undefined;
    if (opts.complaintId && !cur.complaintId) {
      const owner = await prisma.incident.findUnique({ where: { complaintId: opts.complaintId }, select: { id: true } });
      if (!owner) complaintId = opts.complaintId;
    }
    const existingRelated = parseList(cur.relatedIncidentIds);
    const mergedRelated = stringifyUnique([...existingRelated, ...related]);
    try {
      await prisma.incident.update({
        where: { id: opts.incidentId },
        data: {
          feedbackSurveyId: opts.feedbackSurveyId && !cur.feedbackSurveyId ? opts.feedbackSurveyId : undefined,
          complaintId,
          relatedIncidentIds: related.length > 0 ? mergedRelated : undefined,
        },
      });
    } catch (err) {
      // Lost a race for the unique complaintId — keep the other links.
      if ((err as { code?: string }).code !== 'P2002' || !complaintId) throw err;
      console.warn('[incident-link] complaint', complaintId, 'already linked to another incident — skipping');
      await prisma.incident.update({
        where: { id: opts.incidentId },
        data: {
          feedbackSurveyId: opts.feedbackSurveyId && !cur.feedbackSurveyId ? opts.feedbackSurveyId : undefined,
          relatedIncidentIds: related.length > 0 ? mergedRelated : undefined,
        },
      });
    }
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
    console.error('[incident-link] attach failed for', opts.incidentId, '—', err);
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
    console.error('[incident-link] complaint link failed for', complaintId, '—', err);
  }
}

/** Next COMP-YYYY-NNNN code (year-scoped, numeric max so 10000+ still sorts right). */
async function nextComplaintCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `COMP-${year}-`;
  const rows = await prisma.$queryRaw<Array<{ maxSeq: bigint | number | null }>>`
    SELECT MAX(CAST(SUBSTRING(code, ${prefix.length + 1}) AS UNSIGNED)) AS maxSeq
    FROM Complaint WHERE code LIKE ${prefix + '%'}`;
  const lastSeq = Number(rows[0]?.maxSeq ?? 0) || 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/**
 * Runs `create` with a fresh complaint code, retrying when a concurrent insert
 * took it. Every Complaint insert (manual, WhatsApp, survey-auto) goes through here.
 */
export async function createWithComplaintCode<T>(create: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const code = await nextComplaintCode();
    try {
      return await create(code);
    } catch (err) {
      const e = err as { code?: string; meta?: { target?: unknown } };
      const isCodeClash = e.code === 'P2002' && String(e.meta?.target ?? 'code').includes('code');
      if (!isCodeClash || attempt >= 5) throw err;
    }
  }
}

/**
 * Department.name a complaint concerns, taken from its encounter:
 * admission → IpdAdmission.department, appointment → Appointment.department.
 * ER visits carry no department, so they stay null (set at triage instead).
 */
export async function deriveComplaintDepartment(opts: {
  appointmentId?: number | null;
  admissionId?: string | null;
  emergencyId?: number | null;
}): Promise<string | null> {
  try {
    if (opts.admissionId) {
      const adm = await prisma.ipdAdmission.findUnique({ where: { id: opts.admissionId }, select: { department: true } });
      if (adm?.department?.trim()) return adm.department.trim();
    }
    if (opts.appointmentId) {
      const appt = await prisma.appointment.findUnique({ where: { id: opts.appointmentId }, select: { department: true } });
      if (appt?.department?.trim()) return appt.department.trim();
    }
  } catch (err) {
    console.warn('[complaint] department lookup failed:', (err as Error).message);
  }
  return null;
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
      status: { in: ['open', 'acknowledged', 'escalated'] },
      raisedAt: { gte: since },
    },
    select: { id: true, code: true, status: true, raisedAt: true },
    orderBy: { raisedAt: 'desc' },
    take: 5,
  });
}
