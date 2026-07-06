import { Request, Response } from "express";
import prisma from "../../service/prisma-client";
import { createHmisAuditLog } from "../hmis-sync/hmis-audit";
import { pushMlcCase, pushMlcUpdate } from "../hmis-sync/hmis-client";
import { syncWithHmis } from "../hmis-sync/hmis-sync-wrapper";
import bucket from "../../config/googeCloudStorage";
import PDFDocument from "pdfkit";
import { getClinicalActor, stripAuditFields } from "../../middleware/audit-guard";
import {
  applyJmrhLetterhead,
  drawJmrhFooter,
} from "../_shared/pdf-letterhead";

/**
 * Typed payloads sent to HMIS for MLC lifecycle events.
 * Exported so tests can assert exact shapes without re-deriving them.
 */
export interface MlcRegisterHmisPayload {
  mlcNo: string;
  emergencyId: number;
  caseType: string;
  policeStationName: string | null;
  fir_No: string | null;
  fir_Date: string | null;
  investigatingOfficer: string | null;
  status: string;
  // NABH MRD.2 — additive incident/identification detail.
  incidentDateTime: string | null;
  incidentPlace: string | null;
  allegedCause: string | null;
  weaponType: string | null;
  broughtBy: string | null;
  broughtByDetail: string | null;
  informantName: string | null;
  informantRelation: string | null;
  identificationMark1: string | null;
  identificationMark2: string | null;
  examiningDoctorRegNo: string | null;
  referredTo: string | null;
}

export const buildMlcRegisterPayload = (mlc: {
  mlcNo: string;
  emergencyId: number;
  caseType: string;
  policeStationName: string | null;
  fir_No: string | null;
  fir_Date: Date | null;
  investigatingOfficer: string | null;
  status: string;
  incidentDateTime?: Date | null;
  incidentPlace?: string | null;
  allegedCause?: string | null;
  weaponType?: string | null;
  broughtBy?: string | null;
  broughtByDetail?: string | null;
  informantName?: string | null;
  informantRelation?: string | null;
  identificationMark1?: string | null;
  identificationMark2?: string | null;
  examiningDoctorRegNo?: string | null;
  referredTo?: string | null;
}): MlcRegisterHmisPayload => ({
  mlcNo: mlc.mlcNo,
  emergencyId: mlc.emergencyId,
  caseType: mlc.caseType,
  policeStationName: mlc.policeStationName,
  fir_No: mlc.fir_No,
  fir_Date: mlc.fir_Date ? mlc.fir_Date.toISOString() : null,
  investigatingOfficer: mlc.investigatingOfficer,
  status: mlc.status,
  incidentDateTime: mlc.incidentDateTime ? mlc.incidentDateTime.toISOString() : null,
  incidentPlace: mlc.incidentPlace ?? null,
  allegedCause: mlc.allegedCause ?? null,
  weaponType: mlc.weaponType ?? null,
  broughtBy: mlc.broughtBy ?? null,
  broughtByDetail: mlc.broughtByDetail ?? null,
  informantName: mlc.informantName ?? null,
  informantRelation: mlc.informantRelation ?? null,
  identificationMark1: mlc.identificationMark1 ?? null,
  identificationMark2: mlc.identificationMark2 ?? null,
  examiningDoctorRegNo: mlc.examiningDoctorRegNo ?? null,
  referredTo: mlc.referredTo ?? null,
});

export type MlcUpdateEvent =
  | "examination"
  | "samples_collected"
  | "report_submitted";

export interface MlcExaminationSection {
  firstExaminationDone: boolean;
  firstExaminationTime: string | null;
  examinerName: string | null;
  examinerSignature: string | null;
  injuries: string;
  photographsTaken: boolean;
  photoUrls: string | null;
  // NABH MRD.2 — additive examination-consent / opinion detail.
  consentForExamination: boolean | null;
  consentForExamTime: string | null;
  injuryOpinion: string | null;
  examiningDoctorRegNo: string | null;
}

export interface MlcSamplesSection {
  samplesCollected: string | null;
  sampleStorageInfo: string | null;
}

