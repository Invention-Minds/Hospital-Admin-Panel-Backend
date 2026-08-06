import { Router } from 'express';
import { viewSecureLink } from './patient-portal.controller';

const router = Router();

// Public — the expiring token is the credential. Mounted at /p.
router.get('/:token', viewSecureLink);

export default router;
