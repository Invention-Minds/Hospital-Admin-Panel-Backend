import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../../middleware/middleware';
import { createSignature, getSignature, listByContext } from './signature.controller';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Read endpoints — any authenticated user can fetch their own / linked signatures.
router.get('/', authenticateToken, listByContext);
router.get('/:id', authenticateToken, getSignature);

// Write endpoint — accepts JSON (dataUrl) or multipart (file).
// The clinical-actor guard is intentionally NOT applied here because patients
// and attenders can also sign (they don't have a User.id). The controller
// records `signerId` only for staff signers anyway.
router.post('/', authenticateToken, upload.single('file'), createSignature);

export default router;
