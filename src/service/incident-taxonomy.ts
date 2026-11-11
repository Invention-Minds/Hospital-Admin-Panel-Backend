// Incident sub-types within each category. Categories stay fixed (quality
// indicators count by them); sub-types refine the report. Served to the staff
// form and the public QR form from GET /api/incidents/taxonomy so there is one
// list. Keys are stored in Incident.subCategory.

export const INCIDENT_TAXONOMY: Array<{ category: string; label: string; subtypes: Array<{ key: string; label: string }> }> = [
  {
    category: 'medication', label: 'Medication',
    subtypes: [
      { key: 'wrong_drug', label: 'Wrong drug' },
      { key: 'wrong_dose', label: 'Wrong dose / strength' },
      { key: 'wrong_patient', label: 'Wrong patient' },
      { key: 'wrong_route', label: 'Wrong route' },
      { key: 'wrong_time', label: 'Wrong time / frequency' },
      { key: 'omission', label: 'Dose omitted' },
      { key: 'adr', label: 'Adverse drug reaction' },
      { key: 'allergy_missed', label: 'Known allergy not checked' },
      { key: 'prescribing_error', label: 'Prescribing error' },
      { key: 'dispensing_error', label: 'Dispensing error' },
      { key: 'high_alert', label: 'High-alert medicine error' },
    ],
  },
  {
    category: 'fall', label: 'Patient fall',
    subtypes: [
      { key: 'from_bed', label: 'Fall from bed / trolley' },
      { key: 'while_walking', label: 'Fall while walking' },
      { key: 'bathroom', label: 'Fall in bathroom / toilet' },
      { key: 'from_chair', label: 'Fall from chair / wheelchair' },
      { key: 'during_transfer', label: 'Fall during transfer' },
      { key: 'near_fall', label: 'Near fall (assisted to floor)' },
    ],
  },
  {
    category: 'clinical', label: 'Clinical care',
    subtypes: [
      { key: 'diagnostic_error', label: 'Diagnostic error / delay' },
      { key: 'delayed_treatment', label: 'Delayed treatment' },
      { key: 'surgical_complication', label: 'Surgical / procedure complication' },
      { key: 'wrong_site', label: 'Wrong site / procedure / patient' },
      { key: 'retained_item', label: 'Retained instrument / swab' },
      { key: 'transfusion_reaction', label: 'Blood transfusion reaction / error' },
      { key: 'pressure_injury', label: 'Pressure injury' },
      { key: 'unplanned_return_ot', label: 'Unplanned return to OT' },
      { key: 'unplanned_icu', label: 'Unplanned ICU transfer' },
      { key: 'restraint', label: 'Restraint-related' },
      { key: 'patient_id', label: 'Patient identification error' },
      { key: 'death_unexpected', label: 'Unexpected death' },
    ],
  },
  {
    category: 'infection', label: 'Infection control',
    subtypes: [
      { key: 'ssi', label: 'Surgical site infection' },
      { key: 'clabsi', label: 'Central line infection (CLABSI)' },
      { key: 'cauti', label: 'Catheter urinary infection (CAUTI)' },
      { key: 'vap', label: 'Ventilator pneumonia (VAP)' },
      { key: 'needle_stick', label: 'Needle-stick / sharps injury' },
      { key: 'body_fluid', label: 'Blood / body-fluid exposure' },
      { key: 'outbreak', label: 'Suspected outbreak' },
      { key: 'bmw', label: 'Biomedical waste breach' },
    ],
  },
  {
    category: 'documentation', label: 'Documentation',
    subtypes: [
      { key: 'missing_record', label: 'Missing / incomplete record' },
      { key: 'wrong_record', label: 'Entry in the wrong patient record' },
      { key: 'consent_missing', label: 'Consent missing / incomplete' },
      { key: 'lab_sample', label: 'Sample mislabelled / lost' },
      { key: 'report_error', label: 'Wrong / delayed report' },
    ],
  },
  {
    category: 'equipment', label: 'Equipment / facility',
    subtypes: [
      { key: 'equipment_failure', label: 'Equipment failure / malfunction' },
      { key: 'power_failure', label: 'Power / utility failure' },
      { key: 'gas_supply', label: 'Medical gas supply problem' },
      { key: 'fire', label: 'Fire / smoke' },
      { key: 'water_leak', label: 'Water leak / flooding' },
      { key: 'it_downtime', label: 'IT system downtime' },
    ],
  },
  {
    category: 'behavioural', label: 'Behaviour / patient rights',
    subtypes: [
      { key: 'violence_staff', label: 'Violence / abuse against staff' },
      { key: 'patient_aggression', label: 'Aggressive patient / attendant' },
      { key: 'lama_absconding', label: 'Absconding / left against advice' },
      { key: 'self_harm', label: 'Self-harm' },
      { key: 'privacy_breach', label: 'Privacy / dignity breach' },
      { key: 'communication', label: 'Communication failure' },
    ],
  },
  {
    category: 'security', label: 'Security',
    subtypes: [
      { key: 'theft', label: 'Theft / loss of property' },
      { key: 'unauthorised_access', label: 'Unauthorised access' },
      { key: 'data_breach', label: 'Data / information breach' },
      { key: 'infant_child', label: 'Infant / child security' },
    ],
  },
  {
    category: 'other', label: 'Other',
    subtypes: [
      { key: 'staff_injury', label: 'Staff injury' },
      { key: 'visitor_injury', label: 'Visitor injury' },
      { key: 'hr_policy', label: 'HR / policy breach' },
      { key: 'other', label: 'Something else' },
    ],
  },
];

const SUBTYPES = new Map(INCIDENT_TAXONOMY.map((c) => [c.category, new Set(c.subtypes.map((s) => s.key))]));

/** True when `sub` is a valid sub-type of `category` (null / undefined = none, allowed). */
export function isValidSubCategory(category: string, sub: unknown): boolean {
  if (sub === null || sub === undefined || sub === '') return true;
  return typeof sub === 'string' && !!SUBTYPES.get(category)?.has(sub);
}
