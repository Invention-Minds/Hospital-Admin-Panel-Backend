import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import {
  createOtRoom,
  listOtRooms,
  updateOtRoom,
  updateOtRoomStatus,
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  cancelSchedule,
  rescheduleSchedule,
  startSchedule,
  endSchedule,
} from './ot-schedule.controller';
import {
  upsertPreOp,
  signIn,
  timeOut,
  signOut,
  signSafetyRole,
  upsertIntraOp,
  appendAnaesthesiaTick,
  getAnaesthesiaChart,
  upsertPacu,
  appendPacuVital,
  dischargeFromPacu,
  upsertOutcome,
} from './ot-clinical.controller';
import { getOtKpis } from './ot-kpi.controller';
import {
  getForSchedule as getNursingChart,
  upsertForSchedule as upsertNursingChart,
  signRole as signNursingChartRole,
} from './ot-nursing-chart.controller';
import {
  listRequisitions, getRequisition, createRequisition, updateRequisition, cancelRequisition,
} from './ot-requisition.controller';
import {
  listStaff, addStaff, updateStaff, removeStaff,
  listSurgeries, addSurgery, updateSurgery, removeSurgery,
} from './ot-staff-surgery.controller';
import {
  listEquipment, addEquipment, updateEquipment, removeEquipment,
  listConsumableSets, getConsumableSet, createConsumableSet, updateConsumableSet,
  addConsumableSetItem, removeConsumableSetItem,
  listConsumableIssues, issueConsumables, returnConsumables, removeConsumableIssue,
} from './ot-equipment-consumable.controller';
import {
  getClearance, upsertClearance, clearForOt, rejectClearance, resetClearance,
} from './ot-clearance.controller';
import {
  listSurgicalTemplates, getSurgicalTemplate, createSurgicalTemplate, updateSurgicalTemplate,
  listOtherTemplates, createOtherTemplate, updateOtherTemplate,
} from './ot-templates.controller';
import {
  surgeryRegister, equipmentUtilization, timeBookedVsActual,
  operativeNotesByAdmission,
} from './ot-reports.controller';
import {
  listEmrgSurcharges, addEmrgSurcharge, updateEmrgSurcharge,
  removeEmrgSurcharge, applyEmrgSurchargeToEstimation,
} from './ot-emrg-surcharge.controller';
import { getOtDischargeSummary } from './ot-discharge-summary.controller';
import { getOtArchives } from './ot-archives.controller';
import { getIssuedDrugsForSchedule } from './ot-issued-drugs.controller';
import {
  listEquipmentMaster, createEquipmentMaster, updateEquipmentMaster, removeEquipmentMaster,
  listFixedSurgicalNotes, createFixedSurgicalNote, updateFixedSurgicalNote, removeFixedSurgicalNote,
} from './ot-setup.controller';
import {
  listStaffMaster, createStaffMaster, updateStaffMaster, removeStaffMaster,
  listSurgeryMaster, createSurgeryMaster, updateSurgeryMaster, removeSurgeryMaster,
} from './ot-setup-staff-surgery.controller';
import {
  getWardTransfer, upsertWardTransfer, signWardTransfer, listWardTransferByAdmission,
} from './ot-ward-transfer.controller';

const router = express.Router();

// ─── KPI dashboard ────────────────────────────────────────────────────
router.get('/kpis', authenticateToken, getOtKpis);

// ─── OT Rooms ─────────────────────────────────────────────────────────
router.get('/rooms', authenticateToken, listOtRooms);
router.post('/rooms', authenticateToken, requireClinicalActor, createOtRoom);
router.put('/rooms/:id', authenticateToken, requireClinicalActor, updateOtRoom);
router.put('/rooms/:id/status', authenticateToken, requireClinicalActor, updateOtRoomStatus);

