import { Router } from 'express';
import { createDepartment, getDepartments } from './department.controller';
import {authenticateToken} from '../../middleware/middleware'

const router = Router();

router.post('/',authenticateToken, createDepartment);  // Changed from '/departments' to '/'
router.get('/', getDepartments);      // Changed from '/departments' to '/'

export default router;
