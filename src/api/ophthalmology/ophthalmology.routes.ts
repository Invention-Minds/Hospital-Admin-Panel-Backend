import { Router } from "express";
import { authenticateToken } from '../../middleware/middleware';
import {
  saveOphthalmologyPrescription,
  getPrescriptionByAppointment,
  getPatientEyeHistory,
  deleteOphthalmologyPrescription,
  addExamOption,
  getExamOptions,
  logDropAdministration,
  getDropsByAppointment,
  getOptometryQueue,
  submitWorkup,
  verifyWorkup,
} from "./ophthalmology.controller";

const router = Router();

router.post("/save", authenticateToken, saveOphthalmologyPrescription); // Create/Update
router.get("/appointment/:appointmentId", authenticateToken, getPrescriptionByAppointment);
router.get("/history/:prn", authenticateToken, getPatientEyeHistory);
router.delete("/:id", authenticateToken, deleteOphthalmologyPrescription);
router.post("/options/add", authenticateToken, addExamOption);
router.get("/options/:fieldName", authenticateToken, getExamOptions);

// Optometrist work-up ↔ doctor verification. Role is enforced in the
// controller (resolved from the DB — the JWT carries no role claim).
router.get("/queue", authenticateToken, getOptometryQueue);
router.post("/workup/submit", authenticateToken, submitWorkup);
router.post("/:prescriptionId/verify", authenticateToken, verifyWorkup);

// In-OPD drop administration (dilation / anaesthetic drops instilled in clinic)
router.post("/drops", authenticateToken, logDropAdministration);
router.get("/drops/:appointmentId", authenticateToken, getDropsByAppointment);

export default router;