// ─── OT Schedules ─────────────────────────────────────────────────────
router.get('/schedules', authenticateToken, listSchedules);
router.get('/schedules/:id', authenticateToken, getSchedule);
router.post('/schedules', authenticateToken, requireClinicalActor, createSchedule);
router.put('/schedules/:id', authenticateToken, requireClinicalActor, updateSchedule);
router.post('/schedules/:id/cancel', authenticateToken, requireClinicalActor, cancelSchedule);
router.post('/schedules/:id/reschedule', authenticateToken, requireClinicalActor, rescheduleSchedule);
router.post('/schedules/:id/start', authenticateToken, requireClinicalActor, startSchedule);
router.post('/schedules/:id/end', authenticateToken, requireClinicalActor, endSchedule);

// ─── Clinical artefacts (per schedule) ────────────────────────────────
router.put('/schedules/:scheduleId/pre-op', authenticateToken, requireClinicalActor, upsertPreOp);
router.post('/schedules/:scheduleId/safety/sign-in', authenticateToken, requireClinicalActor, signIn);
router.post('/schedules/:scheduleId/safety/time-out', authenticateToken, requireClinicalActor, timeOut);
router.post('/schedules/:scheduleId/safety/sign-out', authenticateToken, requireClinicalActor, signOut);
// Phase 9.4b — Multi-role chain: phase ∈ {signIn|timeOut|signOut}, role ∈ {surgeon|anaesthetist|nurse|technician}
router.post('/schedules/:scheduleId/safety/:phase/sign/:role', authenticateToken, requireClinicalActor, signSafetyRole);
router.put('/schedules/:scheduleId/intra-op', authenticateToken, requireClinicalActor, upsertIntraOp);
router.get('/schedules/:scheduleId/anaesthesia', authenticateToken, getAnaesthesiaChart);
router.post('/schedules/:scheduleId/anaesthesia', authenticateToken, requireClinicalActor, appendAnaesthesiaTick);
router.put('/schedules/:scheduleId/pacu', authenticateToken, requireClinicalActor, upsertPacu);
router.post('/schedules/:scheduleId/pacu/vital', authenticateToken, requireClinicalActor, appendPacuVital);
router.post('/schedules/:scheduleId/pacu/discharge', authenticateToken, requireClinicalActor, dischargeFromPacu);
router.put('/schedules/:scheduleId/outcome', authenticateToken, requireClinicalActor, upsertOutcome);

// Phase 4b — Intra-Op Nursing Chart (scrub / floor / OT-incharge sign chain).
router.get('/schedules/:scheduleId/nursing-chart', authenticateToken, getNursingChart);
router.put('/schedules/:scheduleId/nursing-chart', authenticateToken, requireClinicalActor, upsertNursingChart);
router.post('/schedules/:scheduleId/nursing-chart/sign/:role', authenticateToken, requireClinicalActor, signNursingChartRole);

// Phase 9.12 — Ward → OT Pre-Operative Surgical Safety Checklist (UHJ nursing format).
router.get('/schedules/:scheduleId/ward-transfer', authenticateToken, getWardTransfer);
router.put('/schedules/:scheduleId/ward-transfer', authenticateToken, requireClinicalActor, upsertWardTransfer);
router.post('/schedules/:scheduleId/ward-transfer/sign/:role', authenticateToken, requireClinicalActor, signWardTransfer);
router.get('/ward-transfer/by-admission/:admissionId', authenticateToken, listWardTransferByAdmission);

// ─── Phase 9.1a — OT Requisition queue ──────────────────────────────────
router.get('/requisitions', authenticateToken, listRequisitions);
router.get('/requisitions/:id', authenticateToken, getRequisition);
router.post('/requisitions', authenticateToken, requireClinicalActor, createRequisition);
router.put('/requisitions/:id', authenticateToken, requireClinicalActor, updateRequisition);
router.post('/requisitions/:id/cancel', authenticateToken, requireClinicalActor, cancelRequisition);

