import { Request, Response } from 'express';
import {
  BookingError,
  availableDates,
  createAppointmentRequest,
  createEnquiry,
  createEscalationAlert,
  findPatientsByPhone,
  getFreeSlots,
  last10,
  listDepartments,
  listDoctors,
} from './ai-receptionist.service';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SLOT = /^(0[1-9]|1[0-2]):[0-5]\d (AM|PM)$/;
const ENQUIRY_CATEGORIES = ['General', 'Billing', 'Reports', 'Health Package', 'Insurance', 'Surgery Estimate', 'Admission', 'Feedback', 'Callback', 'Other'];

const toId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const getDepartments = async (_req: Request, res: Response) => {
  try {
    res.json(await listDepartments());
  } catch (error) {
    console.error('[ai-receptionist] departments error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const departmentId = req.query.departmentId ? toId(req.query.departmentId) : undefined;
    if (departmentId === null) {
      res.status(400).json({ message: 'Invalid departmentId' });
      return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : undefined;
    res.json(await listDoctors({ departmentId, q: q || undefined }));
  } catch (error) {
    console.error('[ai-receptionist] doctors error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getDoctorDates = async (req: Request, res: Response) => {
  try {
    const doctorId = toId(req.params.id);
    if (!doctorId) {
      res.status(400).json({ message: 'Invalid doctor id' });
      return;
    }
    res.json({ doctorId, dates: await availableDates(doctorId, 7) });
  } catch (error) {
    console.error('[ai-receptionist] dates error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getDoctorSlots = async (req: Request, res: Response) => {
  try {
    const doctorId = toId(req.params.id);
    const date = String(req.query.date ?? '');
    if (!doctorId || !YMD.test(date)) {
      res.status(400).json({ message: 'doctor id and date (YYYY-MM-DD) are required' });
      return;
    }
    res.json({ doctorId, date, slots: await getFreeSlots(doctorId, date) });
  } catch (error) {
    console.error('[ai-receptionist] slots error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPatientsByPhone = async (req: Request, res: Response) => {
  try {
    if (last10(req.params.phone).length !== 10) {
      res.status(400).json({ message: 'Invalid phone number' });
      return;
    }
    res.json(await findPatientsByPhone(req.params.phone));
  } catch (error) {
    console.error('[ai-receptionist] patient lookup error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const requestAppointment = async (req: Request, res: Response) => {
  try {
    const { patientName, phone, doctorId, date, time, age, gender, prn, type, reason, channel, sessionId } = req.body ?? {};
    const docId = toId(doctorId);
    if (!patientName || typeof patientName !== 'string' || !docId || !YMD.test(String(date)) || !SLOT.test(String(time))) {
      res.status(400).json({ message: 'patientName, phone, doctorId, date (YYYY-MM-DD) and time (hh:mm AM/PM) are required' });
      return;
    }
    if (last10(String(phone ?? '')).length !== 10) {
      res.status(400).json({ message: 'Invalid phone number' });
      return;
    }
    const appt = await createAppointmentRequest({
      patientName: patientName.trim().slice(0, 100),
      phone: String(phone),
      doctorId: docId,
      date: String(date),
      time: String(time),
      age,
      gender: typeof gender === 'string' ? gender : undefined,
      prn: toId(prn) ?? undefined,
      type: type === 'followup' ? 'followup' : 'new',
      reason: typeof reason === 'string' ? reason.slice(0, 500) : undefined,
      channel: typeof channel === 'string' ? channel : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    });
    res.status(201).json({
      appointmentId: appt.id,
      status: appt.status,
      doctorName: appt.doctorName,
      department: appt.department,
      date: appt.date,
      time: appt.time,
    });
  } catch (error) {
    if (error instanceof BookingError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('[ai-receptionist] appointment error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const postEnquiry = async (req: Request, res: Response) => {
  try {
    const { name, phone, category, summary, priority, sessionId, language } = req.body ?? {};
    if (!name || !summary || last10(String(phone ?? '')).length !== 10) {
      res.status(400).json({ message: 'name, phone and summary are required' });
      return;
    }
    const cb = await createEnquiry({
      name: String(name).slice(0, 100),
      phone: String(phone),
      category: ENQUIRY_CATEGORIES.includes(category) ? category : 'Other',
      summary: String(summary).slice(0, 1000),
      priority: priority === 'urgent' ? 'urgent' : 'normal',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      language: typeof language === 'string' ? language : undefined,
    });
    res.status(201).json({ enquiryId: cb.id, status: cb.status });
  } catch (error) {
    console.error('[ai-receptionist] enquiry error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const postEscalation = async (req: Request, res: Response) => {
  try {
    const { phone, name, reason, emergency, summary, sessionId } = req.body ?? {};
    if (!reason || last10(String(phone ?? '')).length !== 10) {
      res.status(400).json({ message: 'phone and reason are required' });
      return;
    }
    const n = await createEscalationAlert({
      phone: String(phone),
      name: typeof name === 'string' ? name : undefined,
      reason: String(reason),
      emergency: emergency === true,
      summary: typeof summary === 'string' ? summary : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    });
    res.status(201).json({ notificationId: n.id });
  } catch (error) {
    console.error('[ai-receptionist] escalation error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
