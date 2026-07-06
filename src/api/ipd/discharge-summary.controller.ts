import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.17 — Discharge Summary context.
//
// Assembles the full printable discharge summary (the UHJ paper layout) by
// pulling read-only data from the modules where it already lives — no new
// columns. The editable discharge row supplies the discharge-specific fields;
// everything else (clinical findings, operative notes, labs, allergies) is
// gathered here so the printed summary mirrors the paper.

export const getDischargeContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;

    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      include: {
        ward: { select: { wardName: true, wardCode: true, floor: true } },
        bed: { select: { bedNumber: true } },
        discharge: true,
        initialAssessment: true,
      },
    });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    // Patient demographics (PatientDetails.prn is Int).
    const prnInt = admission.prn ? Number(admission.prn) : NaN;
    const patient = Number.isFinite(prnInt)
      ? await prisma.patientDetails.findFirst({
          where: { prn: prnInt },
          select: { name: true, age: true, gender: true, bloodGroup: true, mobileNo: true },
        })
      : null;

    // Allergies (free of the assessment's checkbox flags — the dedicated table).
    const allergies = admission.prn
      ? await prisma.allergy.findMany({
          where: { prn: admission.prn },
          select: { genericName: true },
        }).catch(() => [])
      : [];

    // OT — surgeon / anaesthetist + operative notes for this admission.
    const otSchedules = await prisma.otSchedule.findMany({
      where: { admissionId },
      select: {
        id: true, procedureName: true, surgeonName: true, anaesthesiologistName: true,
        plannedStart: true, actualStart: true,
        intraOpNotes: {
          select: {
            noteNumber: true, startAt: true, endAt: true, anaesthesiaType: true,
            surgeons: true, findings: true, procedureDone: true, complications: true,
          },
          orderBy: { noteNumber: 'asc' },
        },
      },
      orderBy: { plannedStart: 'asc' },
    });

    // Recent lab/radiology results (finals first).
    const results = admission.prn
      ? await prisma.investigationResult.findMany({
          where: { prn: admission.prn, isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            testName: true, department: true, result: true, unit: true,
            referenceRange: true, impression: true, reportedAt: true, criticalFlag: true,
          },
        })
      : [];

    res.status(200).json({
      data: {
        admission: {
          id: admission.id,
          admissionNo: admission.admissionNo,
          prn: admission.prn,
          admissionDate: admission.admissionDate,
          admissionTime: admission.admissionTime,
          department: admission.department,
          admittingDoctor: admission.admittingDoctor,
          roomType: admission.roomType,
          ward: admission.ward,
          bed: admission.bed,
          diagnosis: admission.diagnosis,
        },
        patient,
        allergies: allergies.map((a) => a.genericName).filter(Boolean),
        initialAssessment: admission.initialAssessment,
        discharge: admission.discharge,
        otSchedules,
        results,
      },
    });
  } catch (error) {
    console.error('[discharge-summary] context failed:', error);
    res.status(500).json({ message: 'Failed to assemble discharge summary' });
  }
};
