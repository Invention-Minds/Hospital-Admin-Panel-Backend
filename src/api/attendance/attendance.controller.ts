import { Request, Response } from 'express';
import moment from 'moment-timezone';
import { getArrival, getArrivals, markArrived, unmarkArrived, todayKey } from './attendance.store';
import { notifyDoctorAttendance } from '../appointments/appointment.controller';
import { updateDoctorAssignments } from '../whatsapp/whatsapp.controller';
import { recordDoctorChange, doctorName, labelsForUsernames } from '../doctor/doctor-change-log';

const istTime = (d: Date) => moment(d).tz('Asia/Kolkata').format('h:mm A');

// GET /api/attendance/today?date=YYYY-MM-DD -> doctors marked "came" that day.
// `doctorIds` is kept for the existing callers; `arrivals` carries the times
// and who marked each one (markedByLabel = "Name (Job title)").
export const getTodayAttendance = async (req: Request, res: Response): Promise<void> => {
  const date = (req.query?.date as string) || todayKey();
  const arrivals = await getArrivals(date);
  const labels = await labelsForUsernames(arrivals.map((a) => a.markedBy));
  res.status(200).json({
    date,
    doctorIds: arrivals.map((a) => a.doctorId),
    arrivals: arrivals.map((a) => ({
      ...a,
      markedByLabel: a.markedBy ? labels.get(a.markedBy) ?? a.markedBy : null,
    })),
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
  const alreadyArrived = await getArrival(doctorId);
  const doctorIds = await markArrived(doctorId, markedBy);

  // Respond immediately — the arrival is already saved. Rebuild the channel
  // assignments and nudge the TVs in the background so the admin UI isn't
  // blocked on that (potentially multi-second) work.
  res.status(200).json({ date: todayKey(), doctorIds });

  updateDoctorAssignments()
    .then(() => notifyDoctorAttendance({ doctorId, present: true, date: todayKey() }))
    .catch((error) => console.error('Error rebuilding assignments after mark:', error));

  // Doctor Updates log (no bell alert). Re-marking an existing arrival keeps
  // the original row, so only a new arrival is logged.
  if (!alreadyArrived) {
    const arrival = await getArrival(doctorId);
    if (arrival) {
      await recordDoctorChange(req, {
        action: 'ARRIVED',
        doctorId,
        doctorName: await doctorName(doctorId),
        summary: `Arrived ${istTime(arrival.arrivedAt)}`,
        details: { date: todayKey(), arrivedAt: arrival.arrivedAt },
        alert: false,
      });
    }
  }
};

// POST /api/attendance/unmark { doctorId }
export const unmarkDoctorArrived = async (req: Request, res: Response): Promise<void> => {
  const doctorId = Number(req.body?.doctorId);
  if (!doctorId || Number.isNaN(doctorId)) {
    res.status(400).json({ error: 'doctorId is required' });
    return;
  }

  // Read before deleting — unmarking removes the row, so this is the only
  // place left to record what was undone and who had marked it.
  const before = await getArrival(doctorId);
  const doctorIds = await unmarkArrived(doctorId);

  // Respond immediately; rebuild assignments + notify TVs in the background.
  res.status(200).json({ date: todayKey(), doctorIds });

  updateDoctorAssignments()
    .then(() => notifyDoctorAttendance({ doctorId, present: false, date: todayKey() }))
    .catch((error) => console.error('Error rebuilding assignments after unmark:', error));

  if (before) {
    const markedByLabel = before.markedBy
      ? (await labelsForUsernames([before.markedBy])).get(before.markedBy) ?? before.markedBy
      : null;
    await recordDoctorChange(req, {
      action: 'ARRIVAL_UNDONE',
      doctorId,
      doctorName: await doctorName(doctorId),
      summary: `Arrival undone (was marked ${istTime(before.arrivedAt)}${markedByLabel ? ` by ${markedByLabel}` : ''})`,
      details: { date: todayKey(), arrivedAt: before.arrivedAt, markedBy: markedByLabel },
      alert: false,
    });
  }
};
