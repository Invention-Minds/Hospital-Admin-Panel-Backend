/**
 * Module Utilization analytics — canonical module-key → friendly label map.
 *
 * Keys are the `module` strings written to AppAuditLog by auditLog()
 * (src/service/app-audit.ts) from the 63+ controllers. This list was built by
 * grepping every `module: '<key>'` call site in src/. Unknown keys that show
 * up later (new modules, or dynamic values like the lama/dama `type`) still
 * render — labelForModule() falls back to a title-cased version of the key.
 */
export const MODULE_LABELS: Record<string, string> = {
  'bed-census': 'Bed Census',
  'bed-request': 'Bed Requests',
  'complaint': 'Complaints',
  'consent': 'Consent Management',
  'daily-closure': 'Daily Closure',
  'dama': 'DAMA',
  'day-care': 'Day Care',
  'dietetics': 'Dietetics',
  'discharge': 'Discharge',
  'discharge-ai': 'Discharge AI Summary',
  'discharge-clearance': 'Discharge Clearance',
  'emergency-codes': 'Emergency Codes',
  'emergency-referral': 'Emergency Referrals',
  'facility-ambulance': 'Facility — Ambulance',
  'facility-equipment': 'Facility — Equipment',
  'facility-equipment-event': 'Facility — Equipment Events',
  'facility-maintenance': 'Facility — Maintenance',
  'facility-utility': 'Facility — Utilities',
  'feature-flag': 'Feature Flags',
  'feedback': 'Patient Feedback',
  'follow-up': 'Follow-ups',
  'icu': 'ICU',
  'icu-nurses-care': 'ICU Nursing Care',
  'icu-transfer': 'ICU Transfers',
  'incident': 'Incident Management',
  'investigation': 'Investigations',
  'ipd': 'IPD',
  'ipd-insulin': 'IPD Insulin',
  'ipd-mar': 'IPD MAR',
  'ipd-pharmacy': 'IPD Pharmacy',
  'lab-radiology': 'Lab & Radiology Results',
  'lama': 'LAMA',
  'mlc': 'MLC Cases',
  'mrd': 'MRD',
  'nabh-audit': 'NABH Audit',
  'note-template': 'Note Templates',
  'nursing-station': 'Nursing Stations',
  'op-procedure': 'OP Procedures',
  'opd': 'OPD',
  'opd-assessment': 'OPD Assessment',
  'ot': 'OT Workflow',
  'ot-clearance': 'OT Clearance',
  'ot-intra-op': 'OT Intra-op',
  'ot-outcome': 'OT Outcomes',
  'ot-pacu': 'OT PACU',
  'ot-pre-op': 'OT Pre-op',
  'ot-room': 'OT Rooms',
  'ot-safety': 'OT Safety Checklists',
  'ot-schedule': 'OT Scheduling',
  'ot-ward-transfer': 'OT Ward Transfers',
  'patient': 'Patient Management',
  'pharmacy': 'Pharmacy',
  'pharmacy-critical-drug': 'Pharmacy — Critical Drugs',
  'pharmacy-handshake': 'Pharmacy Handshake',
  'pharmacy-stock': 'Pharmacy — Stock Events',
  'prescription': 'Prescriptions',
  'quality-audit': 'Quality — Audits',
  'quality-denominator': 'Quality — Denominators',
  'quality-device-day': 'Quality — Device Days',
  'quality-indicator': 'Quality Indicators',
  'quality-lab-rad': 'Quality — Lab/Rad Events',
  'quality-rca': 'Quality — RCA',
  'quality-sterilization': 'Quality — Sterilization',
  'quality-surveillance': 'Quality — Surveillance',
  'quality-tat-event': 'Quality — TAT Events',
  'revenue': 'Revenue',
  'role-alias': 'Role Aliases',
  'scheduling': 'Staff Scheduling',
  'signature': 'Signatures',
  'staff': 'Staff Admin',
  'staff-handover': 'Staff Handover',
  'treatment-dashboard': 'Treatment Dashboard',
};

/** Title-cased fallback for module keys not in the map (e.g. 'foo-bar' → 'Foo Bar'). */
export const labelForModule = (key: string): string =>
  MODULE_LABELS[key] ??
  key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
