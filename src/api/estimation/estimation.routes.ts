import { Router } from 'express';
import { createEstimation, getEstimationsByDepartment, createEstimationDetails, getAllEstimationDetails, updateEstimationDetails, updateFollowUps, updateAdvanceDetails, markComplete, updateFeedback, updatePACDone, generateEstimationPDF, lockService, unlockService, createNewEstimationDetails, getEstimationsByType, estConfirm, updateSurgeryDate, getFollowUpEstimations, getTodayConfirmedEstimations, getopdEstimation, getStatusEstimation, listLockedEstimations, bulkUnlockServices, confirmedEstimations, updateOTDetails, updateOTStartFinish, createOTDetails, referEstimationForAdmission, getEstimationLinks} from './estimation.controller';
import { listSurgeryLines, addSurgeryLine, updateSurgeryLine, removeSurgeryLine } from './estimation-surgery-line.controller';
import {authenticateToken} from '../../middleware/middleware'

const router = Router();

router.post('/',authenticateToken, createEstimation);  // Changed from '/departments' to '/'
router.get('/department/:departmentId/:estimationType', authenticateToken, getEstimationsByDepartment);
router.post('/estimation-details', authenticateToken, createEstimationDetails);
router.get('/get-confirmed',authenticateToken,getTodayConfirmedEstimations);
router.get('/confirmed-estimations',authenticateToken, confirmedEstimations);
router.post('/ot-details', createOTDetails);
router.put("/ot-details/update", updateOTDetails);
router.put("/ot-details/start-finish", updateOTStartFinish);
router.get('/opd-estimation',authenticateToken, getopdEstimation);
router.get('/status-estimation',authenticateToken, getStatusEstimation)
router.get('/',authenticateToken, getAllEstimationDetails);
router.get('/estimation-details/followups', authenticateToken, getFollowUpEstimations);
router.put('/estimation-details/:estimationId', authenticateToken, updateEstimationDetails);
router.post('/estimations/:estimationId/follow-ups', authenticateToken,updateFollowUps);
router.put("/estimation-details/:estimationId/advance", authenticateToken,updateAdvanceDetails);
router.put("/estimation-details/:estimationId/mark-complete", authenticateToken,markComplete);
router.put("/estimation-details/:estimationId/cancel", authenticateToken, updateFeedback)
router.put("/estimation-details/:estimationId/pacDone", authenticateToken, updatePACDone);
router.put("/estimation-details/:estimationId/confirm", authenticateToken, estConfirm);
// Estimation → IPD admission (refer, NABH WF-2) + linkage status for the UI.
router.post("/estimation-details/:estimationId/refer-for-admission", authenticateToken, referEstimationForAdmission);
router.get("/estimation-details/:estimationId/links", authenticateToken, getEstimationLinks);
router.put('/estimation-details/:estimationId/updateDate', updateSurgeryDate);
router.post('/new-estimation-details', authenticateToken, createNewEstimationDetails);
router.post('/generate-pdf',authenticateToken, generateEstimationPDF)
router.get('/department/:estimationType', authenticateToken, getEstimationsByType);
router.put('/unlock-bulk', authenticateToken, bulkUnlockServices);


// Route to lock an appointment
router.put('/:id/lock', authenticateToken, lockService);
router.get('/locked', authenticateToken, listLockedEstimations);


// Route to unlock an appointment
router.put('/:id/unlock', authenticateToken, unlockService);

// Phase 9.4c — per-role surgery billing lines (Order Surgeries)
router.get('/:estimationId/surgery-lines', authenticateToken, listSurgeryLines);
router.post('/:estimationId/surgery-lines', authenticateToken, addSurgeryLine);
router.put('/:estimationId/surgery-lines/:id', authenticateToken, updateSurgeryLine);
router.delete('/:estimationId/surgery-lines/:id', authenticateToken, removeSurgeryLine);

export default router;