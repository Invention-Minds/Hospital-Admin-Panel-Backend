import { Request, Response } from 'express';
import { getArrivedIds, getArrivals, markArrived, unmarkArrived, todayKey } from './attendance.store';
import { notifyDoctorAttendance } from '../appointments/appointment.controller';
import { updateDoctorAssignments } from '../whatsapp/whatsapp.controller';

// GET /api/attendance/today?date=YYYY-MM-DD -> doctors marked "came" that day.
// `doctorIds` is kept for the existing callers; `arrivals` carries the times.
export const getTodayAttendance = async (req: Request, res: Response): Promise<void> => {
  const date = (req.query?.date as string) || todayKey();
  const arrivals = await getArrivals(date);
  res.status(200).json({
    date,
    doctorIds: arrivals.map((a) => a.doctorId),
    arrivals,
  });
};

// POST /api/attendance/mark { doctorId }
export const markDoctorArrived = async (req: Request, res: Response): Promise<void> => {
  const doctorId = Number(req.body?.doctorId);
  if (!doctorId || Number.isNaN(doctorId)) {
    res.status(400).json({ error: 'doctorId is required' });
    return;
  }

  const markedBy = (req as any)?.user?.username ?? (req.body?.markedBy as string) ?? undefined;
  const doctorIds = await markArrived(doctorId, markedBy);

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

  const doctorIds = await unmarkArrived(doctorId);

  // Respond immediately; rebuild assignments + notify TVs in the background.
  res.status(200).json({ date: todayKey(), doctorIds });

  updateDoctorAssignments()
    .then(() => notifyDoctorAttendance({ doctorId, present: false, date: todayKey() }))
    .catch((error) => console.error('Error rebuilding assignments after unmark:', error));
};
