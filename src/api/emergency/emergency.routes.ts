import express from "express";
import {
  createEmergency,
  getEmergency,
  getEmergencyList,
  updateEmergency,
  updateEmergencyStatus,
  addProgressNote,
  getProgressNotes,
  convertToIPD,
  getEmergencyByDate,
  getEmergencyQueue,
  getEmergencyStats,
} from "./emergency.controller";
import {
  listInvestigations, createInvestigation, updateInvestigation, deleteInvestigation,
  listTreatments, createTreatment, updateTreatment, deleteTreatment,
  listProcedures, createProcedure, deleteProcedure,
  listSpecimens, createSpecimen, updateSpecimen, deleteSpecimen,
} from "./emergency-subentities.controller";
import {
  createReferral, listReferralsForEmergency, acknowledgeReferral,
  cancelReferral, myPendingReferrals, myEmergencyReferrals,
} from "./referral.controller";
import {
  listChain, createStep, updateStep, deleteStep, getSla, setSla,
} from "./escalation-config.controller";
import { getMlc, upsertMlc } from "./mlc.controller";
import { getLama, upsertLama, getDama, upsertDama } from "./ama.controller";
import { authenticateToken } from "../../middleware/middleware";

const router = express.Router();

// Specific paths BEFORE /:id to avoid collision
router.get("/by-date", authenticateToken, getEmergencyByDate);
router.get("/queue/pending", authenticateToken, getEmergencyQueue);
router.get("/stats", authenticateToken, getEmergencyStats);

// Phase 9.19 — referral acknowledgment + escalation. Specific GET paths
// MUST precede GET /:id so 'referrals' / 'config' aren't captured as :id.
router.get("/referrals/my-pending", authenticateToken, myPendingReferrals);
router.get("/referrals/mine", authenticateToken, myEmergencyReferrals);
router.post("/referral/:refId/acknowledge", authenticateToken, acknowledgeReferral);
router.post("/referral/:refId/cancel", authenticateToken, cancelReferral);
router.get("/config/escalation-chain", authenticateToken, listChain);
router.post("/config/escalation-chain", authenticateToken, createStep);
router.put("/config/escalation-chain/:id", authenticateToken, updateStep);
router.delete("/config/escalation-chain/:id", authenticateToken, deleteStep);
router.get("/config/referral-sla", authenticateToken, getSla);
router.put("/config/referral-sla", authenticateToken, setSla);

// Create new emergency case
router.post("/", authenticateToken, createEmergency);

// Get all emergency cases (with filters)
router.get("/", authenticateToken, getEmergencyList);

// Get / Update / Status
router.get("/:id", authenticateToken, getEmergency);
router.put("/:id", authenticateToken, updateEmergency);
router.put("/:id/status", authenticateToken, updateEmergencyStatus);

// Progress notes
router.post("/:id/progress-note", authenticateToken, addProgressNote);
router.get("/:id/progress-notes", authenticateToken, getProgressNotes);

// Convert to IPD
router.post("/:id/convert-to-ipd", authenticateToken, convertToIPD);

// Phase 9.19 — referrals for a specific case
router.post("/:id/referral", authenticateToken, createReferral);
router.get("/:id/referrals", authenticateToken, listReferralsForEmergency);

// Form 5 (Phase 8) — ER sub-entity CRUD (UHJ/EMR/F-01 grids)
router.get("/:id/investigations", authenticateToken, listInvestigations);
router.post("/:id/investigations", authenticateToken, createInvestigation);
router.put("/:id/investigations/:rowId", authenticateToken, updateInvestigation);
router.delete("/:id/investigations/:rowId", authenticateToken, deleteInvestigation);

router.get("/:id/treatments", authenticateToken, listTreatments);
router.post("/:id/treatments", authenticateToken, createTreatment);
router.put("/:id/treatments/:rowId", authenticateToken, updateTreatment);
router.delete("/:id/treatments/:rowId", authenticateToken, deleteTreatment);

router.get("/:id/procedures", authenticateToken, listProcedures);
router.post("/:id/procedures", authenticateToken, createProcedure);
router.delete("/:id/procedures/:rowId", authenticateToken, deleteProcedure);

router.get("/:id/specimens", authenticateToken, listSpecimens);
router.post("/:id/specimens", authenticateToken, createSpecimen);
router.put("/:id/specimens/:rowId", authenticateToken, updateSpecimen);
router.delete("/:id/specimens/:rowId", authenticateToken, deleteSpecimen);

// MLC (Medico-Legal Case) — one per emergency (emergencyId @unique)
router.get("/:id/mlc", authenticateToken, getMlc);
router.post("/:id/mlc", authenticateToken, upsertMlc);

// AMA — LAMA / DAMA records (one per emergency, emergencyId @unique)
router.get("/:id/lama", authenticateToken, getLama);
router.post("/:id/lama", authenticateToken, upsertLama);
router.get("/:id/dama", authenticateToken, getDama);
router.post("/:id/dama", authenticateToken, upsertDama);

export default router;
