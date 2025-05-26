import { Router } from 'express';
import { createInvestigationOrder, createLabTest, createRadiologyTest, getLabTests, getRadiologyTests } from './investigation.controller';

const router = Router();

router.post('/investigation-orders', createInvestigationOrder);
router.get('/lab-tests', getLabTests);
router.get('/radiology-tests', getRadiologyTests);
router.post('/lab-tests', createLabTest);
router.post('/radiology-tests', createRadiologyTest);

export default router;