// ─── Phase 9.1a — Multi-staff + multi-surgery per schedule ──────────────
router.get('/schedules/:scheduleId/staff', authenticateToken, listStaff);
router.post('/schedules/:scheduleId/staff', authenticateToken, requireClinicalActor, addStaff);
router.put('/schedules/:scheduleId/staff/:rowId', authenticateToken, requireClinicalActor, updateStaff);
router.delete('/schedules/:scheduleId/staff/:rowId', authenticateToken, requireClinicalActor, removeStaff);

router.get('/schedules/:scheduleId/surgeries', authenticateToken, listSurgeries);
router.post('/schedules/:scheduleId/surgeries', authenticateToken, requireClinicalActor, addSurgery);
router.put('/schedules/:scheduleId/surgeries/:rowId', authenticateToken, requireClinicalActor, updateSurgery);
router.delete('/schedules/:scheduleId/surgeries/:rowId', authenticateToken, requireClinicalActor, removeSurgery);

// ─── Phase 9.1b — Equipment usage ───────────────────────────────────────
router.get('/schedules/:scheduleId/equipment', authenticateToken, listEquipment);
router.post('/schedules/:scheduleId/equipment', authenticateToken, requireClinicalActor, addEquipment);
router.put('/schedules/:scheduleId/equipment/:rowId', authenticateToken, requireClinicalActor, updateEquipment);
router.delete('/schedules/:scheduleId/equipment/:rowId', authenticateToken, requireClinicalActor, removeEquipment);

// ─── Phase 9.1b — Consumable Set master ─────────────────────────────────
router.get('/consumable-sets', authenticateToken, listConsumableSets);
router.get('/consumable-sets/:id', authenticateToken, getConsumableSet);
router.post('/consumable-sets', authenticateToken, requireClinicalActor, createConsumableSet);
router.put('/consumable-sets/:id', authenticateToken, requireClinicalActor, updateConsumableSet);
router.post('/consumable-sets/:id/items', authenticateToken, requireClinicalActor, addConsumableSetItem);
router.delete('/consumable-sets/:id/items/:itemId', authenticateToken, requireClinicalActor, removeConsumableSetItem);

// ─── Phase 9.1b — Per-schedule consumable issue / return ledger ─────────
router.get('/schedules/:scheduleId/consumables', authenticateToken, listConsumableIssues);
router.post('/schedules/:scheduleId/consumables/issue', authenticateToken, requireClinicalActor, issueConsumables);
router.post('/schedules/:scheduleId/consumables/return', authenticateToken, requireClinicalActor, returnConsumables);
router.delete('/schedules/:scheduleId/consumables/:rowId', authenticateToken, requireClinicalActor, removeConsumableIssue);

// ─── Phase 9.1c — OT Clearance (UHJ/IPS/F-32) ───────────────────────────
router.get('/schedules/:scheduleId/clearance', authenticateToken, getClearance);
router.put('/schedules/:scheduleId/clearance', authenticateToken, requireClinicalActor, upsertClearance);
router.post('/schedules/:scheduleId/clearance/clear', authenticateToken, requireClinicalActor, clearForOt);
router.post('/schedules/:scheduleId/clearance/reject', authenticateToken, requireClinicalActor, rejectClearance);
// Phase 9.3d — Reset (undo cleared/rejected → pending)
router.post('/schedules/:scheduleId/clearance/reset', authenticateToken, requireClinicalActor, resetClearance);

// ─── Phase 9.3a — OT reports (Surgery Register / Equipment / Time Booked vs Actual) ─
router.get('/reports/surgery-register', authenticateToken, surgeryRegister);
router.get('/reports/equipment-utilization', authenticateToken, equipmentUtilization);
router.get('/reports/time-booked-vs-actual', authenticateToken, timeBookedVsActual);

// ─── Phase 9.3b — Operative notes by admission (Discharge Summary integration) ─
router.get('/admission/:admissionId/operative-notes', authenticateToken, operativeNotesByAdmission);

