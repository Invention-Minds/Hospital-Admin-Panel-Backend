import type { Prisma } from '@prisma/client';
import prisma from './prisma-client';

/**
 * Prisma filter for "admissions under this doctor": match on admittingDoctorId,
 * falling back to the name snapshot only for legacy rows that have no id yet
 * (created before the column, or not yet backfilled). A row linked to another
 * doctor's id never matches by name.
 */
export function admittedByDoctor(doctor: { id: number; name: string }): Prisma.IpdAdmissionWhereInput {
  const bare = doctor.name.replace(/^\s*dr\b\.?\s*/i, '').trim() || doctor.name;
  return {
    OR: [
      { admittingDoctorId: doctor.id },
      { admittingDoctorId: null, admittingDoctor: { contains: bare } },
    ],
  };
}

/**
 * Normalise a doctor's name for comparison: drop a leading "Dr"/"Dr.", fold case,
 * strip punctuation and collapse whitespace. "Dr. Ananya  Rao" → "ananya rao".
 */
export function normalizeDoctorName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/^\s*dr\b\.?/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a free-text doctor name to a Doctor.id — only when exactly one doctor
 * has that normalised name. Ambiguous or unknown names return null rather than
 * guessing, so a patient is never attached to the wrong doctor.
 *
 * Pass `doctors` to avoid a query per call when resolving many names.
 */
export async function resolveDoctorIdByName(
  name: string | null | undefined,
  doctors?: { id: number; name: string }[],
): Promise<number | null> {
  const target = normalizeDoctorName(name);
  if (!target) return null;
  const pool = doctors ?? (await prisma.doctor.findMany({ select: { id: true, name: true } }));
  const matches = pool.filter((d) => normalizeDoctorName(d.name) === target);
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * The Doctor.id to store on a new admission: the picker's id when it names a real
 * doctor, otherwise the unambiguous match for the name snapshot, otherwise null.
 * Callers pass 0 for "no doctor picked" — treated as absent.
 */
export async function resolveAdmittingDoctorId(
  doctorId: number | null | undefined,
  doctorName: string | null | undefined,
): Promise<number | null> {
  if (typeof doctorId === 'number' && Number.isInteger(doctorId) && doctorId > 0) {
    const found = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
    if (found) return found.id;
  }
  return resolveDoctorIdByName(doctorName);
}
