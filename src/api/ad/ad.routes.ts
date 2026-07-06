import { Router } from 'express';
import { deleteMedia, getAllAds, getAllAdsByChannel, toggleImageMediaStatus, updateAdChannels, updateAdStatus } from './ad.controller';
const { uploadTextAd, uploadMediaAd, getLatestAds } = require("../ad/ad.controller");
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

// Routes
// Write routes require auth. GET routes stay public — consumed by digital-
// signage / display screens that have no logged-in user.
router.post("/upload-text", authenticateToken, uploadTextAd);
router.post("/upload-media", authenticateToken, uploadMediaAd);
router.get("/latest-ads", getLatestAds);
router.get("/all-ads", getAllAds);
router.get("/channel-ads", getAllAdsByChannel);
router.post('/update-channels', authenticateToken, updateAdChannels);
router.patch('/update-status', authenticateToken, updateAdStatus);
router.delete('/media/:id', authenticateToken, deleteMedia);
router.put('/media/:id/status', authenticateToken, toggleImageMediaStatus);



export default router;
