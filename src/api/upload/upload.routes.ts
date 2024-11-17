import express from 'express';
import multer from 'multer';
import { uploadImage, deleteOldFiles } from './upload.controller';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Route to handle image upload
router.post('/upload', upload.single('image'), uploadImage);

setInterval(deleteOldFiles, 24 * 24 * 60 * 1000);

export default router;
