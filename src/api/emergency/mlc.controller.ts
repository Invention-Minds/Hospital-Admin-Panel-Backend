import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// MLC (Medico-Legal Case) — one per Emergency (emergencyId @unique).
//
// A single row hanging off /api/emergency/:id/mlc. Because emergencyId is
// unique we expose GET (fetch the row, may be null) and POST (upsert). The
// mlcNo (MLC-YYYY-NNN) is generated on create and never changed thereafter.

const parseEmergencyId = (req: Request, res: Response): number | null => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'Invalid emergency id' });
    return null;
  }
  return id;
};

const toBool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';
const toDate = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export const getMlc = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const row = await prisma.mlcCase.findUnique({ where: { emergencyId } });
    res.status(200).json(row);
  } catch (error) {
    console.error('[mlc] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch MLC record' });
  }
};

export const upsertMlc = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const {
      caseType, policeStationName, fir_No, fir_Date, investigatingOfficer,
      patientConsent, consentTime, consentSignature,
      firstExaminationDone, firstExaminationTime, examinerName, examinerSignature,
      injuries, photographsTaken, photoUrls,
      samplesCollected, sampleStorageInfo, followUpExams, finalReport,
      reportSubmittedTo, submissionDate, submissionProof, status,
    } = req.body;

    if (!caseType || !injuries) {
      res.status(400).json({ message: 'caseType and injuries are required' });
      return;
    }

    // Editable fields shared by create + update (mlcNo / emergencyId / createdBy excluded).
    const fields = {
      caseType,
      policeStationName: policeStationName ?? null,
      fir_No: fir_No ?? null,
      fir_Date: toDate(fir_Date),
      investigatingOfficer: investigatingOfficer ?? null,
      patientConsent: toBool(patientConsent),
      consentTime: toDate(consentTime),
      consentSignature: consentSignature ?? null,
      firstExaminationDone: toBool(firstExaminationDone),
      firstExaminationTime: toDate(firstExaminationTime),
      examinerName: examinerName ?? null,
      examinerSignature: examinerSignature ?? null,
      injuries,
      photographsTaken: toBool(photographsTaken),
      photoUrls: photoUrls ?? null,
      samplesCollected: samplesCollected ?? null,
      sampleStorageInfo: sampleStorageInfo ?? null,
      followUpExams: followUpExams ?? null,
      finalReport: finalReport ?? null,
      reportSubmittedTo: reportSubmittedTo ?? null,
      submissionDate: toDate(submissionDate),
      submissionProof: submissionProof ?? null,
      status: status ?? 'documented',
    };

    // Generate next mlcNo from the last row id (mirror generateEmergencyPRN).
    const year = new Date().getFullYear();
    const last = await prisma.mlcCase.findFirst({ orderBy: { id: 'desc' }, take: 1 });
    const next = (last?.id || 0) + 1;
    const mlcNo = `MLC-${year}-${String(next).padStart(3, '0')}`;

    const row = await prisma.mlcCase.upsert({
      where: { emergencyId },
      create: {
        emergencyId,
        mlcNo,
        createdBy: req.user?.username ?? null,
        ...fields,
      },
      update: {
        ...fields,
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[mlc] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save MLC record' });
  }
};
