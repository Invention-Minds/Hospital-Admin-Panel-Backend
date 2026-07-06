import { Router } from 'express';
import ScreenshotController from './screenshot.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

// Route for capturing dashboard screenshot
router.get('/capture-dashboard', authenticateToken, ScreenshotController.captureDashboard);

export default router;
