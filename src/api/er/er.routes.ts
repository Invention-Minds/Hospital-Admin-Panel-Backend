import { Router } from "express";
import {
  createERAssessment,
  getAllERAssessments,
  getERAssessmentByAppointmentId,
  updateERAssessment,
} from "./er.controller";

const router = Router();

router.post("/", createERAssessment);
router.get("/:appointmentId", getERAssessmentByAppointmentId);
router.put("/:id", updateERAssessment);
router.get("/", getAllERAssessments);

export default router;