// ─── Phase 9.5a — Emergency Surgery Charges ─────────────────────────────
router.get('/schedules/:scheduleId/emrg-surcharges', authenticateToken, listEmrgSurcharges);
router.post('/schedules/:scheduleId/emrg-surcharges', authenticateToken, requireClinicalActor, addEmrgSurcharge);
router.put('/emrg-surcharges/:id', authenticateToken, requireClinicalActor, updateEmrgSurcharge);
router.delete('/emrg-surcharges/:id', authenticateToken, requireClinicalActor, removeEmrgSurcharge);
router.post('/emrg-surcharges/:id/apply', authenticateToken, requireClinicalActor, applyEmrgSurchargeToEstimation);

// ─── Phase 9.5b — OT Discharge Summary aggregator ───────────────────────
router.get('/admission/:admissionId/discharge-summary', authenticateToken, getOtDischargeSummary);

// ─── Phase 9.5c — OT Archives (patient profile) ─────────────────────────
router.get('/patient/:prn/archives', authenticateToken, getOtArchives);

// ─── Phase 9.5d — View Issued Drugs (read-only) ─────────────────────────
router.get('/schedules/:scheduleId/issued-drugs', authenticateToken, getIssuedDrugsForSchedule);

// ─── Phase 9.5e — OT Setup masters (Equipment + Fixed Surgical Notes) ───
router.get('/setup/equipment-master', authenticateToken, listEquipmentMaster);
router.post('/setup/equipment-master', authenticateToken, requireClinicalActor, createEquipmentMaster);
router.put('/setup/equipment-master/:id', authenticateToken, requireClinicalActor, updateEquipmentMaster);
router.delete('/setup/equipment-master/:id', authenticateToken, requireClinicalActor, removeEquipmentMaster);

router.get('/setup/fixed-surgical-notes', authenticateToken, listFixedSurgicalNotes);
router.post('/setup/fixed-surgical-notes', authenticateToken, requireClinicalActor, createFixedSurgicalNote);
router.put('/setup/fixed-surgical-notes/:id', authenticateToken, requireClinicalActor, updateFixedSurgicalNote);
router.delete('/setup/fixed-surgical-notes/:id', authenticateToken, requireClinicalActor, removeFixedSurgicalNote);

// Phase 9.5j — Staff master + Surgery/Procedure master admin routes
router.get('/setup/staff-master', authenticateToken, listStaffMaster);
router.post('/setup/staff-master', authenticateToken, requireClinicalActor, createStaffMaster);
router.put('/setup/staff-master/:id', authenticateToken, requireClinicalActor, updateStaffMaster);
router.delete('/setup/staff-master/:id', authenticateToken, requireClinicalActor, removeStaffMaster);

router.get('/setup/surgery-master', authenticateToken, listSurgeryMaster);
router.post('/setup/surgery-master', authenticateToken, requireClinicalActor, createSurgeryMaster);
router.put('/setup/surgery-master/:id', authenticateToken, requireClinicalActor, updateSurgeryMaster);
router.delete('/setup/surgery-master/:id', authenticateToken, requireClinicalActor, removeSurgeryMaster);

// ─── Phase 9.1c — Surgical Notes & Other Notes templates ────────────────
router.get('/templates/surgical', authenticateToken, listSurgicalTemplates);
router.get('/templates/surgical/:id', authenticateToken, getSurgicalTemplate);
router.post('/templates/surgical', authenticateToken, requireClinicalActor, createSurgicalTemplate);
router.put('/templates/surgical/:id', authenticateToken, requireClinicalActor, updateSurgicalTemplate);
router.get('/templates/other', authenticateToken, listOtherTemplates);
router.post('/templates/other', authenticateToken, requireClinicalActor, createOtherTemplate);
router.put('/templates/other/:id', authenticateToken, requireClinicalActor, updateOtherTemplate);

export default router;
