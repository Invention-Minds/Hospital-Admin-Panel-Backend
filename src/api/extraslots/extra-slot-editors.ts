/**
 * Who may extend a doctor's OPD hours before/after (Doctor Availability
 * Before / After buttons → POST /extraslot-count/add): admin, super_admin and
 * these employees only. Keep in sync with EXTRA_SLOT_EDITORS in the frontend
 * doctor-availability component.
 */
export const EXTRA_SLOT_EDITORS = ['JMRH370', 'JMRH124', 'JMRH356', 'JMRH575', 'JMRH519'];
