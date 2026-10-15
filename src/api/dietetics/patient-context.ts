import prisma from '../../service/prisma-client';
import { decodeDietList } from './diet-lifecycle';

/**
 * Shared patient + diet context for the dietary screens (Diet Information
 * Sheet, nursing census, labels, dietitian rounds). One batch of queries for
 * many admissions — IpdAdmission isn't FK-linked to the diet tables, so we
 * join in memory.
 */

export interface PatientContext {
  admissionId: string;
  admissionNo: string;
  admissionDate: Date;
  prn: string;
  patientName: string | null;
  age: string | null;
  sex: string | null;
  wardId: string | null;
  wardName: string | null;
  bedNumber: string | null;
  department: string;
  consultant: string;
  diagnosis: string;
  // Doctor's initial assessment (prefills screening + rounds).
  ia: {
    weightKg: number | null;
    heightCm: number | null;
    dietPattern: string | null; // veg | non-veg | mixed
    foodAllergy: boolean;
    allergyOthers: string | null;
    isPregnant: boolean;
    pregnancyWeeks: number | null;
    nutritionNote: string | null;
    chiefComplaints: string | null;
  } | null;
}

export interface CurrentPlanSummary {
  id: string;
  status: string; // ACTIVE | INTERIM
  source: string;
  dietId: string;
  dietCode: string;
  dietName: string;
  dietKind: string;
  /** "SRDD-SD" — diet code + texture code. */
  displayCode: string;
  textureId: string | null;
  foodAvoid: string | null;
  allergens: string[];
  restrictions: string[];
  fluidRestrictionMl: number | null;
  disposablePlate: boolean;
  npoFrom: Date | null;
  npoUntil: Date | null;
  feed: string | null;
  needsCheck: boolean;
  checkNote: string | null;
  remarks: string | null;
  notesForKitchen: string | null;
  signedAt: Date | null;
  signedBy: string | null;
  updatedAt: Date;
}

