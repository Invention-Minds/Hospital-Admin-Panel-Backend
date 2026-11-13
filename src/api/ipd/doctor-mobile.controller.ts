import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import prisma from '../../service/prisma-client';
import { admittedByDoctor } from '../../service/doctor-name-match';
import { getClinicalActor } from '../../middleware/audit-guard';
import { auditLog } from '../../service/app-audit';

const TZ = 'Asia/Kolkata';
/** AppAuditLog marker for "seen on today's round" — no schema change needed. */
const SEEN_MODULE = 'ipd-round';
const SEEN_ACTION = 'ROUND_SEEN';

const startOfTodayIst = () => moment().tz(TZ).startOf('day').toDate();

/**
 * Seen today = this user tapped "Mark seen" or wrote a progress note today (IST).
 * Returns admissionId → latest of the two.
 */
async function seenTodayFor(admissionIds: string[], userId: number | undefined): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!admissionIds.length || !userId) return out;
  const since = startOfTodayIst();
  const [marks, notes] = await Promise.all([
    prisma.appAuditLog.findMany({
      where: { module: SEEN_MODULE, action: SEEN_ACTION, actorId: userId, entityId: { in: admissionIds }, createdAt: { gte: since } },
      select: { entityId: true, createdAt: true },
    }),
    prisma.ipdProgressNote.findMany({
      where: { admissionId: { in: admissionIds }, createdById: userId, date: { gte: since } },
      select: { admissionId: true, date: true },
    }),
  ]);
  const put = (id: string | null, at: Date) => {
    if (!id) return;
    const prev = out.get(id);
    if (!prev || at > prev) out.set(id, at);
  };
  marks.forEach((m) => put(m.entityId, m.createdAt));
  notes.forEach((n) => put(n.admissionId, n.date));
  return out;
}

async function currentDoctor(req: Request) {
  const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
  return userId ? prisma.doctor.findFirst({ where: { userId }, select: { id: true, name: true } }) : null;
}

/** The admission, if it is this doctor's (admins: any). Sends the error itself. */
async function loadOwnAdmission(req: Request, res: Response) {
  const admissionId = String(req.params.admissionId ?? '');
  const doctor = await currentDoctor(req);
  const adm = await prisma.ipdAdmission.findFirst({
    where: { id: admissionId, ...(doctor ? admittedByDoctor(doctor) : {}) },
    select: { id: true, prn: true, admissionDate: true, status: true },
  });
  if (!adm) {
    const exists = await prisma.ipdAdmission.count({ where: { id: admissionId } });
    res.status(exists ? 403 : 404).json({ error: exists ? 'This patient is not admitted under you' : 'Admission not found' });
    return null;
  }
  return { doctor, adm };
}

