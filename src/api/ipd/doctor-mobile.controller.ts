import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { admittedByDoctor } from '../../service/doctor-name-match';

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
