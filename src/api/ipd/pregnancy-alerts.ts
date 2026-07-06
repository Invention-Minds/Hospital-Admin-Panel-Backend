import prisma from '../../service/prisma-client';

/**
 * Pregnancy / lactation teratogenic-drug alert evaluator (Phase 7).
 *
 * Caller passes the admissionId and a list of drug names being prescribed.
 * We pull the admission's IpdInitialAssessment (pregnancy / lactation
 * flags), look each drug up in TabletMaster, and return alerts when a
 * drug is flagged.
 *
 * Lookup chain:
 *   1. TabletMaster.pregnancyCategory  / lactationSafety  (seeded master)
 *   2. Fallback HARDCODED_PREGNANCY_FLAGS for common offenders so the
 *      check has teeth before pharmacy seeds the master.
 *
 * Categories follow the legacy FDA letter scheme — A | B | C | D | X —
 * with X being absolute contraindication (known fetal harm, no benefit
 * justifies use). Lactation: safe | caution | contraindicated.
 *
 * Caller decides what to do with the alerts. The IPD prescription create
 * endpoint hard-blocks until req.body.pregnancyAcknowledged === true; the
 * override is audit-logged.
 */

export interface PregnancyAlert {
  drug: string;
  source: 'pregnancy' | 'lactation';
  category: string;        // 'X' / 'D' / 'caution' / 'contraindicated' etc.
  reason: string;          // human-readable explanation
  from: 'master' | 'fallback';
}

/**
 * Fallback list for drugs that are universally accepted as teratogenic or
 * lactation-unsafe. Keyed by lowercased generic name. The master overrides
 * this once seeded by the pharmacy team.
 *
 * Sources: ACOG, AAP, FDA labelling — kept conservative on purpose; we
 * want clinicians to consciously override rather than miss a flag.
 */
const HARDCODED_PREGNANCY_FLAGS: Record<string, { category: string; reason: string }> = {
  // Category X — absolutely contraindicated
  warfarin:       { category: 'X', reason: 'Warfarin embryopathy — fetal hemorrhage / CNS abnormalities' },
  isotretinoin:   { category: 'X', reason: 'Severe craniofacial / cardiac / CNS teratogen' },
  thalidomide:    { category: 'X', reason: 'Phocomelia — limb-reduction defects' },
  methotrexate:   { category: 'X', reason: 'Folate antagonist — craniofacial / skeletal anomalies, abortifacient' },
  misoprostol:    { category: 'X', reason: 'Uterine contractions / Möbius sequence' },
  finasteride:    { category: 'X', reason: 'Anti-androgen — feminisation of male fetus' },
  // Category D — positive evidence of risk, use only if benefit outweighs
  valproate:      { category: 'D', reason: 'Neural-tube defects + autism spectrum risk' },
  phenytoin:      { category: 'D', reason: 'Fetal hydantoin syndrome — craniofacial / limb defects' },
  carbamazepine:  { category: 'D', reason: 'Neural-tube defects' },
  lithium:        { category: 'D', reason: 'Ebstein anomaly — cardiac malformation' },
  tetracycline:   { category: 'D', reason: 'Permanent tooth discoloration + bone-growth inhibition' },
  doxycycline:    { category: 'D', reason: 'Permanent tooth discoloration + bone-growth inhibition' },
  // ACE inhibitors / ARBs — 2nd & 3rd trimester contraindicated
  enalapril:      { category: 'D', reason: 'Fetal renal failure / oligohydramnios (2nd/3rd trimester)' },
  lisinopril:     { category: 'D', reason: 'Fetal renal failure / oligohydramnios (2nd/3rd trimester)' },
  ramipril:       { category: 'D', reason: 'Fetal renal failure / oligohydramnios (2nd/3rd trimester)' },
  losartan:       { category: 'D', reason: 'Fetal renal failure / oligohydramnios (2nd/3rd trimester)' },
  telmisartan:    { category: 'D', reason: 'Fetal renal failure / oligohydramnios (2nd/3rd trimester)' },
  // Statins
  atorvastatin:   { category: 'X', reason: 'Disruption of fetal cholesterol synthesis' },
  simvastatin:    { category: 'X', reason: 'Disruption of fetal cholesterol synthesis' },
  rosuvastatin:   { category: 'X', reason: 'Disruption of fetal cholesterol synthesis' },
  // NSAIDs (3rd trimester)
  ibuprofen:      { category: 'D', reason: 'Premature closure of ductus arteriosus (3rd trimester)' },
  diclofenac:     { category: 'D', reason: 'Premature closure of ductus arteriosus (3rd trimester)' },
  naproxen:       { category: 'D', reason: 'Premature closure of ductus arteriosus (3rd trimester)' },
};

