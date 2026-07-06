import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.5c — OT Archives (patient profile view inside OT workbench).
//
// Aggregates the patient-centric history surfaces the reference HMIS shows
// in its Archives modal:
//   * Patient demographics
//   * OP / IP visits
//   * Recent lab + radiology results (within a date window)
//   * Surgical history (all OtSchedule rows ever)
//   * Discharge summaries
//
// Single endpoint keyed by PRN. The frontend Archives panel calls this once
// when the patient is opened.

interface ArchivesQuery {
  fromDate?: string;
  toDate?: string;
  reportLimit?: string;
}

export const getOtArchives = async (req: Request, res: Response): Promise<void> => {
  try {
    const prn = req.params.prn;
    if (!prn) { res.status(400).json({ message: 'prn is required' }); return; }
    const q = req.query as ArchivesQuery;

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 180); // 6 months by default
    const fromDate = q.fromDate ? new Date(q.fromDate) : defaultFrom;
    const toDate = q.toDate ? new Date(q.toDate) : now;
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);
    const limit = Number(q.reportLimit ?? 10);

    const prnInt = Number(prn);
    const patient = !Number.isNaN(prnInt)
      ? await prisma.patientDetails.findUnique({
          where: { prn: prnInt },
          select: {
            prn: true,
            name: true,
            age: true,
            gender: true,
            contactNo: true,
            mobileNo: true,
            email: true,
            address: true,
            patientType: true,
            bloodGroup: true,
          },
        })
      : null;

    // OP visits — Appointments. Appointment.date is a string, so sort by id desc as proxy for recency.
    const opVisits = !Number.isNaN(prnInt)
      ? await prisma.appointment.findMany({
          where: { prnNumber: prnInt },
          orderBy: { id: 'desc' },
          take: 30,
          select: {
            id: true,
            date: true,
            time: true,
            doctorName: true,
            department: true,
            status: true,
            type: true,
          },
        })
      : [];

    // IP visits — Admissions
    const ipVisits = await prisma.ipdAdmission.findMany({
      where: { prn: String(prn) },
      orderBy: { admissionDate: 'desc' },
      take: 30,
      select: {
        id: true,
        admissionNo: true,
        admissionDate: true,
        admissionTime: true,
        admissionType: true,
        admittingDoctor: true,
        department: true,
        roomType: true,
        status: true,
        diagnosis: true,
      },
    });

    // Lab + radiology results (combined InvestigationResult table)
    const reports = await prisma.investigationResult.findMany({
      where: {
        prn: String(prn),
        createdAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,
      select: {
        id: true,
        orderId: true,
        testName: true,
        department: true,
        result: true,
        unit: true,
        referenceRange: true,
        criticalFlag: true,
        reportUrl: true,
        reportedAt: true,
        status: true,
        createdAt: true,
      },
    });

    const labReports = reports.filter((r) => r.department?.toLowerCase() === 'lab').slice(0, limit);
    const radiologyReports = reports
      .filter((r) => r.department?.toLowerCase() === 'radiology')
      .slice(0, limit);

    // Surgical history — every OT schedule for this PRN
    const surgicalHistory = await prisma.otSchedule.findMany({
      where: { prn: String(prn) },
      orderBy: { date: 'desc' },
      take: 50,
      select: {
        id: true,
        date: true,
        procedureName: true,
        surgeonName: true,
        anaesthesiologistName: true,
        urgency: true,
        status: true,
        otRoom: { select: { name: true, code: true } },
      },
    });

    // Discharges via admissions
    const dischargeAdmissionIds = ipVisits.map((a) => a.id);
    const discharges = dischargeAdmissionIds.length
      ? await prisma.ipdDischarge.findMany({
          where: { admissionId: { in: dischargeAdmissionIds } },
          orderBy: { dischargeDate: 'desc' },
          select: {
            id: true,
            admissionId: true,
            dischargeDate: true,
            dischargeType: true,
            finalDiagnosis: true,
            conditionAtDischarge: true,
            summaryStatus: true,
          },
        })
      : [];

    res.status(200).json({
      data: {
        patient,
        opVisits,
        ipVisits,
        labReports: labReports.map((r) => ({
          ...r,
          surgicalShortDate: r.reportedAt ?? r.createdAt,
        })),
        radiologyReports: radiologyReports.map((r) => ({
          ...r,
          surgicalShortDate: r.reportedAt ?? r.createdAt,
        })),
        surgicalHistory: surgicalHistory.map((s) => ({
          ...s,
          otRoom: s.otRoom?.name ?? s.otRoom?.code ?? null,
        })),
        discharges,
      },
      meta: { from: fromDate, to: toDate, prn },
    });
  } catch (error) {
    console.error('[ot-archives] get failed:', error);
    res.status(500).json({ message: 'Failed to load archives' });
  }
};