export interface MlcReportSection {
  finalReport: string | null;
  reportSubmittedTo: string | null;
  submissionDate: string | null;
  submissionProof: string | null;
  // NABH MRD.2 — additive police-intimation detail.
  policeIntimationTime: string | null;
  policeIntimationMode: string | null;
  policeIntimationBy: string | null;
}

export interface MlcUpdateHmisPayload {
  event: MlcUpdateEvent;
  hmisMlcId: string | null;
  mlcNo: string;
  status: string;
  updatedBy: string;
  examination?: MlcExaminationSection;
  samples?: MlcSamplesSection;
  report?: MlcReportSection;
}

export const buildMlcExaminationPayload = (
  mlc: {
    hmisMlcId: string | null;
    mlcNo: string;
    status: string;
    firstExaminationDone: boolean;
    firstExaminationTime: Date | null;
    examinerName: string | null;
    examinerSignature: string | null;
    injuries: string;
    photographsTaken: boolean;
    photoUrls: string | null;
    consentForExamination?: boolean | null;
    consentForExamTime?: Date | null;
    injuryOpinion?: string | null;
    examiningDoctorRegNo?: string | null;
  },
  updatedBy: string
): MlcUpdateHmisPayload => ({
  event: "examination",
  hmisMlcId: mlc.hmisMlcId,
  mlcNo: mlc.mlcNo,
  status: mlc.status,
  updatedBy,
  examination: {
    firstExaminationDone: mlc.firstExaminationDone,
    firstExaminationTime: mlc.firstExaminationTime
      ? mlc.firstExaminationTime.toISOString()
      : null,
    examinerName: mlc.examinerName,
    examinerSignature: mlc.examinerSignature,
    injuries: mlc.injuries,
    photographsTaken: mlc.photographsTaken,
    photoUrls: mlc.photoUrls,
    consentForExamination: mlc.consentForExamination ?? null,
    consentForExamTime: mlc.consentForExamTime
      ? mlc.consentForExamTime.toISOString()
      : null,
    injuryOpinion: mlc.injuryOpinion ?? null,
    examiningDoctorRegNo: mlc.examiningDoctorRegNo ?? null,
  },
});

export const buildMlcSamplesPayload = (
  mlc: {
    hmisMlcId: string | null;
    mlcNo: string;
    status: string;
    samplesCollected: string | null;
    sampleStorageInfo: string | null;
  },
  updatedBy: string
): MlcUpdateHmisPayload => ({
  event: "samples_collected",
  hmisMlcId: mlc.hmisMlcId,
  mlcNo: mlc.mlcNo,
  status: mlc.status,
  updatedBy,
  samples: {
    samplesCollected: mlc.samplesCollected,
    sampleStorageInfo: mlc.sampleStorageInfo,
  },
});

export const buildMlcReportPayload = (
  mlc: {
    hmisMlcId: string | null;
    mlcNo: string;
    status: string;
    finalReport: string | null;
    reportSubmittedTo: string | null;
    submissionDate: Date | null;
    submissionProof: string | null;
    policeIntimationTime?: Date | null;
    policeIntimationMode?: string | null;
    policeIntimationBy?: string | null;
  },
  updatedBy: string
): MlcUpdateHmisPayload => ({
  event: "report_submitted",
  hmisMlcId: mlc.hmisMlcId,
  mlcNo: mlc.mlcNo,
  status: mlc.status,
  updatedBy,
  report: {
    finalReport: mlc.finalReport,
    reportSubmittedTo: mlc.reportSubmittedTo,
    submissionDate: mlc.submissionDate ? mlc.submissionDate.toISOString() : null,
    submissionProof: mlc.submissionProof,
    policeIntimationTime: mlc.policeIntimationTime
      ? mlc.policeIntimationTime.toISOString()
      : null,
    policeIntimationMode: mlc.policeIntimationMode ?? null,
    policeIntimationBy: mlc.policeIntimationBy ?? null,
  },
});

