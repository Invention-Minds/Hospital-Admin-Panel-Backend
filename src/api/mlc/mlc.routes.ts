import express from "express";
import multer from "multer";
import {
  registerMlcCase,
  getMlcCase,
  recordExamination,
  recordSampleCollection,
  submitReport,
  getPendingReports,
  getMlcCaseList,
  getMlcCaseByNumber,
  getMlcCaseByEmergency,
  getMlcCasesByDate,
  updateMlcCase,
  uploadMlcPhotos,
  uploadExaminerSignature,
  uploadSubmissionProof,
  getMlcStats,
  closeMlcCase,
  getMlcCaseHistory,
  downloadMlcDocumentation,
  generateMlcReportPdf,
} from "./mlc.controller";
import { authenticateToken } from "../../middleware/middleware";
import { requireClinicalActor } from "../../middleware/audit-guard";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Specific paths BEFORE /:id
router.get("/by-number", authenticateToken, getMlcCaseByNumber);
router.get("/by-emergency", authenticateToken, getMlcCaseByEmergency);
router.get("/by-date", authenticateToken, getMlcCasesByDate);
router.get("/stats", authenticateToken, getMlcStats);
router.get("/pending-reports", authenticateToken, getPendingReports);

// Register new MLC case (clinical write; NABH MRD.1 guard)
router.post("/register", authenticateToken, requireClinicalActor, registerMlcCase);

// List all
router.get("/", authenticateToken, getMlcCaseList);

// Single case operations
router.get("/:id", authenticateToken, getMlcCase);
router.put("/:id", authenticateToken, requireClinicalActor, updateMlcCase);
router.put("/:id/examination", authenticateToken, requireClinicalActor, recordExamination);
router.put("/:id/samples", authenticateToken, requireClinicalActor, recordSampleCollection);
router.put("/:id/report", authenticateToken, requireClinicalActor, submitReport);
router.put("/:id/close", authenticateToken, requireClinicalActor, closeMlcCase);

// File uploads (multipart/form-data) — also clinical writes.
router.post(
  "/:id/upload-photos",
  authenticateToken,
  requireClinicalActor,
  upload.array("files"),
  uploadMlcPhotos
);
router.post(
  "/:id/upload-signature",
  authenticateToken,
  requireClinicalActor,
  upload.single("file"),
  uploadExaminerSignature
);
router.post(
  "/:id/upload-submission-proof",
  authenticateToken,
  requireClinicalActor,
  upload.single("file"),
  uploadSubmissionProof
);

// Reports & history
router.get("/:id/history", authenticateToken, getMlcCaseHistory);
router.get("/:id/download", authenticateToken, downloadMlcDocumentation);
router.get("/:id/report-pdf", authenticateToken, generateMlcReportPdf);

export default router;
