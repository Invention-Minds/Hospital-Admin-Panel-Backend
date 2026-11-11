// Starter audit checklist library — NABH-style, written for this module.
// A first draft for the Quality Manager to review and edit in the checklist
// builder; not official NABH text. Imported idempotently by code (an existing
// checklist with the same code is never overwritten).
//
// `qi` on a checklist tags every item with that audit-backed indicator, so each
// answered item (yes / no; n.a. skipped) becomes one QualityAuditObservation.
// `!` at the start of an item marks it critical (an NC alerts HOD + Quality).

export interface StarterChecklist {
  code: string;
  name: string;
  group: 'clinical' | 'quality' | 'facility';
  frequency: 'weekly' | 'monthly' | 'quarterly';
  qi?: string;
  description?: string;
  items: string[];
}

export const AUDIT_STARTER_LIBRARY: StarterChecklist[] = [
  // ── Clinical / infection control / patient safety ─────────────────────
  {
    code: 'HAND_HYGIENE', name: 'Hand hygiene', group: 'clinical', frequency: 'monthly', qi: 'ICO-006',
    description: 'Observe staff at the WHO five moments; one answer per observed opportunity type.',
    items: [
      '!Hand hygiene performed before touching a patient',
      '!Hand hygiene performed before a clean / aseptic procedure',
      '!Hand hygiene performed after body-fluid exposure risk',
      'Hand hygiene performed after touching a patient',
      'Hand hygiene performed after touching patient surroundings',
      'Correct technique and duration (20–30 s rub / 40–60 s wash)',
      'Alcohol rub available at point of care',
      'No wrist watches, rings or long / artificial nails',
    ],
  },
  {
    code: 'BMW_SEGREGATION', name: 'Biomedical waste segregation', group: 'clinical', frequency: 'monthly', qi: 'ICO-007',
    items: [
      'Colour-coded bins (yellow, red, white, blue) available at point of generation',
      '!Waste segregated correctly at source — no mixing of categories',
      'Sharps disposed in puncture-proof white containers',
      'Bins lined and not filled beyond three-quarters',
      'Bags labelled with biohazard symbol, date and area',
      'Segregation chart displayed near the bins',
      'Staff handling waste wear PPE',
      'Waste collected and moved to storage as per schedule',
    ],
  },
  {
    code: 'ICU_BUNDLES', name: 'ICU care bundles (VAP / CLABSI / CAUTI)', group: 'clinical', frequency: 'weekly',
    items: [
      'Head of bed elevated 30–45° for ventilated patients',
      'Daily sedation interruption and readiness-to-extubate assessed',
      'Oral care with chlorhexidine done as per protocol',
      '!Central line insertion checklist completed',
      'Central line dressing clean, dry, intact and dated',
      'Daily review of central line necessity documented',
      'Urinary catheter bag below bladder level, not touching floor',
      'Daily review of urinary catheter necessity documented',
    ],
  },
  {
    code: 'HIGH_ALERT_MEDS', name: 'High-alert and look-alike medicines', group: 'clinical', frequency: 'monthly',
    items: [
      'High-alert medicine list displayed in the area',
      '!Concentrated electrolytes stored separately and labelled',
      'High-alert medicines carry a distinct label',
      'Look-alike / sound-alike medicines stored apart with tall-man labels',
      '!Independent double check documented for high-alert administration',
      'Insulin and heparin stored and labelled as per policy',
      'No expired medicines in the area',
      'Refrigerator temperature log maintained (2–8 °C)',
    ],
  },
  {
    code: 'CRASH_CART', name: 'Crash cart / emergency trolley', group: 'clinical', frequency: 'weekly',
    items: [
      '!Defibrillator working, charged and tested today',
      'Emergency drugs present as per the standard list',
      'No expired drugs or consumables',
      'Airway equipment complete (laryngoscope working, ET tubes all sizes)',
      'Oxygen cylinder full and suction working',
      'Cart sealed, seal number logged',
      'Daily check log signed',
      'Staff know the cart location and code-blue number',
    ],
  },
  {
    code: 'PATIENT_ID', name: 'Patient identification', group: 'clinical', frequency: 'monthly', qi: 'PRE-006',
    items: [
      '!ID band present on the patient',
      'ID band shows name, PRN and date of birth / age',
      'Two identifiers used before medication',
      'Two identifiers used before sample collection',
      'Two identifiers used before procedures / transfusion',
      'Allergy band used where applicable',
      'Room / bed number never used as an identifier',
    ],
  },
  {
    code: 'FALL_PREVENTION', name: 'Fall prevention', group: 'clinical', frequency: 'monthly',
    items: [
      'Fall risk assessed on admission (Morse / Humpty-Dumpty)',
      'Reassessment after change in condition or transfer',
      'High-risk patients identified (band / bed sign)',
      'Bed in lowest position, brakes on',
      'Side rails up where indicated',
      'Call bell within reach',
      'Floor dry, area clutter-free, adequate lighting',
      'Patient / attendant educated on fall risk',
    ],
  },
  {
    code: 'CONSENT', name: 'Informed consent', group: 'clinical', frequency: 'monthly', qi: 'PRE-005',
    items: [
      '!Consent obtained before the procedure / surgery / anaesthesia / transfusion',
      'Consent in a language the patient understands',
      'Risks, benefits and alternatives documented',
      'Signed by patient / authorised representative, with date and time',
      'Doctor obtaining consent identified and signed',
      'Witness signature present',
      'High-risk procedures use the specific consent form',
    ],
  },
  {
    code: 'SURGICAL_SAFETY', name: 'Surgical safety checklist', group: 'clinical', frequency: 'monthly', qi: 'OT-003',
    items: [
      '!Sign-in completed before induction',
      '!Site marked before the patient enters OT',
      '!Time-out done with the full team before incision',
      'Antibiotic prophylaxis given within 60 minutes before incision',
      'Instrument, sponge and needle counts correct',
      'Specimen labelled correctly',
      'Sign-out completed before the patient leaves OT',
    ],
  },
  {
    code: 'PRESSURE_INJURY', name: 'Pressure injury prevention', group: 'clinical', frequency: 'monthly',
    items: [
      'Risk assessed on admission (Braden scale)',
      'Skin inspection documented each shift for at-risk patients',
      'Position changed at least every 2 hours (turning chart)',
      'Pressure-relieving mattress for high-risk patients',
      'Nutrition and hydration assessed',
      'Existing pressure injuries staged and documented',
    ],
  },
  {
    code: 'BLOOD_TRANSFUSION', name: 'Blood transfusion practice', group: 'clinical', frequency: 'monthly',
    items: [
      '!Consent for transfusion on file',
      '!Bedside check by two staff (patient ID, unit number, group)',
      'Transfusion started within 30 minutes of issue',
      'Vitals recorded before, 15 minutes in and after the transfusion',
      'Transfusion reaction form available; reactions reported',
      'Unit details recorded in the patient file',
    ],
  },
  // ── Quality / records ─────────────────────────────────────────────────
  {
    code: 'MEDICAL_RECORDS', name: 'Medical record completeness', group: 'quality', frequency: 'monthly', qi: 'MRD-001',
    items: [
      'Initial assessment completed within the defined time',
      'Doctor notes dated, timed, signed and legible',
      'Medication orders complete (drug, dose, route, frequency)',
      'Only approved abbreviations used',
      'Investigation reports filed',
      'Consent forms present where needed',
      'Discharge summary complete and signed',
    ],
  },
  {
    code: 'NURSING_DOCS', name: 'Nursing documentation', group: 'quality', frequency: 'monthly',
    items: [
      'Nursing admission assessment complete',
      'Care plan documented and updated',
      'Vitals charted at the ordered frequency',
      'Medication administration record signed per dose',
      'Intake–output chart maintained where ordered',
      'Handover documented each shift',
      'Entries dated, timed and signed',
    ],
  },
  {
    code: 'DISCHARGE_PROCESS', name: 'Discharge process and counselling', group: 'quality', frequency: 'monthly', qi: 'PRE-008',
    items: [
      'Discharge summary given to the patient',
      'Medicines explained (dose, timing, duration)',
      'Diet and activity advice given',
      'Warning signs and when to return explained',
      'Follow-up date and contact number given',
      'Counselling documented in the record',
    ],
  },
  // ── Facility and support services ─────────────────────────────────────
  {
    code: 'FIRE_SAFETY', name: 'Fire safety', group: 'facility', frequency: 'monthly',
    items: [
      '!Fire extinguishers present, charged and in date',
      '!Exit routes clear and exit signs lit',
      'Fire alarm panel shows no faults',
      'Evacuation plan displayed',
      'Smoke detectors in place and not covered',
      'No overloaded sockets or exposed wiring',
      'Staff know RACE / PASS',
      'Last mock drill within 6 months',
    ],
  },
  {
    code: 'HOUSEKEEPING', name: 'Housekeeping and cleanliness', group: 'facility', frequency: 'weekly', qi: 'ICO-010',
    items: [
      'Floors clean and dry',
      'Patient rooms and beds cleaned per schedule',
      'Toilets clean, with soap and paper',
      'High-touch surfaces disinfected (rails, switches, door handles)',
      'Correct disinfectant dilution used',
      'Colour-coded mops and cloths used',
      'Cleaning checklist signed',
      'Spill kit available',
    ],
  },
  {
    code: 'KITCHEN', name: 'Kitchen and food safety', group: 'facility', frequency: 'monthly', qi: 'ICO-012',
    items: [
      'Food handlers wear cap, apron and gloves',
      'Food handlers medically screened (records)',
      'Raw and cooked food stored separately',
      'Refrigerator / freezer temperature logs maintained',
      'No expired items in store',
      'Cooking area and utensils clean',
      'Pest control records current',
      'Food samples retained per policy',
    ],
  },
  {
    code: 'CSSD', name: 'CSSD practices', group: 'facility', frequency: 'monthly',
    items: [
      'Unidirectional flow (dirty → clean → sterile) maintained',
      '!Sterilizer biological indicator test done and recorded',
      'Bowie-Dick test done daily for pre-vacuum autoclaves',
      'Chemical indicator in every pack',
      'Packs labelled with load number and expiry',
      'Sterile store clean, dry, temperature and humidity recorded',
      'Recall procedure available',
    ],
  },
  {
    code: 'PHARMACY_STORE', name: 'Pharmacy store', group: 'facility', frequency: 'monthly',
    items: [
      'Medicines stored per manufacturer conditions',
      'Cold-chain temperature log maintained',
      'No expired stock; near-expiry items flagged',
      'Narcotics in double-lock storage with register',
      'FEFO / FIFO followed',
      'Look-alike / sound-alike medicines separated',
      'Store clean, pest-free, items off the floor',
    ],
  },
  {
    code: 'LAB_SAFETY', name: 'Laboratory safety', group: 'facility', frequency: 'monthly',
    items: [
      'Staff wear PPE (coat, gloves)',
      'Biosafety cabinet certified and in use',
      'Spill kit available',
      'Sample labelling and rejection criteria followed',
      'Internal quality control run and recorded',
      'Equipment calibration up to date',
      'Waste segregated per biomedical waste rules',
    ],
  },
  {
    code: 'RADIATION_SAFETY', name: 'Radiation safety (radiology)', group: 'facility', frequency: 'quarterly', qi: 'RAD-004',
    items: [
      '!Staff wear TLD badges',
      'TLD dose reports reviewed',
      'Lead aprons and thyroid shields available and checked',
      'Radiation warning signs and lights working',
      'Pregnancy screening done before imaging',
      'AERB licence displayed and valid',
    ],
  },
  {
    code: 'LINEN', name: 'Linen and laundry', group: 'facility', frequency: 'monthly', qi: 'ICO-011',
    items: [
      'Soiled linen bagged at the point of use',
      'Infected linen in separate labelled bags',
      'Clean and soiled linen transported separately',
      'Clean linen stored covered, off the floor',
      'Washing temperature / disinfection records maintained',
      'Torn or stained linen withdrawn',
    ],
  },
];
