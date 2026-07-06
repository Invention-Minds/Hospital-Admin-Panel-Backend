import { Router } from 'express';
import {
  getChannels,
  createChannel,
  assignDoctorToChannel,
  removeDoctorFromChannel,
  getDoctorsByChannel,
  getChannelsByDoctor,
} from './channel.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = Router();

router.get('/', authenticateToken, getChannels); // Get all channels
router.post('/', authenticateToken, createChannel); // Create a new channel
router.post('/assign', authenticateToken, assignDoctorToChannel); // Assign a doctor to a channel
router.post('/remove', authenticateToken, removeDoctorFromChannel); // Remove a doctor from a channel
router.get('/:channelId/doctors', authenticateToken, getDoctorsByChannel);
router.get('/:doctorId/channels', authenticateToken, getChannelsByDoctor)

export default router;
