import { Router } from "express";
import {
  createERAssessment,
  getAllERAssessments,
  getERAssessmentByAppointmentId,
  updateERAssessment,
} from "./er.controller";
import { authenticateToken } from "../../middleware/middleware";
import { requireClinicalActor } from "../../middleware/audit-guard";

const router = Router();

router.post("/", authenticateToken, requireClinicalActor, createERAssessment);
router.get("/:appointmentId", getERAssessmentByAppointmentId);
router.put("/:id", authenticateToken, requireClinicalActor, updateERAssessment);
router.get("/", getAllERAssessments);

export default router;
