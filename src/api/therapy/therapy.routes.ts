import { Router } from "express";
import {
  createTherapy,
  getAllTherapies,
  getTherapyById,
  updateTherapy,
  deleteTherapy,
  createTherapyAppointment,
  getAllTherapyAppointments,
  checkInTherapyAppointment,
  createTherapist,
  getAllTherapists,
  getTherapistById,
  updateTherapist,
  deleteTherapist,
  getAyurvedaDoctors,
  getTherapyScheduleByDate,
  getConfirmedAppointments,
  getCancelledAppointments,
  getCompletedAppointments,
  updateTherapyAppointment,
  cancelTherapyAppointment,
  lockTherapyAppointment,
  unlockTherapyAppointment,
  updateTherapyProgress,
  getTodayCheckedInTherapiesByTherapist,
  getTodayConfirmedTherapies,
} from "./therapy.controller";

const router = Router();

router.post("/", createTherapyAppointment);
router.get("/", getAllTherapyAppointments);
router.patch("/checkin/:id", checkInTherapyAppointment);
router.get("/ayurveda-doctors", getAyurvedaDoctors);
router.get("/schedule/:date", getTherapyScheduleByDate);
router.get('/confirmed',getConfirmedAppointments);
router.get('/cancelled',getCancelledAppointments);
router.get('/completed', getCompletedAppointments);
router.patch("/cancel/:id", cancelTherapyAppointment);
router.patch("/lock/:id", lockTherapyAppointment);
router.patch("/unlock/:id", unlockTherapyAppointment);
router.get("/today-confirmed/:therapistId", getTodayCheckedInTherapiesByTherapist);
router.get('/today-checkedin', getTodayConfirmedTherapies)
router.patch("/progress/:id", updateTherapyProgress);
router.put("/:id", updateTherapyAppointment);


router.post("/therapy", createTherapy);
router.get("/therapy", getAllTherapies);
router.get("/therapy/:id", getTherapyById);
router.put("/therapy/:id", updateTherapy);
router.delete("/therapy/:id", deleteTherapy);


router.post("/therapist", createTherapist);
router.get("/therapist", getAllTherapists);
router.get("/therapist/:id", getTherapistById);
router.put("/therapist/:id", updateTherapist);
router.delete("/therapist/:id", deleteTherapist);

export default router;