/** GET /api/ipd/my-patients/:admissionId/round — what the doctor needs at the bedside. */
export const getRoundDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const own = await loadOwnAdmission(req, res);
    if (!own) return;
    const { adm } = own;
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const since48h = new Date(Date.now() - 2 * DAY_MS);

    const [vitals, meds, orders, notes, allergies, seen] = await Promise.all([
      prisma.ipdVitalsReading.findMany({
        where: { admissionId: adm.id, recordedAt: { gte: since48h } },
        orderBy: { recordedAt: 'asc' },
        take: 48,
        select: { recordedAt: true, temperatureC: true, temperatureF: true, pulse: true, respiration: true, bpSystolic: true, bpDiastolic: true, spo2: true, painScore: true },
      }),
      prisma.ipdPrescription.findMany({
        where: { admissionId: adm.id, status: 'active' },
        orderBy: { prescribedDate: 'desc' },
        take: 40,
        select: { id: true, genericName: true, brandName: true, dose: true, frequency: true, route: true, duration: true, prescriptionType: true, adminStatus: true, nextAdminTime: true },
      }),
      prisma.ipdNonDrugOrder.findMany({
        where: { admissionId: adm.id, status: { in: ['ORDERED', 'ACKNOWLEDGED'] } },
        orderBy: { orderedAt: 'desc' },
        take: 30,
        select: { id: true, orderText: true, category: true, status: true, orderedAt: true, doctorName: true },
      }),
      prisma.ipdProgressNote.findMany({
        where: { admissionId: adm.id },
        orderBy: { date: 'desc' },
        take: 3,
        select: { id: true, date: true, doctorName: true, subjective: true, objective: true, assessment: true, plan: true },
      }),
      prisma.allergy.findMany({ where: { prn: adm.prn }, select: { genericName: true } }),
      seenTodayFor([adm.id], userId),
    ]);

    // Latest reading may be older than 48h — fetch it separately if the window is empty.
    const latest = vitals[vitals.length - 1]
      ?? (await prisma.ipdVitalsReading.findFirst({
        where: { admissionId: adm.id },
        orderBy: { recordedAt: 'desc' },
        select: { recordedAt: true, temperatureC: true, temperatureF: true, pulse: true, respiration: true, bpSystolic: true, bpDiastolic: true, spo2: true, painScore: true },
      }));

    res.status(200).json({
      data: {
        admissionId: adm.id,
        seenTodayAt: seen.get(adm.id) ?? null,
        allergies: allergies.map((a) => a.genericName),
        latestVitals: latest ?? null,
        vitals,
        medications: meds,
        orders,
        notes,
      },
    });
  } catch (error) {
    console.error('[ipd:my-patients:round] failed:', error);
    res.status(500).json({ error: 'Failed to load the patient' });
  }
};

/** POST /api/ipd/my-patients/:admissionId/seen — tick the patient off today's round. */
export const markSeenOnRound = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAdmission(req, res);
    if (!own) return;
    const existing = (await seenTodayFor([own.adm.id], actorId)).get(own.adm.id);
    if (!existing) {
      await auditLog(req, { module: SEEN_MODULE, action: SEEN_ACTION, entityType: 'IpdAdmission', entityId: own.adm.id, payload: { via: 'mobile' } });
    }
    const seenAt = existing ?? (await seenTodayFor([own.adm.id], actorId)).get(own.adm.id) ?? new Date();
    res.status(200).json({ data: { admissionId: own.adm.id, seenTodayAt: seenAt } });
  } catch (error) {
    console.error('[ipd:my-patients:seen] failed:', error);
    res.status(500).json({ error: 'Failed to mark the patient seen' });
  }
};

/**
 * POST /api/ipd/my-patients/:admissionId/progress-note — SOAP note from the round.
 * Same row as the web's progress-note endpoint, but sections may be left blank
 * (an assessment or a plan is still required) and the doctor's name comes from
 * their Doctor record. Writing a note also counts as "seen today".
 */
export const addRoundProgressNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;
    const own = await loadOwnAdmission(req, res);
    if (!own) return;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const b = req.body ?? {};
    const note = { subjective: str(b.subjective), objective: str(b.objective), assessment: str(b.assessment), plan: str(b.plan) };
    if (!note.assessment && !note.plan) {
      res.status(400).json({ error: 'Add an assessment or a plan before saving the note.' });
      return;
    }
    const row = await prisma.ipdProgressNote.create({
      data: {
        admissionId: own.adm.id,
        date: new Date(),
        doctorName: own.doctor?.name ?? req.user?.username ?? 'Doctor',
        ...note,
        createdBy: req.user?.username ?? null,
        createdById: actorId,
      },
      select: { id: true, date: true, doctorName: true, subjective: true, objective: true, assessment: true, plan: true },
    });
    await auditLog(req, { module: 'ipd', action: 'CREATE', entityType: 'IpdProgressNote', entityId: row.id, payload: { admissionId: own.adm.id, via: 'mobile' } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ipd:my-patients:progress-note] failed:', error);
    res.status(500).json({ error: 'Failed to save the progress note' });
  }
};

// Doctor mobile app — "my patients" for the IPD round and the discharge review
// queue. Scoped to the logged-in doctor: the user is resolved to their Doctor
// row and matched on IpdAdmission.admittingDoctorId (name snapshot only for
// legacy rows without an id). Users without a Doctor row (admins) see every
// active admission.

