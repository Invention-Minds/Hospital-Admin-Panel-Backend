import { Router } from 'express';
import { createInvestigationOrder, getLabTests, getRadiologyTests } from './investigation.controller';

const router = Router();

router.post('/investigation-orders', createInvestigationOrder);
router.get('/lab-tests', getLabTests);
router.get('/radiology-tests', getRadiologyTests);

export default router;
