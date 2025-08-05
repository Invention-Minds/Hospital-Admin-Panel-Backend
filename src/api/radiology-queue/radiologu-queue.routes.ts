import { Router } from "express";
import {
  completeCheckIn,
  getLock,
  manualUnlock,
} from "../radiology-queue/radiology-queue.controller";

const router = Router();

router.post("/:id/checkin", completeCheckIn);
router.get("/system-lock/check-in", getLock);
router.post("/unlock-checkins", manualUnlock);

export default router;
