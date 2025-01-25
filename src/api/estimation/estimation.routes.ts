import { Router } from 'express';
import { createEstimation, getEstimationsByDepartment, createEstimationDetails, getAllEstimationDetails} from './estimation.controller';
import {authenticateToken} from '../../middleware/middleware'

const router = Router();

router.post('/',authenticateToken, createEstimation);  // Changed from '/departments' to '/'
router.get('/department/:departmentId/:estimationType', authenticateToken, getEstimationsByDepartment);
router.post('/estimation-details', authenticateToken, createEstimationDetails);
router.get('/',authenticateToken, getAllEstimationDetails)


export default router;