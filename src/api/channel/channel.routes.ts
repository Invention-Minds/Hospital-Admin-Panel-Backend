import { Router } from 'express';
import {
  getChannels,
  createChannel,
  assignDoctorToChannel,
  removeDoctorFromChannel,
  getDoctorsByChannel,
  getChannelsByDoctor,
} from './channel.controller';

const router = Router();

router.get('/', getChannels); // Get all channels
router.post('/', createChannel); // Create a new channel
router.post('/assign', assignDoctorToChannel); // Assign a doctor to a channel
router.post('/remove', removeDoctorFromChannel); // Remove a doctor from a channel
router.get('/:channelId/doctors', getDoctorsByChannel);
router.get('/:doctorId/channels', getChannelsByDoctor)

export default router;
