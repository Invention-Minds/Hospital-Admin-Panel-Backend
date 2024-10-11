import { Router } from 'express';
import { createDepartment, getDepartments } from './department.controller';

const router = Router();

router.post('/', createDepartment);  // Changed from '/departments' to '/'
router.get('/', getDepartments);      // Changed from '/departments' to '/'

export default router;
