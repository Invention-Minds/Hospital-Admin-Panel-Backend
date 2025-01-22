import { Router } from 'express';
import { createEstimation} from './estimation.controller';
import {authenticateToken} from '../../middleware/middleware'

const router = Router();

router.post('/',authenticateToken, createEstimation);  // Changed from '/departments' to '/'

export default router;