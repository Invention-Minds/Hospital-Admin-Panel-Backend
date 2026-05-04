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
import { authenticateToken } from "../../middleware/middleware";

const router = express.Router();

// Specific paths BEFORE /:id to avoid collision
router.get("/by-date", authenticateToken, getEmergencyByDate);
router.get("/queue/pending", authenticateToken, getEmergencyQueue);
router.get("/stats", authenticateToken, getEmergencyStats);

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

export default router;
