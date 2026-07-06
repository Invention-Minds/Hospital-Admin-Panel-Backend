import { Request, Response } from 'express';
import { getTodayIds, markArrived, unmarkArrived, todayKey } from './attendance.store';
import { notifyDoctorAttendance } from '../appointments/appointment.controller';
import { updateDoctorAssignments } from '../whatsapp/whatsapp.controller';

// GET /api/attendance/today -> doctors marked "came" for the current IST day.
export const getTodayAttendance = (req: Request, res: Response): void => {
  res.status(200).json({ date: todayKey(), doctorIds: getTodayIds() });
};

// POST /api/attendance/mark { doctorId }
export const markDoctorArrived = async (req: Request, res: Response): Promise<void> => {
  const doctorId = Number(req.body?.doctorId);
  if (!doctorId || Number.isNaN(doctorId)) {
    res.status(400).json({ error: 'doctorId is required' });
    return;
  }

  const doctorIds = markArrived(doctorId);

  // Respond immediately — the arrival is already saved. Rebuild the channel
  // assignments and nudge the TVs in the background so the admin UI isn't
  // blocked on that (potentially multi-second) work.
  res.status(200).json({ date: todayKey(), doctorIds });

  updateDoctorAssignments()
    .then(() => notifyDoctorAttendance({ doctorId, present: true, date: todayKey() }))
    .catch((error) => console.error('Error rebuilding assignments after mark:', error));
};

// POST /api/attendance/unmark { doctorId }
export const unmarkDoctorArrived = async (req: Request, res: Response): Promise<void> => {
  const doctorId = Number(req.body?.doctorId);
  if (!doctorId || Number.isNaN(doctorId)) {
    res.status(400).json({ error: 'doctorId is required' });
    return;
  }

  const doctorIds = unmarkArrived(doctorId);

  // Respond immediately; rebuild assignments + notify TVs in the background.
  res.status(200).json({ date: todayKey(), doctorIds });

  updateDoctorAssignments()
    .then(() => notifyDoctorAttendance({ doctorId, present: false, date: todayKey() }))
    .catch((error) => console.error('Error rebuilding assignments after unmark:', error));
};