/** Helper to persist hmisMlcId when HMIS returns an id and we don't have one yet. */
const persistHmisMlcIdIfMissing = async (
  mlcCase: { id: number; hmisMlcId: string | null },
  outcomeResult: unknown
): Promise<{ hmisMlcId: string | null }> => {
  if (mlcCase.hmisMlcId) return { hmisMlcId: mlcCase.hmisMlcId };
  const result = outcomeResult as { id?: string | number } | null | undefined;
  if (!result || result.id === undefined || result.id === null) {
    return { hmisMlcId: null };
  }
  const hmisMlcId = String(result.id);
  await prisma.mlcCase.update({
    where: { id: mlcCase.id },
    data: { hmisMlcId },
  });
  return { hmisMlcId };
};

// Upload helper — pushes an in-memory file buffer to GCS and returns the public URL
const uploadBufferToGCS = (
  file: Express.Multer.File,
  folder: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const filename = `${folder}/${Date.now()}-${file.originalname}`;
    const blob = bucket.file(filename);
    const blobStream = blob.createWriteStream({ resumable: false });
    blobStream.on("error", reject);
    blobStream.on("finish", () => {
      resolve(`https://storage.googleapis.com/${bucket.name}/${blob.name}`);
    });
    blobStream.end(file.buffer);
  });
};

// Generate MLC number
const generateMlcNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const lastMlc = await prisma.mlcCase.findFirst({
    orderBy: { id: "desc" },
    take: 1,
  });

  const nextNumber = (lastMlc?.id || 0) + 1;
  return `MLC-${year}-${String(nextNumber).padStart(4, "0")}`;
};

/**
 * Register new MLC case (auto-filled from Emergency)
 */
