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
import {
  getTherapistAvailability,
  addTherapistUnavailableDates,
  getTherapistUnavailableDates,
  markTherapistDatesAvailable,
  addTherapistUnavailableSlots,
  getTherapistUnavailableSlots,
} from "./therapist-availability.controller";
import {
  createTherapyCourse,
  getTherapyCourses,
  getTherapyCourseById,
  previewCourseReschedule,
  applyCourseReschedule,
  cancelTherapyCourse,
  getPlannedDaysByDate,
} from "./therapy-course.controller";
import { authenticateToken } from "../../middleware/middleware";

const router = Router();

router.post("/", createTherapyAppointment);
router.get("/", getAllTherapyAppointments);
router.patch("/checkin/:id", checkInTherapyAppointment);
router.get("/ayurveda-doctors", getAyurvedaDoctors);
router.get("/schedule/:date", getTherapyScheduleByDate);

// Therapist availability (blocks-only model)
router.get("/availability", getTherapistAvailability);
router.post("/unavailable-dates", addTherapistUnavailableDates);
router.get("/unavailable-dates", getTherapistUnavailableDates);
router.post("/unavailable-slots", addTherapistUnavailableSlots);
router.patch("/therapist/:therapistId/mark-available", markTherapistDatesAvailable);
router.get("/therapist/:therapistId/unavailable-slots", getTherapistUnavailableSlots);

// Multi-day therapy courses
router.get("/planned-days", getPlannedDaysByDate);
router.post("/courses", createTherapyCourse);
router.get("/courses", getTherapyCourses);
router.post("/courses/:id/reschedule-preview", previewCourseReschedule);
router.post("/courses/:id/reschedule", applyCourseReschedule);
router.patch("/courses/:id/cancel", cancelTherapyCourse);
router.get("/courses/:id", getTherapyCourseById);
router.get('/confirmed',getConfirmedAppointments);
router.get('/cancelled',getCancelledAppointments);
router.get('/completed', getCompletedAppointments);
router.patch("/cancel/:id", cancelTherapyAppointment);
router.patch("/lock/:id", authenticateToken, lockTherapyAppointment);
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






