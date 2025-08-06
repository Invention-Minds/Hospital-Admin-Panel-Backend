import { Router } from 'express';
import ScreenshotController from './screenshot.controller';

const router = Router();

// Route for capturing dashboard screenshot
router.get('/capture-dashboard', ScreenshotController.captureDashboard);

export default router;