export const registerMlcCase = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const {
      emergencyId,
      caseType,
      policeStationName,
      fir_No,
      fir_Date,
      // NABH MRD.2 — additive incident/identification detail.
      investigatingOfficer,
      incidentDateTime,
      incidentPlace,
      allegedCause,
      weaponType,
      broughtBy,
      broughtByDetail,
      informantName,
      informantRelation,
      identificationMark1,
      identificationMark2,
      examiningDoctorRegNo,
      referredTo,
    } = req.body;

    if (!emergencyId || !caseType) {
      res
        .status(400)
        .json({ message: "Missing required fields: emergencyId, caseType" });
      return;
    }

    // Verify emergency case exists
    const emergency = await prisma.emergency.findUnique({
      where: { id: parseInt(emergencyId) },
    });

    if (!emergency) {
      res.status(404).json({ message: "Emergency case not found" });
      return;
    }

    // Check if MLC already exists for this emergency
    const existingMlc = await prisma.mlcCase.findUnique({
      where: { emergencyId: parseInt(emergencyId) },
    });

    if (existingMlc) {
      res
        .status(400)
        .json({
          message: "MLC case already exists for this emergency",
        });
      return;
    }

    // Generate MLC number
    const mlcNo = await generateMlcNumber();

    // Create MLC case — NABH MRD.1 coexistence stamping.
    const mlcCase = await prisma.mlcCase.create({
      data: {
        emergencyId: parseInt(emergencyId),
        mlcNo,
        caseType,
        policeStationName,
        fir_No,
        fir_Date: fir_Date ? new Date(fir_Date) : null,
        // NABH MRD.2 — additive optional incident/identification detail.
        investigatingOfficer: investigatingOfficer ?? null,
        incidentDateTime: incidentDateTime ? new Date(incidentDateTime) : null,
        incidentPlace: incidentPlace ?? null,
        allegedCause: allegedCause ?? null,
        weaponType: weaponType ?? null,
        broughtBy: broughtBy ?? null,
        broughtByDetail: broughtByDetail ?? null,
        informantName: informantName ?? null,
        informantRelation: informantRelation ?? null,
        identificationMark1: identificationMark1 ?? null,
        identificationMark2: identificationMark2 ?? null,
        examiningDoctorRegNo: examiningDoctorRegNo ?? null,
        referredTo: referredTo ?? null,
        patientConsent: false, // To be updated after patient examination
        firstExaminationDone: false, // To be updated after examination
        injuries: "", // To be filled during examination
        photographsTaken: false, // To be updated when photos are uploaded
        status: "documented",
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    // Push to HMIS via the audit-wrapped pipeline (inline-await per Sprint 2 latency policy).
    // MLC is regulatory paperwork — the HMIS-returned id must be persisted synchronously.
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "mlc",
      entityType: "mlc-case",
      action: "mlc_registered",
      payload: mlcCase,
      operation: () => pushMlcCase(buildMlcRegisterPayload(mlcCase)),
    });

    let finalMlc = mlcCase;
    if (hmisOutcome.success && hmisOutcome.result) {
      const hmisResult = hmisOutcome.result as { id?: string | number };
      if (hmisResult.id !== undefined && hmisResult.id !== null) {
        finalMlc = await prisma.mlcCase.update({
          where: { id: mlcCase.id },
          data: { hmisMlcId: String(hmisResult.id) },
        });
      }
    }

    res.status(201).json({
      message: "MLC case registered successfully",
      data: finalMlc,
    });
  } catch (error) {
    console.error("Error registering MLC case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get MLC case by ID
 */
export const getMlcCase = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const mlcCase = await prisma.mlcCase.findUnique({
      where: { id: parseInt(id) },
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            phoneNumber: true,
            age: true,
            presentingComplaint: true,
          },
        },
        // NABH MRD.2 — per-injury detail rows.
        injuries_detail: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!mlcCase) {
      res.status(404).json({ message: "MLC case not found" });
      return;
    }

    res.status(200).json({
      message: "MLC case retrieved successfully",
      data: mlcCase,
    });
  } catch (error) {
    console.error("Error retrieving MLC case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get all MLC cases with filters
 */
/**
 * GET /api/mlc/mine
 * MLC cases belonging to the logged-in doctor — i.e. cases whose linked
 * emergency was referred/assigned to them (same doctor link as the Emergency
 * worklist). 403-free: returns an empty list if the user isn't a doctor.
 */
export const getMyMlcCases = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = typeof req.user?.id === "number" ? req.user.id : null;
    if (userId == null) { res.status(200).json({ data: [] }); return; }
    const doctor = await prisma.doctor.findFirst({ where: { userId }, select: { id: true } });
    if (!doctor) { res.status(200).json({ data: [] }); return; }

    const rows = await prisma.mlcCase.findMany({
      where: { emergency: { referrals: { some: { referredToDoctorId: doctor.id } } } },
      include: { emergency: { select: { prn: true, patientName: true, age: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error("[mlc] getMyMlcCases failed:", error);
    res.status(500).json({ error: "Failed to load MLC cases" });
  }
};

export const getMlcCaseList = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { status, caseType, page = 1, limit = 10 } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (caseType) where.caseType = caseType;

    const mlcCases = await prisma.mlcCase.findMany({
      where,
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            age: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string),
    });

    const total = await prisma.mlcCase.count({ where });

    res.status(200).json({
      message: "MLC cases retrieved successfully",
      data: mlcCases,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error("Error retrieving MLC cases:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Record examination findings
 */
export const recordExamination = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const {
      examinerName,
      examinerSignature,
      injuries,
      photographsTaken,
      photoUrls,
      // NABH MRD.2 — additive examination-consent / opinion detail.
      consentForExamination,
      consentForExamTime,
      injuryOpinion,
      examiningDoctorRegNo,
    } = req.body;

    const mlcCase = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        firstExaminationDone: true,
        firstExaminationTime: new Date(),
        examinerName,
        examinerSignature,
        injuries,
        photographsTaken,
        photoUrls: photoUrls ? JSON.stringify(photoUrls) : null,
        // NABH MRD.2 — additive optional examination detail.
        consentForExamination:
          consentForExamination === undefined
            ? undefined
            : Boolean(consentForExamination),
        consentForExamTime: consentForExamTime
          ? new Date(consentForExamTime)
          : undefined,
        injuryOpinion: injuryOpinion ?? undefined,
        examiningDoctorRegNo: examiningDoctorRegNo ?? undefined,
        status: "examination-done",
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    // Inline-await HMIS push via wrapper.
    const updatedBy = req.user!.username;
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "mlc",
      entityType: "mlc-case",
      action: "mlc_examination",
      payload: mlcCase,
      operation: () => pushMlcUpdate(buildMlcExaminationPayload(mlcCase, updatedBy)),
    });

    // Backfill hmisMlcId if the register-push had failed earlier and this one succeeded.
    const { hmisMlcId } = await persistHmisMlcIdIfMissing(mlcCase, hmisOutcome.result);
    const finalMlc = hmisMlcId && !mlcCase.hmisMlcId ? { ...mlcCase, hmisMlcId } : mlcCase;

    res.status(200).json({
      message: "Examination recorded successfully",
      data: finalMlc,
    });
  } catch (error) {
    console.error("Error recording examination:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Record sample collection
 */
export const recordSampleCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const { samplesCollected, sampleStorageInfo } = req.body;

    const mlcCase = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        samplesCollected,
        sampleStorageInfo,
        status: "samples-collected",
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    // Inline-await HMIS push via wrapper.
    const updatedBy = req.user!.username;
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "mlc",
      entityType: "mlc-case",
      action: "mlc_samples_collected",
      payload: mlcCase,
      operation: () => pushMlcUpdate(buildMlcSamplesPayload(mlcCase, updatedBy)),
    });

    const { hmisMlcId } = await persistHmisMlcIdIfMissing(mlcCase, hmisOutcome.result);
    const finalMlc = hmisMlcId && !mlcCase.hmisMlcId ? { ...mlcCase, hmisMlcId } : mlcCase;

    res.status(200).json({
      message: "Sample collection recorded successfully",
      data: finalMlc,
    });
  } catch (error) {
    console.error("Error recording sample collection:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Submit final report to police/court
 */
export const submitReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const {
      finalReport,
      reportSubmittedTo,
      submissionProof,
      // NABH MRD.2 — additive police-intimation detail.
      policeIntimationTime,
      policeIntimationMode,
      policeIntimationBy,
    } = req.body;

    if (!finalReport) {
      res
        .status(400)
        .json({ message: "Missing required field: finalReport" });
      return;
    }

    const mlcCase = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        finalReport,
        reportSubmittedTo,
        submissionDate: new Date(),
        submissionProof,
        // NABH MRD.2 — additive optional police-intimation detail.
        policeIntimationTime: policeIntimationTime
          ? new Date(policeIntimationTime)
          : undefined,
        policeIntimationMode: policeIntimationMode ?? undefined,
        policeIntimationBy: policeIntimationBy ?? undefined,
        status: "report-submitted",
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    // Inline-await HMIS push via wrapper.
    const updatedBy = req.user!.username;
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "mlc",
      entityType: "mlc-case",
      action: "mlc_report_submitted",
      payload: mlcCase,
      operation: () => pushMlcUpdate(buildMlcReportPayload(mlcCase, updatedBy)),
    });

    const { hmisMlcId } = await persistHmisMlcIdIfMissing(mlcCase, hmisOutcome.result);
    const finalMlc = hmisMlcId && !mlcCase.hmisMlcId ? { ...mlcCase, hmisMlcId } : mlcCase;

    res.status(200).json({
      message: "Report submitted successfully",
      data: finalMlc,
    });
  } catch (error) {
    console.error("Error submitting report:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get MLC case by MLC number
 */
export const getMlcCaseByNumber = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { mlcNo } = req.query;
    if (!mlcNo) {
      res.status(400).json({ message: "mlcNo query required" });
      return;
    }
    const mlcCase = await prisma.mlcCase.findUnique({
      where: { mlcNo: mlcNo as string },
      include: { emergency: true },
    });
    if (!mlcCase) {
      res.status(404).json({ message: "MLC case not found" });
      return;
    }
    res.status(200).json({ message: "MLC case retrieved", data: mlcCase });
  } catch (error) {
    console.error("Error retrieving MLC by number:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get MLC case by emergency ID
 */
export const getMlcCaseByEmergency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { emergencyId } = req.query;
    if (!emergencyId) {
      res.status(400).json({ message: "emergencyId query required" });
      return;
    }
    const mlcCase = await prisma.mlcCase.findUnique({
      where: { emergencyId: parseInt(emergencyId as string) },
      include: { emergency: true },
    });
    if (!mlcCase) {
      res.status(404).json({ message: "MLC case not found for emergency" });
      return;
    }
    res.status(200).json({ message: "MLC case retrieved", data: mlcCase });
  } catch (error) {
    console.error("Error retrieving MLC by emergency:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get MLC cases by date range
 */
export const getMlcCasesByDate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) {
      res.status(400).json({ message: "fromDate and toDate required" });
      return;
    }
    const start = new Date(fromDate as string);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate as string);
    end.setHours(23, 59, 59, 999);

    const cases = await prisma.mlcCase.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { emergency: { select: { prn: true, patientName: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ message: "MLC cases retrieved", data: cases });
  } catch (error) {
    console.error("Error retrieving MLC by date:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Update MLC case (general update)
 */
export const updateMlcCase = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const body = stripAuditFields({ ...req.body });
    delete body.id;
    delete body.mlcNo;
    delete body.emergencyId;

    if (body.fir_Date) body.fir_Date = new Date(body.fir_Date as string | Date);
    // NABH MRD.2 — coerce additive date-string fields to Date.
    if (body.incidentDateTime)
      body.incidentDateTime = new Date(body.incidentDateTime as string | Date);
    if (body.consentForExamTime)
      body.consentForExamTime = new Date(body.consentForExamTime as string | Date);
    if (body.policeIntimationTime)
      body.policeIntimationTime = new Date(body.policeIntimationTime as string | Date);
    if (body.consentForExamination !== undefined)
      body.consentForExamination = Boolean(body.consentForExamination);
    if (body.photoUrls && Array.isArray(body.photoUrls)) {
      body.photoUrls = JSON.stringify(body.photoUrls);
    }

    const mlcCase = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        ...body,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    res.status(200).json({ message: "MLC case updated successfully", data: mlcCase });
  } catch (error) {
    console.error("Error updating MLC case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Upload photographs to MLC case (multiple files)
 */
export const uploadMlcPhotos = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ message: "No files uploaded" });
      return;
    }

    const urls = await Promise.all(files.map((f) => uploadBufferToGCS(f, `mlc/${id}/photos`)));

    const existing = await prisma.mlcCase.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      res.status(404).json({ message: "MLC case not found" });
      return;
    }

    const currentUrls: string[] = existing.photoUrls ? JSON.parse(existing.photoUrls) : [];
    const newUrls = [...currentUrls, ...urls];

    const updated = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        photoUrls: JSON.stringify(newUrls),
        photographsTaken: true,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    res.status(200).json({
      message: "Photographs uploaded successfully",
      data: { photoUrls: newUrls, mlcCase: updated },
    });
  } catch (error) {
    console.error("Error uploading MLC photos:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Upload examiner signature
 */
export const uploadExaminerSignature = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const file = req.file as Express.Multer.File;

    if (!file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const url = await uploadBufferToGCS(file, `mlc/${id}/signatures`);

    const updated = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        examinerSignature: url,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    res.status(200).json({
      message: "Examiner signature uploaded",
      data: { signatureUrl: url, mlcCase: updated },
    });
  } catch (error) {
    console.error("Error uploading signature:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Upload submission proof document
 */
export const uploadSubmissionProof = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const file = req.file as Express.Multer.File;

    if (!file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const url = await uploadBufferToGCS(file, `mlc/${id}/submission`);

    const updated = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        submissionProof: url,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    res.status(200).json({
      message: "Submission proof uploaded",
      data: { submissionProofUrl: url, mlcCase: updated },
    });
  } catch (error) {
    console.error("Error uploading submission proof:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get MLC statistics
 */
export const getMlcStats = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromDate, toDate } = req.query;
    const where: any = {};
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [total, documented, examined, samplesCollected, submitted, closed, accident, assault, poison, burn, other] =
      await Promise.all([
        prisma.mlcCase.count({ where }),
        prisma.mlcCase.count({ where: { ...where, status: "documented" } }),
        prisma.mlcCase.count({ where: { ...where, status: "examination-done" } }),
        prisma.mlcCase.count({ where: { ...where, status: "samples-collected" } }),
        prisma.mlcCase.count({ where: { ...where, status: "report-submitted" } }),
        prisma.mlcCase.count({ where: { ...where, status: "closed" } }),
        prisma.mlcCase.count({ where: { ...where, caseType: "accident" } }),
        prisma.mlcCase.count({ where: { ...where, caseType: "assault" } }),
        prisma.mlcCase.count({ where: { ...where, caseType: "poison" } }),
        prisma.mlcCase.count({ where: { ...where, caseType: "burn" } }),
        prisma.mlcCase.count({ where: { ...where, caseType: "other" } }),
      ]);

    res.status(200).json({
      message: "MLC statistics retrieved",
      data: {
        total,
        byStatus: { documented, examined, samplesCollected, submitted, closed },
        byCaseType: { accident, assault, poison, burn, other },
      },
    });
  } catch (error) {
    console.error("Error fetching MLC stats:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Close MLC case
 */
export const closeMlcCase = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const { closureNotes } = req.body;

    const mlcCase = await prisma.mlcCase.update({
      where: { id: parseInt(id) },
      data: {
        status: "closed",
        followUpExams: closureNotes || undefined,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    await createHmisAuditLog({
      direction: "push",
      module: "mlc",
      action: "close",
      payload: JSON.stringify({ id, closureNotes }),
      status: "success",
    });

    res.status(200).json({ message: "MLC case closed", data: mlcCase });
  } catch (error) {
    console.error("Error closing MLC case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get MLC case history (audit log entries)
 */
export const getMlcCaseHistory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const history = await prisma.hmisAuditLog.findMany({
      where: {
        module: "mlc",
        payload: { contains: `"id":${parseInt(id)}` },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.status(200).json({ message: "MLC history retrieved", data: history });
  } catch (error) {
    console.error("Error fetching MLC history:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Download MLC documentation (JSON bundle)
 */
export const downloadMlcDocumentation = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const mlcCase = await prisma.mlcCase.findUnique({
      where: { id: parseInt(id) },
      include: { emergency: true },
    });

    if (!mlcCase) {
      res.status(404).json({ message: "MLC case not found" });
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mlc-${mlcCase.mlcNo}.json"`
    );
    res.status(200).send(JSON.stringify(mlcCase, null, 2));
  } catch (error) {
    console.error("Error downloading MLC documentation:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Generate MLC report as PDF
 */
export const generateMlcReportPdf = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const mlcCase = await prisma.mlcCase.findUnique({
      where: { id: parseInt(id) },
      include: { emergency: true },
    });

    if (!mlcCase) {
      res.status(404).json({ message: "MLC case not found" });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="MLC-Report-${mlcCase.mlcNo}.pdf"`
    );

    const doc = new PDFDocument({ margin: 50, bufferPages: true });
    doc.pipe(res);

    applyJmrhLetterhead(doc);

    doc.fontSize(16).font("Helvetica-Bold").text("MEDICO-LEGAL CASE REPORT", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor("#666")
      .text("CONFIDENTIAL — For authorized personnel only", { align: "center" })
      .fillColor("black");
    doc.moveDown(1);

    doc.fontSize(11).font("Helvetica-Bold").text(`MLC Number: ${mlcCase.mlcNo}`);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Case Type: ${mlcCase.caseType}`);
    doc.text(`Status: ${mlcCase.status}`);
    doc.text(`Created: ${new Date(mlcCase.createdAt).toLocaleString()}`);
    doc.moveDown(0.5);

    if (mlcCase.emergency) {
      doc.font("Helvetica-Bold").text("Patient Information:");
      doc.font("Helvetica");
      doc.text(`PRN: ${mlcCase.emergency.prn}`);
      doc.text(`Name: ${mlcCase.emergency.patientName}`);
      if (mlcCase.emergency.phoneNumber) doc.text(`Phone: ${mlcCase.emergency.phoneNumber}`);
      if (mlcCase.emergency.age) doc.text(`Age: ${mlcCase.emergency.age}`);
      doc.moveDown(0.5);
    }

    if (mlcCase.policeStationName) {
      doc.font("Helvetica-Bold").text("Police Details:");
      doc.font("Helvetica");
      doc.text(`Police Station: ${mlcCase.policeStationName}`);
      if (mlcCase.fir_No) doc.text(`FIR No: ${mlcCase.fir_No}`);
      if (mlcCase.fir_Date) doc.text(`FIR Date: ${new Date(mlcCase.fir_Date).toLocaleDateString()}`);
      if (mlcCase.investigatingOfficer) doc.text(`Investigating Officer: ${mlcCase.investigatingOfficer}`);
      doc.moveDown(0.5);
    }

    doc.font("Helvetica-Bold").text("Examination:");
    doc.font("Helvetica");
    doc.text(`Patient Consent: ${mlcCase.patientConsent ? "Yes" : "No"}`);
    doc.text(`First Examination Done: ${mlcCase.firstExaminationDone ? "Yes" : "No"}`);
    if (mlcCase.examinerName) doc.text(`Examiner: ${mlcCase.examinerName}`);
    if (mlcCase.firstExaminationTime)
      doc.text(`Examination Time: ${new Date(mlcCase.firstExaminationTime).toLocaleString()}`);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Injuries/Findings:");
    doc.font("Helvetica").text(mlcCase.injuries || "None recorded");
    doc.moveDown(0.5);

    if (mlcCase.samplesCollected) {
      doc.font("Helvetica-Bold").text("Samples Collected:");
      doc.font("Helvetica").text(mlcCase.samplesCollected);
      if (mlcCase.sampleStorageInfo) doc.text(`Storage: ${mlcCase.sampleStorageInfo}`);
      doc.moveDown(0.5);
    }

    if (mlcCase.finalReport) {
      doc.font("Helvetica-Bold").text("Final Report:");
      doc.font("Helvetica").text(mlcCase.finalReport);
      if (mlcCase.reportSubmittedTo) doc.text(`Submitted To: ${mlcCase.reportSubmittedTo}`);
      if (mlcCase.submissionDate)
        doc.text(`Submission Date: ${new Date(mlcCase.submissionDate).toLocaleString()}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#888")
      .text(`Generated: ${new Date().toISOString()}`, { align: "center" })
      .fillColor("black");

    drawJmrhFooter(doc, new Date());

    doc.end();
  } catch (error) {
    console.error("Error generating MLC PDF:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Error generating MLC PDF", error });
    }
  }
};

/**
 * Get pending MLC reports (awaiting submission)
 */
export const getPendingReports = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pendingCases = await prisma.mlcCase.findMany({
      where: {
        status: {
          in: ["documented", "examination-done", "samples-collected"],
        },
      },
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            age: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json({
      message: "Pending MLC reports retrieved successfully",
      data: pendingCases,
      count: pendingCases.length,
    });
  } catch (error) {
    console.error("Error retrieving pending reports:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * NABH MRD.2 — list per-injury detail rows for a case.
 */
export const listInjuries = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const injuries = await prisma.mlcInjury.findMany({
      where: { mlcCaseId: parseInt(id) },
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json({ message: "Injuries retrieved", data: injuries });
  } catch (error) {
    console.error("Error retrieving MLC injuries:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * NABH MRD.2 — add a per-injury detail row to a case. `site` is required.
 */
export const addInjury = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const {
      site,
      injuryType,
      size,
      ageOfInjury,
      weaponLikely,
      simpleOrGrievous,
      notes,
    } = req.body;

    if (!site) {
      res.status(400).json({ message: "Missing required field: site" });
      return;
    }

    const injury = await prisma.mlcInjury.create({
      data: {
        mlcCaseId: parseInt(id),
        site,
        injuryType: injuryType ?? null,
        size: size ?? null,
        ageOfInjury: ageOfInjury ?? null,
        weaponLikely: weaponLikely ?? null,
        simpleOrGrievous: simpleOrGrievous ?? null,
        notes: notes ?? null,
      },
    });

    res.status(201).json({ message: "Injury added", data: injury });
  } catch (error) {
    console.error("Error adding MLC injury:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * NABH MRD.2 — delete a per-injury detail row from a case.
 */
export const deleteInjury = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { injuryId } = req.params;

    await prisma.mlcInjury.delete({
      where: { id: parseInt(injuryId) },
    });

    res.status(200).json({ message: "Injury deleted" });
  } catch (error) {
    console.error("Error deleting MLC injury:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};
