import { Router } from 'express';
import { getAllAds, updateAdStatus } from './ad.controller';
const { uploadTextAd, uploadMediaAd, getLatestAds } = require("../ad/ad.controller");

const router = Router();

// Routes
router.post("/upload-text", uploadTextAd);
router.post("/upload-media", uploadMediaAd);
router.get("/latest-ads", getLatestAds);
router.get("/all-ads", getAllAds);
router.patch('/update-status', updateAdStatus)

export default router;
