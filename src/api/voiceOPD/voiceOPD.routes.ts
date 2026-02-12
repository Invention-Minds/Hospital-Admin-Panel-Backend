import { Router } from "express";
import { voiceAssessment } from "./voiceOPD.controller";
import { upload } from "../../config/multer"

const router = Router();

router.post("/voice-assessment", upload.single("audio"), voiceAssessment);

export default router;