const HARDCODED_LACTATION_FLAGS: Record<string, { category: string; reason: string }> = {
  amiodarone:     { category: 'contraindicated', reason: 'Iodine load — neonatal hypothyroidism' },
  chloramphenicol:{ category: 'contraindicated', reason: 'Grey baby syndrome' },
  cyclophosphamide:{ category: 'contraindicated', reason: 'Cytotoxic — neutropenia in infant' },
  methotrexate:   { category: 'contraindicated', reason: 'Cytotoxic — immunosuppression in infant' },
  ergotamine:     { category: 'contraindicated', reason: 'Suppresses lactation + neonatal toxicity' },
  cabergoline:    { category: 'contraindicated', reason: 'Suppresses lactation' },
  bromocriptine:  { category: 'contraindicated', reason: 'Suppresses lactation' },
  lithium:        { category: 'contraindicated', reason: 'Concentrates in breast milk — neonatal toxicity' },
  // Cautions
  fluoxetine:     { category: 'caution', reason: 'Long half-life — accumulates in infant' },
  diazepam:       { category: 'caution', reason: 'Accumulates — neonatal sedation / poor feeding' },
  aspirin:        { category: 'caution', reason: 'Reye syndrome risk + platelet dysfunction' },
};

/** Normalize drug name for lookup — lowercase, trim, strip common suffixes. */
function normalizeDrugName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+(tablet|tab|cap|capsule|injection|inj|syrup|syp|ointment|cream|gel)\s*$/i, '');
}

/**
 * Pull the admission's pregnancy / lactation flags off the most recent
 * IpdInitialAssessment row. Returns null when the form hasn't been filled
 * — caller treats that as "no flags" (so unfilled-form admissions don't
 * get blocked).
 */
async function getPregnancyState(admissionId: string): Promise<{
  isPregnant: boolean;
  pregnancyWeeks: number | null;
  isLactating: boolean;
} | null> {
  const row = await prisma.ipdInitialAssessment.findUnique({
    where: { admissionId },
    select: { isPregnant: true, pregnancyWeeks: true, isLactating: true },
  });
  return row;
}

/**
 * Evaluate teratogenic / lactation alerts for a list of drug names.
 *
 * @returns array of alerts (empty if patient isn't pregnant/lactating, or
 *          no flagged drugs in list).
 */
export async function evaluatePregnancyAlerts(
  admissionId: string,
  drugNames: ReadonlyArray<string>,
): Promise<PregnancyAlert[]> {
  if (!drugNames.length) return [];

  const state = await getPregnancyState(admissionId);
  if (!state) return [];
  if (!state.isPregnant && !state.isLactating) return [];

  // Master lookup — case-insensitive on genericName. We do one batch find
  // and bucket the results so the per-drug check below is in-memory.
  const masters = await prisma.tabletMaster.findMany({
    where: {
      OR: drugNames.map((n) => ({
        genericName: { equals: normalizeDrugName(n) },
      })),
    },
    select: { genericName: true, pregnancyCategory: true, lactationSafety: true },
  });
  const masterByName = new Map<string, { pregnancyCategory: string | null; lactationSafety: string | null }>();
  for (const m of masters) {
    masterByName.set(normalizeDrugName(m.genericName), {
      pregnancyCategory: m.pregnancyCategory,
      lactationSafety: m.lactationSafety,
    });
  }

  const alerts: PregnancyAlert[] = [];
  for (const raw of drugNames) {
    const key = normalizeDrugName(raw);

    if (state.isPregnant) {
      const fromMaster = masterByName.get(key)?.pregnancyCategory;
      if (fromMaster && (fromMaster === 'X' || fromMaster === 'D')) {
        alerts.push({
          drug: raw,
          source: 'pregnancy',
          category: fromMaster,
          reason: `Master flagged Category ${fromMaster} in pregnancy`,
          from: 'master',
        });
      } else if (!fromMaster) {
        const fallback = HARDCODED_PREGNANCY_FLAGS[key];
        if (fallback) {
          alerts.push({
            drug: raw,
            source: 'pregnancy',
            category: fallback.category,
            reason: fallback.reason,
            from: 'fallback',
          });
        }
      }
    }

    if (state.isLactating) {
      const fromMaster = masterByName.get(key)?.lactationSafety;
      if (fromMaster && (fromMaster === 'contraindicated' || fromMaster === 'caution')) {
        alerts.push({
          drug: raw,
          source: 'lactation',
          category: fromMaster,
          reason: `Master flagged ${fromMaster} in lactation`,
          from: 'master',
        });
      } else if (!fromMaster) {
        const fallback = HARDCODED_LACTATION_FLAGS[key];
        if (fallback) {
          alerts.push({
            drug: raw,
            source: 'lactation',
            category: fallback.category,
            reason: fallback.reason,
            from: 'fallback',
          });
        }
      }
    }
  }
  return alerts;
}
