import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { PatientController } from './patient.controller';
import { getPatientTimeline } from './patient-timeline.controller';
import { importPatientsCsv } from './patient-import.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();
const patientController = new PatientController();

// Bulk CSV import — parsed in memory (never touches disk). Sized for a full
// PatientDetails export; a CSV of this size is already ~200k rows.
const MAX_CSV_MB = 50;
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_MB * 1024 * 1024 },
});

// Multer rejects oversized/malformed uploads by throwing into the default
// Express error handler, which answers with an HTML stack trace. Translate its
// errors to the JSON shape the rest of this API returns.
const uploadCsv: RequestHandler = (req, res, next) => {
  csvUpload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({
        message: tooLarge
          ? `CSV is larger than the ${MAX_CSV_MB}MB upload limit — split it into smaller files`
          : `Upload failed: ${err.message}`,
        code: err.code,
      });
      return;
    }
    next(err);
  });
};

// Phase 2.5 — every patient endpoint now requires a valid JWT. The create
// endpoint was previously open which allowed any caller to write to
// PatientDetails; closing it before staging.
router.post('/', authenticateToken, (req, res) => patientController.createPatient(req, res));
router.post('/get-details-by-prn', authenticateToken, (req, res) => patientController.getDetailsByPRN(req, res));
// Bulk CSV import (multipart/form-data, field name 'file'). Existing PRNs are
// skipped; only new patients are inserted.
router.post('/import-csv', authenticateToken, uploadCsv, importPatientsCsv);
// Phase 9.23 — unified patient timeline. MUST be before /:prn and /:id.
router.get('/timeline/:prn', authenticateToken, getPatientTimeline);
// Phase 1 — duplicate-check by phone, must come before /:id catch-all.
router.get('/by-phone/:phone', authenticateToken, (req, res) => patientController.getPatientByPhone(req, res));
router.put('/:prn', authenticateToken, (req, res) => patientController.updatePatientByPRN(req, res));
router.get('/:id', authenticateToken, (req, res) => patientController.getPatient(req, res));
router.put('/:id', authenticateToken, (req, res) => patientController.updatePatient(req, res));
router.delete('/:id', authenticateToken, (req, res) => patientController.deletePatient(req, res));
router.get('/', authenticateToken, (req, res) => patientController.getPatients(req, res));

export default router;