const ACTIVE_STATUSES = ['admitted', 'transferred'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** GET /api/ipd/my-patients */
export const getMyPatients = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const doctor = userId
      ? await prisma.doctor.findFirst({ where: { userId }, select: { id: true, name: true } })
      : null;

    const admissions = await prisma.ipdAdmission.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        ...(doctor ? admittedByDoctor(doctor) : {}),
      },
      select: {
        id: true,
        admissionNo: true,
        prn: true,
        admissionDate: true,
        department: true,
        diagnosis: true,
        status: true,
        icuAdmittedAt: true,
        icuDischargedAt: true,
        dischargeReadyAt: true,
        dischargeChainAbandoned: true,
        ward: { select: { id: true, wardName: true } },
        bed: { select: { bedNumber: true } },
        discharge: { select: { summaryStatus: true, aiDraftedAt: true, clinicianSignedAt: true } },
        progressNotes: { select: { date: true }, orderBy: { date: 'desc' }, take: 1 },
      },
      orderBy: [{ wardId: 'asc' }, { admissionDate: 'asc' }],
      take: 200,
    });

    // Patient demographics (PatientDetails.prn is Int; IpdAdmission.prn is String).
    const prnInts = admissions.map((a) => Number(a.prn)).filter(Number.isFinite);
    const patients = prnInts.length
      ? await prisma.patientDetails.findMany({
          where: { prn: { in: prnInts } },
          select: { prn: true, name: true, age: true, gender: true },
        })
      : [];
    const patientByPrn = new Map(patients.map((p) => [String(p.prn), p]));

    // Unacknowledged-or-not, critical results during each stay — drives the red chip on the round list.
    const earliest = admissions.reduce<Date | null>(
      (min, a) => (!min || a.admissionDate < min ? a.admissionDate : min),
      null,
    );
    const criticals = earliest
      ? await prisma.investigationResult.findMany({
          where: {
            prn: { in: admissions.map((a) => a.prn) },
            criticalFlag: true,
            isDeleted: false,
            createdAt: { gte: new Date(earliest.getTime() - DAY_MS) },
          },
          select: { prn: true, testName: true, result: true, unit: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const seen = await seenTodayFor(admissions.map((a) => a.id), userId);

    const now = Date.now();
    const data = admissions.map((a) => {
      const p = patientByPrn.get(a.prn);
      const stayCriticals = criticals.filter(
        (c) => c.prn === a.prn && c.createdAt.getTime() >= a.admissionDate.getTime() - DAY_MS,
      );
      return {
        id: a.id,
        admissionNo: a.admissionNo,
        prn: a.prn,
        patient: p ? { name: p.name, age: p.age, gender: p.gender } : null,
        department: a.department,
        diagnosis: a.diagnosis.length > 160 ? `${a.diagnosis.slice(0, 160)}…` : a.diagnosis,
        ward: a.ward,
        bedNumber: a.bed?.bedNumber ?? null,
        admissionDate: a.admissionDate,
        dayOfStay: Math.max(1, Math.floor((now - a.admissionDate.getTime()) / DAY_MS) + 1),
        inIcu: !!a.icuAdmittedAt && !a.icuDischargedAt,
        lastProgressNoteAt: a.progressNotes[0]?.date ?? null,
        seenTodayAt: seen.get(a.id) ?? null,
        latestCritical: stayCriticals[0]
          ? { testName: stayCriticals[0].testName, result: stayCriticals[0].result, unit: stayCriticals[0].unit }
          : null,
        discharge: {
          readyAt: a.dischargeReadyAt,
          abandoned: a.dischargeChainAbandoned,
          summaryStatus: a.discharge?.summaryStatus ?? 'NONE',
          aiDraftedAt: a.discharge?.aiDraftedAt ?? null,
          signedAt: a.discharge?.clinicianSignedAt ?? null,
        },
      };
    });

    res.status(200).json({ data, doctor: doctor ? { id: doctor.id, name: doctor.name } : null });
  } catch (error) {
    console.error('[ipd:my-patients] failed:', error);
    res.status(500).json({ error: 'Failed to load your patients' });
  }
};
