import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.5b — OT Discharge Summary aggregator.
//
// One read endpoint that collects the five tabs the reference HMIS
// "Discharge Summary" screen surfaces from inside the OT workbench:
//   Admission        — IpdAdmission core fields
//   Operative Notes  — every OtIntraOpNote for schedules on the admission
//   Course           — IpdProgressNote rolled up (date + assessment/plan)
//   Advice           — IpdDischarge.advice + .medications
//   Other            — discharge type, follow-up, diagnosis codes
//
// Frontend tabs render whichever slice they need; backend ships all five
// in one round-trip to keep modal UX snappy.

export const getOtDischargeSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!admissionId) { res.status(400).json({ message: 'admissionId is required' }); return; }

    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: {
        id: true,
        admissionNo: true,
        prn: true,
        admissionDate: true,
        admissionTime: true,
        admissionType: true,
        admittingDoctor: true,
        department: true,
        roomType: true,
        diagnosis: true,
        status: true,
      },
    });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    const schedules = await prisma.otSchedule.findMany({
      where: { admissionId },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        procedureName: true,
        surgeonName: true,
        anaesthesiologistName: true,
        otRoom: { select: { name: true, code: true } },
        intraOpNotes: {
          orderBy: { noteNumber: 'asc' },
        },
      },
    });

    const operativeNotes: Array<Record<string, unknown>> = [];
    for (const s of schedules) {
      for (const n of s.intraOpNotes) {
        operativeNotes.push({
          ...n,
          scheduleId: s.id,
          scheduleDate: s.date,
          procedureName: s.procedureName,
          otRoom: s.otRoom?.name ?? s.otRoom?.code ?? null,
        });
      }
    }

    const progressNotes = await prisma.ipdProgressNote.findMany({
      where: { admissionId },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        doctorName: true,
        subjective: true,
        objective: true,
        assessment: true,
        plan: true,
      },
    });

    const discharge = await prisma.ipdDischarge.findUnique({
      where: { admissionId },
      select: {
        id: true,
        dischargeDate: true,
        dischargeTime: true,
        dischargeType: true,
        finalDiagnosis: true,
        proceduresDone: true,
        conditionAtDischarge: true,
        dischargeSummary: true,
        followUpDate: true,
        followUpDoctor: true,
        medications: true,
        advice: true,
        summaryStatus: true,
      },
    });

    const diagnosisCodes = await prisma.admissionDiagnosisCode.findMany({
      where: { admissionId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });

    res.status(200).json({
      data: {
        admission,
        schedules: schedules.map((s) => ({
          id: s.id,
          date: s.date,
          procedureName: s.procedureName,
          surgeonName: s.surgeonName,
          anaesthesiologistName: s.anaesthesiologistName,
          otRoom: s.otRoom?.name ?? s.otRoom?.code ?? null,
        })),
        operativeNotes,
        progressNotes,
        discharge,
        diagnosisCodes,
      },
    });
  } catch (error) {
    console.error('[ot-discharge-summary] get failed:', error);
    res.status(500).json({ message: 'Failed to load discharge summary' });
  }
};
