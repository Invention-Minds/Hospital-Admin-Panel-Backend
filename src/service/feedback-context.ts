import prisma from './prisma-client';
import { resolveUnitId } from './quality-escalation';

// Feedback analytics support: the encounter context snapshotted onto each
// FeedbackSurvey, the patient-facing languages / "why did you choose us"
// options, and the single-row FeedbackConfig thresholds.

export const SURVEY_LANGUAGES = ['en', 'kn', 'ml', 'hi'] as const;
export type SurveyLanguage = (typeof SURVEY_LANGUAGES)[number];

/** Keys for "why did you choose us" — labels live in the patient-facing translations. */
export const CHOICE_REASONS = [
  'doctor', 'recommended', 'previous_visit', 'near_home', 'insurance', 'cost', 'facilities', 'emergency',
] as const;

export interface SurveyContext {
  department: string | null;
  doctorId: number | null;
  doctorName: string | null;
  wardName: string | null;
  unitId: number | null;
}

/**
 * Comparison key for a free-text doctor name: drops a leading "Dr", case,
 * spaces and punctuation, so "Dr. Priya Sharma", "dr priya  sharma" and
 * "Priya Sharma" are the same doctor.
 */
export function doctorNameKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/^\s*dr\b\.?\s*/, '').replace(/[^a-zऀ-෿]/g, '');
}

/** Tidy display form of a free-text doctor name ("dr.  priya sharma" → "Dr. Priya Sharma"). */
function displayDoctorName(name: string): string {
  const bare = name.trim().replace(/^\s*dr\b\.?\s*/i, '').replace(/\s+/g, ' ');
  if (!bare) return name.trim();
  return `Dr. ${bare.replace(/\b([a-z])/g, (c) => c.toUpperCase())}`;
}

/**
 * IPD admissions store the admitting doctor as free text. Link it to a Doctor
 * record when the name matches (so it groups with that doctor's OPD feedback);
 * otherwise keep a tidied name with no id.
 */
export async function matchDoctor(name: string | null | undefined): Promise<{ doctorId: number | null; doctorName: string | null }> {
  const key = doctorNameKey(name);
  if (!key || !name) return { doctorId: null, doctorName: null };
  const doctors = await prisma.doctor.findMany({ select: { id: true, name: true } });
  const hit = doctors.filter((d) => doctorNameKey(d.name) === key);
  // Only a unique match is trusted — two doctors with the same name stay unlinked.
  if (hit.length === 1) return { doctorId: hit[0].id, doctorName: hit[0].name };
  return { doctorId: null, doctorName: displayDoctorName(name) };
}

/** Department / doctor / ward / unit for a survey, from whichever visit it is linked to. */
export async function surveyContext(link: {
  appointmentId?: number | null; admissionId?: string | null; emergencyId?: number | null;
}): Promise<SurveyContext> {
  const ctx: SurveyContext = { department: null, doctorId: null, doctorName: null, wardName: null, unitId: null };
  if (link.appointmentId) {
    const a = await prisma.appointment.findUnique({
      where: { id: link.appointmentId }, select: { department: true, doctorId: true, doctorName: true },
    });
    if (a) Object.assign(ctx, { department: a.department || null, doctorId: a.doctorId ?? null, doctorName: a.doctorName || null });
  } else if (link.admissionId) {
    const adm = await prisma.ipdAdmission.findUnique({
      where: { id: link.admissionId },
      select: { department: true, admittingDoctor: true, ward: { select: { wardName: true } } },
    });
    if (adm) {
      Object.assign(ctx, {
        department: adm.department || null, wardName: adm.ward?.wardName ?? null,
        ...(await matchDoctor(adm.admittingDoctor)),
      });
    }
  } else if (link.emergencyId) {
    ctx.department = 'Emergency';
  }
  if (ctx.department || link.admissionId) {
    ctx.unitId = await resolveUnitId({ admissionId: link.admissionId ?? null, department: ctx.department }).catch(() => null);
  }
  return ctx;
}

export interface FeedbackThresholds {
  satisfiedMinRating: number;
  complaintMaxNps: number;
  incidentMaxNps: number;
}

export const DEFAULT_THRESHOLDS: FeedbackThresholds = { satisfiedMinRating: 4, complaintMaxNps: 6, incidentMaxNps: 3 };

export async function getFeedbackThresholds(): Promise<FeedbackThresholds> {
  const row = await prisma.feedbackConfig.findUnique({ where: { id: 1 } });
  return row
    ? { satisfiedMinRating: row.satisfiedMinRating, complaintMaxNps: row.complaintMaxNps, incidentMaxNps: row.incidentMaxNps }
    : { ...DEFAULT_THRESHOLDS };
}

/** Error text for an invalid threshold set, or null. */
export function thresholdsError(t: FeedbackThresholds): string | null {
  const int = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
  if (!int(t.satisfiedMinRating) || t.satisfiedMinRating < 2 || t.satisfiedMinRating > 5) return 'satisfiedMinRating must be 2..5';
  if (!int(t.complaintMaxNps) || t.complaintMaxNps < 0 || t.complaintMaxNps > 9) return 'complaintMaxNps must be 0..9';
  if (!int(t.incidentMaxNps) || t.incidentMaxNps < 0 || t.incidentMaxNps > t.complaintMaxNps) {
    return 'incidentMaxNps must be 0..complaintMaxNps (an incident is only raised alongside a complaint)';
  }
  return null;
}
