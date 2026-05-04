import express from "express";
import multer from "multer";
import {
  createLamaRecord,
  createDamaRecord,
  getLamaRecord,
  getDamaRecord,
  getLamaDamaRecords,
  getAllLamaRecords,
  getAllDamaRecords,
  getRecordsByDateRange,
  updateLamaRecord,
  updateDamaRecord,
  getLamaByEmergency,
  getDamaByEmergency,
  uploadLamaPatientSignature,
  uploadLamaWitnessSignature,
  uploadDamaPatientSignature,
  uploadDamaWitnessSignature,
  getLamaDamaStats,
  downloadLamaDocumentation,
  downloadDamaDocumentation,
  generateLamaReport,
  generateDamaReport,
  verifyDocumentation,
  getComplianceReport,
} from "./lama-dama.controller";
import { authenticateToken } from "../../middleware/middleware";
import { requireClinicalActor } from "../../middleware/audit-guard";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Specific paths before /:id
router.get("/lama-list", authenticateToken, getAllLamaRecords);
router.get("/dama-list", authenticateToken, getAllDamaRecords);
router.get("/by-date", authenticateToken, getRecordsByDateRange);
router.get("/stats", authenticateToken, getLamaDamaStats);
router.get("/compliance-report", authenticateToken, getComplianceReport);

// Create (clinical write; NABH MRD.1 guard)
router.post("/lama", authenticateToken, requireClinicalActor, createLamaRecord);
router.post("/dama", authenticateToken, requireClinicalActor, createDamaRecord);

// Get single (support ?emergencyId query for lookup OR /:id path param)
router.get("/lama", authenticateToken, getLamaByEmergency);
router.get("/dama", authenticateToken, getDamaByEmergency);
router.get("/lama/:id", authenticateToken, getLamaRecord);
router.get("/dama/:id", authenticateToken, getDamaRecord);

// Update (clinical write)
router.put("/lama/:id", authenticateToken, requireClinicalActor, updateLamaRecord);
router.put("/dama/:id", authenticateToken, requireClinicalActor, updateDamaRecord);

// Signature uploads (clinical write)
router.post(
  "/lama/:id/upload-patient-signature",
  authenticateToken,
  requireClinicalActor,
  upload.single("file"),
  uploadLamaPatientSignature
);
router.post(
  "/lama/:id/upload-witness-signature",
  authenticateToken,
  requireClinicalActor,
  upload.single("file"),
  uploadLamaWitnessSignature
);
router.post(
  "/dama/:id/upload-patient-signature",
  authenticateToken,
  requireClinicalActor,
  upload.single("file"),
  uploadDamaPatientSignature
);
router.post(
  "/dama/:id/upload-witness-signature",
  authenticateToken,
  requireClinicalActor,
  upload.single("file"),
  uploadDamaWitnessSignature
);

// Downloads
router.get("/lama/:id/download", authenticateToken, downloadLamaDocumentation);
router.get("/dama/:id/download", authenticateToken, downloadDamaDocumentation);
router.get("/lama/:id/report-pdf", authenticateToken, generateLamaReport);
router.get("/dama/:id/report-pdf", authenticateToken, generateDamaReport);

// Verification
router.post("/:type/:id/verify", authenticateToken, verifyDocumentation);

// Combined list
router.get("/", authenticateToken, getLamaDamaRecords);

export default router;