const toNum = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = Number.parseFloat(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Admitted patients (optionally one ward / some ids) with demographics. */
export async function loadPatientContext(filter: {
  admissionIds?: string[];
  wardId?: string;
  admittedOnly?: boolean;
}): Promise<PatientContext[]> {
  const admissions = await prisma.ipdAdmission.findMany({
    where: {
      ...(filter.admittedOnly !== false && { status: 'admitted' }),
      ...(filter.admissionIds && { id: { in: filter.admissionIds } }),
      ...(filter.wardId && { wardId: filter.wardId }),
    },
    select: {
      id: true, admissionNo: true, admissionDate: true, prn: true,
      wardId: true, department: true, admittingDoctor: true, diagnosis: true,
      ward: { select: { wardName: true } },
      bed: { select: { bedNumber: true } },
    },
    take: 1000,
  });
  if (!admissions.length) return [];

  const prnInts = Array.from(new Set(
    admissions.map((a) => Number.parseInt(a.prn ?? '', 10)).filter((n) => !Number.isNaN(n)),
  ));
  const [patients, assessments] = await Promise.all([
    prnInts.length
      ? prisma.patientDetails.findMany({
          where: { prn: { in: prnInts } },
          select: { prn: true, name: true, age: true, gender: true },
        })
      : [],
    prisma.ipdInitialAssessment.findMany({
      where: { admissionId: { in: admissions.map((a) => a.id) } },
      select: {
        admissionId: true, vitalsWeight: true, vitalsHeight: true, dietType: true,
        allergyFood: true, allergyOthers: true, isPregnant: true, pregnancyWeeks: true,
        nutrition: true, chiefComplaints: true,
      },
    }),
  ]);
  const patientMap = new Map(patients.map((p) => [String(p.prn), p]));
  const iaMap = new Map(assessments.map((a) => [a.admissionId, a]));

  return admissions.map((a) => {
    const p = patientMap.get(a.prn);
    const ia = iaMap.get(a.id);
    return {
      admissionId: a.id,
      admissionNo: a.admissionNo,
      admissionDate: a.admissionDate,
      prn: a.prn,
      patientName: p?.name ?? null,
      age: p?.age ?? null,
      sex: p?.gender ?? null,
      wardId: a.wardId,
      wardName: a.ward?.wardName ?? null,
      bedNumber: a.bed?.bedNumber ?? null,
      department: a.department,
      consultant: a.admittingDoctor,
      diagnosis: a.diagnosis,
      ia: ia
        ? {
            weightKg: toNum(ia.vitalsWeight),
            heightCm: toNum(ia.vitalsHeight),
            dietPattern: ia.dietType ?? null,
            foodAllergy: ia.allergyFood,
            allergyOthers: ia.allergyOthers ?? null,
            isPregnant: ia.isPregnant,
            pregnancyWeeks: ia.pregnancyWeeks ?? null,
            nutritionNote: ia.nutrition ?? null,
            chiefComplaints: ia.chiefComplaints ?? null,
          }
        : null,
    };
  });
}

/** Current plan per admission: newest ACTIVE, else the census INTERIM plan. */
export async function loadCurrentPlans(admissionIds: string[]): Promise<Map<string, CurrentPlanSummary>> {
  const out = new Map<string, CurrentPlanSummary>();
  if (!admissionIds.length) return out;
  const plans = await prisma.dietPlan.findMany({
    where: { admissionId: { in: admissionIds }, status: { in: ['ACTIVE', 'INTERIM'] } },
    include: { diet: true, texture: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const p of plans) {
    const cur = out.get(p.admissionId);
    if (cur && !(cur.status === 'INTERIM' && p.status === 'ACTIVE')) continue;
    const feed = p.feedVolumeMl
      ? `${p.feedVolumeMl} ml${p.feedIntervalHours ? ` Q${p.feedIntervalHours}H` : ''}${p.feedNotes ? ` · ${p.feedNotes}` : ''}`
      : (p.feedNotes ?? null);
    out.set(p.admissionId, {
      id: p.id,
      status: p.status,
      source: p.source,
      dietId: p.dietMasterId,
      dietCode: p.diet.code,
      dietName: p.diet.name,
      dietKind: p.diet.kind,
      displayCode: p.texture ? `${p.diet.code}-${p.texture.code}` : p.diet.code,
      textureId: p.textureId,
      foodAvoid: p.foodAvoid,
      allergens: decodeDietList(p.allergensSnapshot),
      restrictions: decodeDietList(p.restrictionsSnapshot),
      fluidRestrictionMl: p.fluidRestrictionMl,
      disposablePlate: p.disposablePlate,
      npoFrom: p.npoFrom,
      npoUntil: p.npoUntil,
      feed,
      needsCheck: p.needsCheck,
      checkNote: p.checkNote,
      remarks: p.remarks,
      notesForKitchen: p.notesForKitchen,
      signedAt: p.signedAt,
      signedBy: p.signedBy,
      updatedAt: p.updatedAt,
    });
  }
  return out;
}

/** "No curd/fruits · Allergy: Peanut" — avoid text + allergen list for sheet / label. */
export function avoidText(plan: CurrentPlanSummary | undefined): string | null {
  if (!plan) return null;
  const parts: string[] = [];
  if (plan.foodAvoid) parts.push(plan.foodAvoid);
  if (plan.allergens.length) parts.push(`Allergy: ${plan.allergens.join(', ')}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "F/R 1.2 L/D · Disposable · <remarks>" for the sheet's Remark column. */
export function remarkText(plan: CurrentPlanSummary | undefined): string | null {
  if (!plan) return null;
  const parts: string[] = [];
  if (plan.fluidRestrictionMl) {
    parts.push(plan.fluidRestrictionMl >= 1000
      ? `F/R ${+(plan.fluidRestrictionMl / 1000).toFixed(2)} L/D`
      : `F/R ${plan.fluidRestrictionMl} ml/D`);
  }
  if (plan.disposablePlate) parts.push('Disposable');
  if (plan.feed) parts.push(`Feed: ${plan.feed}`);
  if (plan.remarks) parts.push(plan.remarks);
  return parts.length ? parts.join(' · ') : null;
}
