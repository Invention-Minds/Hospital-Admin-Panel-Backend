import { Router } from 'express';
import { createEstimation, getEstimationsByDepartment, createEstimationDetails, getAllEstimationDetails, updateEstimationDetails, updateFollowUps, updateAdvanceDetails, markComplete, updateFeedback, updatePACDone, generateEstimationPDF, lockService, unlockService, createNewEstimationDetails, getEstimationsByType, estConfirm, updateSurgeryDate} from './estimation.controller';
import {authenticateToken} from '../../middleware/middleware'

const router = Router();

router.post('/',authenticateToken, createEstimation);  // Changed from '/departments' to '/'
router.get('/department/:departmentId/:estimationType', authenticateToken, getEstimationsByDepartment);
router.post('/estimation-details', authenticateToken, createEstimationDetails);
router.get('/',authenticateToken, getAllEstimationDetails);
router.put('/estimation-details/:estimationId', authenticateToken, updateEstimationDetails);
router.post('/estimations/:estimationId/follow-ups', authenticateToken,updateFollowUps);
router.put("/estimation-details/:estimationId/advance", authenticateToken,updateAdvanceDetails);
router.put("/estimation-details/:estimationId/mark-complete", authenticateToken,markComplete);
router.put("/estimation-details/:estimationId/cancel", authenticateToken, updateFeedback)
router.put("/estimation-details/:estimationId/pacDone", authenticateToken, updatePACDone);
router.put("/estimation-details/:estimationId/confirm", authenticateToken, estConfirm);
router.put('/estimation-details/:estimationId/updateDate', updateSurgeryDate);
router.post('/new-estimation-details', authenticateToken, createNewEstimationDetails);
router.post('/generate-pdf', generateEstimationPDF)
router.get('/department/:estimationType', authenticateToken, getEstimationsByType);


// Route to lock an appointment
router.put('/:id/lock', authenticateToken, lockService);

// Route to unlock an appointment
router.put('/:id/unlock', authenticateToken, unlockService);
export default router;