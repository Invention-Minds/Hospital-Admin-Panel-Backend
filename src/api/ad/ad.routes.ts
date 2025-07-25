import { Router } from 'express';
import { deleteMedia, getAllAds, toggleImageMediaStatus, updateAdStatus } from './ad.controller';
const { uploadTextAd, uploadMediaAd, getLatestAds } = require("../ad/ad.controller");

const router = Router();

// Routes
router.post("/upload-text", uploadTextAd);
router.post("/upload-media", uploadMediaAd);
router.get("/latest-ads", getLatestAds);
router.get("/all-ads", getAllAds);
router.patch('/update-status', updateAdStatus);
router.delete('/media/:id', deleteMedia);
router.put('/media/:id/status', toggleImageMediaStatus);


export default router;
