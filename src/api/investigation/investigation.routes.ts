import { Router } from 'express';
import { createInvestigationOrder, createLabTest, createRadiologyTest, getInvestigationOrdersByPrn, getLabTests, getRadiologyTests, updateLabTest, updateRadiologyTest } from './investigation.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.post('/investigation-orders', authenticateToken, createInvestigationOrder);
router.get('/investigation-orders', authenticateToken, getInvestigationOrdersByPrn);
router.get('/lab-tests', authenticateToken, getLabTests);
router.get('/radiology-tests', authenticateToken, getRadiologyTests);
router.post('/lab-tests', authenticateToken, createLabTest);
router.put('/lab-tests/:id', authenticateToken, updateLabTest);
router.post('/radiology-tests', authenticateToken, createRadiologyTest);
router.put('/radiology-tests/:id', authenticateToken, updateRadiologyTest);

export default router;
