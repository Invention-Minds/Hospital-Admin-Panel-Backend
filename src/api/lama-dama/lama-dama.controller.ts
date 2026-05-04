import { Request, Response } from "express";
import prisma from "../../service/prisma-client";
import { createHmisAuditLog } from "../hmis-sync/hmis-audit";
import {
  pushLamaCase,
  pushLamaUpdate,
  pushDamaCase,
  pushDamaUpdate,
} from "../hmis-sync/hmis-client";
import { syncWithHmis } from "../hmis-sync/hmis-sync-wrapper";
import bucket from "../../config/googeCloudStorage";
import PDFDocument from "pdfkit";
import { getClinicalActor, stripAuditFields } from "../../middleware/audit-guard";

/**
 * Typed payloads sent to HMIS for LAMA / DAMA lifecycle events.
 * Exported so tests can assert exact shapes without re-deriving them.
 */
export interface LamaCreateHmisPayload {
  emergencyId: number;
  lamaTime: string;
  doctorAdvice: string;
  riskExplained: boolean;
  patientSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  reasonForLama: string;
  createdBy: string;
}

export const buildLamaCreatePayload = (lama: {
  emergencyId: number;
  lamaTime: Date;
  doctorAdvice: string;
  riskExplained: boolean;
  patientSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  reasonForLama: string;
  createdBy: string | null;
}): LamaCreateHmisPayload => ({
  emergencyId: lama.emergencyId,
  lamaTime: lama.lamaTime.toISOString(),
  doctorAdvice: lama.doctorAdvice,
  riskExplained: lama.riskExplained,
  patientSignature: lama.patientSignature,
  witnessName: lama.witnessName,
  witnessSignature: lama.witnessSignature,
  reasonForLama: lama.reasonForLama,
  createdBy: lama.createdBy ?? "system",
});

export interface LamaUpdateHmisPayload {
  id: number;
  hmisLamaId: string | null;
  lamaTime: string;
  doctorAdvice: string;
  riskExplained: boolean;
  patientSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  reasonForLama: string;
  updatedBy: string;
}

export const buildLamaUpdatePayload = (
  lama: {
    id: number;
    hmisLamaId: string | null;
    lamaTime: Date;
    doctorAdvice: string;
    riskExplained: boolean;
    patientSignature: string | null;
    witnessName: string | null;
    witnessSignature: string | null;
    reasonForLama: string;
  },
  updatedBy: string
): LamaUpdateHmisPayload => ({
  id: lama.id,
  hmisLamaId: lama.hmisLamaId,
  lamaTime: lama.lamaTime.toISOString(),
  doctorAdvice: lama.doctorAdvice,
  riskExplained: lama.riskExplained,
  patientSignature: lama.patientSignature,
  witnessName: lama.witnessName,
  witnessSignature: lama.witnessSignature,
  reasonForLama: lama.reasonForLama,
  updatedBy,
});

export interface DamaCreateHmisPayload {
  emergencyId: number;
  dischargeTime: string;
  doctorRecommendation: string;
  patientDeclinesAdvice: boolean;
  patientSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  followUpAdvice: string | null;
  createdBy: string;
}

export const buildDamaCreatePayload = (dama: {
  emergencyId: number;
  dischargeTime: Date;
  doctorRecommendation: string;
  patientDeclinesAdvice: boolean;
  patientSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  followUpAdvice: string | null;
  createdBy: string | null;
}): DamaCreateHmisPayload => ({
  emergencyId: dama.emergencyId,
  dischargeTime: dama.dischargeTime.toISOString(),
  doctorRecommendation: dama.doctorRecommendation,
  patientDeclinesAdvice: dama.patientDeclinesAdvice,
  patientSignature: dama.patientSignature,
  witnessName: dama.witnessName,
  witnessSignature: dama.witnessSignature,
  followUpAdvice: dama.followUpAdvice,
  createdBy: dama.createdBy ?? "system",
});

export interface DamaUpdateHmisPayload {
  id: number;
  hmisDamaId: string | null;
  dischargeTime: string;
  doctorRecommendation: string;
  patientDeclinesAdvice: boolean;
  patientSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  followUpAdvice: string | null;
  updatedBy: string;
}

export const buildDamaUpdatePayload = (
  dama: {
    id: number;
    hmisDamaId: string | null;
    dischargeTime: Date;
    doctorRecommendation: string;
    patientDeclinesAdvice: boolean;
    patientSignature: string | null;
    witnessName: string | null;
    witnessSignature: string | null;
    followUpAdvice: string | null;
  },
  updatedBy: string
): DamaUpdateHmisPayload => ({
  id: dama.id,
  hmisDamaId: dama.hmisDamaId,
  dischargeTime: dama.dischargeTime.toISOString(),
  doctorRecommendation: dama.doctorRecommendation,
  patientDeclinesAdvice: dama.patientDeclinesAdvice,
  patientSignature: dama.patientSignature,
  witnessName: dama.witnessName,
  witnessSignature: dama.witnessSignature,
  followUpAdvice: dama.followUpAdvice,
  updatedBy,
});

/** Backfill hmisLamaId if a later HMIS push returns an id and we don't have one yet. */
const persistHmisLamaIdIfMissing = async (
  lama: { id: number; hmisLamaId: string | null },
  outcomeResult: unknown
): Promise<{ hmisLamaId: string | null }> => {
  if (lama.hmisLamaId) return { hmisLamaId: lama.hmisLamaId };
  const result = outcomeResult as { id?: string | number } | null | undefined;
  if (!result || result.id === undefined || result.id === null) {
    return { hmisLamaId: null };
  }
  const hmisLamaId = String(result.id);
  await prisma.lamaRecord.update({
    where: { id: lama.id },
    data: { hmisLamaId },
  });
  return { hmisLamaId };
};

/** Backfill hmisDamaId if a later HMIS push returns an id and we don't have one yet. */
const persistHmisDamaIdIfMissing = async (
  dama: { id: number; hmisDamaId: string | null },
  outcomeResult: unknown
): Promise<{ hmisDamaId: string | null }> => {
  if (dama.hmisDamaId) return { hmisDamaId: dama.hmisDamaId };
  const result = outcomeResult as { id?: string | number } | null | undefined;
  if (!result || result.id === undefined || result.id === null) {
    return { hmisDamaId: null };
  }
  const hmisDamaId = String(result.id);
  await prisma.damaRecord.update({
    where: { id: dama.id },
    data: { hmisDamaId },
  });
  return { hmisDamaId };
};

// Upload helper
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

/**
 * Create LAMA (Leave Against Medical Advice) record
 * Patient leaves without doctor's consent
 */
export const createLamaRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const {
      emergencyId,
      doctorAdvice,
      riskExplained,
      patientSignature,
      witnessName,
      witnessSignature,
      reasonForLama,
    } = req.body;

    if (!emergencyId || !doctorAdvice || !reasonForLama) {
      res.status(400).json({
        message:
          "Missing required fields: emergencyId, doctorAdvice, reasonForLama",
      });
      return;
    }

    // Verify emergency exists
    const emergency = await prisma.emergency.findUnique({
      where: { id: parseInt(emergencyId) },
    });

    if (!emergency) {
      res.status(404).json({ message: "Emergency case not found" });
      return;
    }

    // Check if LAMA already exists
    const existingLama = await prisma.lamaRecord.findUnique({
      where: { emergencyId: parseInt(emergencyId) },
    });

    if (existingLama) {
      res
        .status(400)
        .json({
          message: "LAMA record already exists for this emergency",
        });
      return;
    }

    // Create LAMA record — NABH MRD.1 coexistence stamping.
    const lamaRecord = await prisma.lamaRecord.create({
      data: {
        emergencyId: parseInt(emergencyId),
        lamaTime: new Date(),
        doctorAdvice,
        riskExplained,
        patientSignature,
        witnessName,
        witnessSignature,
        reasonForLama,
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    // Update emergency status
    await prisma.emergency.update({
      where: { id: parseInt(emergencyId) },
      data: { status: "LAMA" },
    });

    // Push to HMIS via the audit-wrapped pipeline (inline-await per Sprint 2 latency policy).
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "lama",
      entityType: "lama-record",
      action: "lama_created",
      payload: lamaRecord,
      operation: () => pushLamaCase(buildLamaCreatePayload(lamaRecord)),
    });

    let finalLama = lamaRecord;
    if (hmisOutcome.success && hmisOutcome.result) {
      const hmisResult = hmisOutcome.result as { id?: string | number };
      if (hmisResult.id !== undefined && hmisResult.id !== null) {
        finalLama = await prisma.lamaRecord.update({
          where: { id: lamaRecord.id },
          data: { hmisLamaId: String(hmisResult.id) },
        });
      }
    }

    res.status(201).json({
      message: "LAMA record created successfully",
      data: finalLama,
    });
  } catch (error) {
    console.error("Error creating LAMA record:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Create DAMA (Discharged Against Medical Advice) record
 * Doctor recommends continued care but patient declines
 */
export const createDamaRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const {
      emergencyId,
      doctorRecommendation,
      patientDeclinesAdvice,
      patientSignature,
      witnessName,
      witnessSignature,
      followUpAdvice,
    } = req.body;

    if (!emergencyId || !doctorRecommendation) {
      res.status(400).json({
        message: "Missing required fields: emergencyId, doctorRecommendation",
      });
      return;
    }

    // Verify emergency exists
    const emergency = await prisma.emergency.findUnique({
      where: { id: parseInt(emergencyId) },
    });

    if (!emergency) {
      res.status(404).json({ message: "Emergency case not found" });
      return;
    }

    // Check if DAMA already exists
    const existingDama = await prisma.damaRecord.findUnique({
      where: { emergencyId: parseInt(emergencyId) },
    });

    if (existingDama) {
      res
        .status(400)
        .json({
          message: "DAMA record already exists for this emergency",
        });
      return;
    }

    // Create DAMA record — NABH MRD.1 coexistence stamping.
    const damaRecord = await prisma.damaRecord.create({
      data: {
        emergencyId: parseInt(emergencyId),
        dischargeTime: new Date(),
        doctorRecommendation,
        patientDeclinesAdvice,
        patientSignature,
        witnessName,
        witnessSignature,
        followUpAdvice,
        createdBy: req.user!.username,
        createdById: actorId,
      },
    });

    // Update emergency status
    await prisma.emergency.update({
      where: { id: parseInt(emergencyId) },
      data: { status: "DAMA" },
    });

    // Push to HMIS via the audit-wrapped pipeline (inline-await per Sprint 2 latency policy).
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "dama",
      entityType: "dama-record",
      action: "dama_created",
      payload: damaRecord,
      operation: () => pushDamaCase(buildDamaCreatePayload(damaRecord)),
    });

    let finalDama = damaRecord;
    if (hmisOutcome.success && hmisOutcome.result) {
      const hmisResult = hmisOutcome.result as { id?: string | number };
      if (hmisResult.id !== undefined && hmisResult.id !== null) {
        finalDama = await prisma.damaRecord.update({
          where: { id: damaRecord.id },
          data: { hmisDamaId: String(hmisResult.id) },
        });
      }
    }

    res.status(201).json({
      message: "DAMA record created successfully",
      data: finalDama,
    });
  } catch (error) {
    console.error("Error creating DAMA record:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get LAMA record by ID
 */
export const getLamaRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const lamaRecord = await prisma.lamaRecord.findUnique({
      where: { id: parseInt(id) },
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            phoneNumber: true,
            presentingComplaint: true,
          },
        },
      },
    });

    if (!lamaRecord) {
      res.status(404).json({ message: "LAMA record not found" });
      return;
    }

    res.status(200).json({
      message: "LAMA record retrieved successfully",
      data: lamaRecord,
    });
  } catch (error) {
    console.error("Error retrieving LAMA record:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get DAMA record by ID
 */
export const getDamaRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const damaRecord = await prisma.damaRecord.findUnique({
      where: { id: parseInt(id) },
      include: {
        emergency: {
          select: {
            prn: true,
            patientName: true,
            phoneNumber: true,
            presentingComplaint: true,
          },
        },
      },
    });

    if (!damaRecord) {
      res.status(404).json({ message: "DAMA record not found" });
      return;
    }

    res.status(200).json({
      message: "DAMA record retrieved successfully",
      data: damaRecord,
    });
  } catch (error) {
    console.error("Error retrieving DAMA record:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get all LAMA/DAMA records with filters
 */
export const getLamaDamaRecords = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { type, page = 1, limit = 10 } = req.query;

    let lamaRecords: any[] = [];
    let damaRecords: any[] = [];
    let total = 0;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    if (!type || type === "lama") {
      lamaRecords = await prisma.lamaRecord.findMany({
        include: {
          emergency: {
            select: {
              prn: true,
              patientName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      });
    }

    if (!type || type === "dama") {
      damaRecords = await prisma.damaRecord.findMany({
        include: {
          emergency: {
            select: {
              prn: true,
              patientName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      });
    }

    const lamaCount = await prisma.lamaRecord.count();
    const damaCount = await prisma.damaRecord.count();
    total = lamaCount + damaCount;

    res.status(200).json({
      message: "LAMA/DAMA records retrieved successfully",
      data: {
        lama: lamaRecords,
        dama: damaRecords,
      },
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error("Error retrieving LAMA/DAMA records:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get all LAMA records
 */
export const getAllLamaRecords = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const records = await prisma.lamaRecord.findMany({
      include: { emergency: { select: { prn: true, patientName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ message: "LAMA records retrieved", data: records });
  } catch (error) {
    console.error("Error retrieving LAMA records:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get all DAMA records
 */
export const getAllDamaRecords = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const records = await prisma.damaRecord.findMany({
      include: { emergency: { select: { prn: true, patientName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ message: "DAMA records retrieved", data: records });
  } catch (error) {
    console.error("Error retrieving DAMA records:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get LAMA/DAMA records by date range
 */
export const getRecordsByDateRange = async (
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

    const [lama, dama] = await Promise.all([
      prisma.lamaRecord.findMany({
        where: { createdAt: { gte: start, lte: end } },
        include: { emergency: { select: { prn: true, patientName: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.damaRecord.findMany({
        where: { createdAt: { gte: start, lte: end } },
        include: { emergency: { select: { prn: true, patientName: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.status(200).json({
      message: "Records by date retrieved",
      data: { lama, dama },
    });
  } catch (error) {
    console.error("Error retrieving records by date:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Update LAMA record
 */
export const updateLamaRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const body = stripAuditFields({ ...req.body });
    delete body.id;
    delete body.emergencyId;

    if (body.lamaTime) body.lamaTime = new Date(body.lamaTime as string | Date);

    const updated = await prisma.lamaRecord.update({
      where: { id: parseInt(id) },
      data: {
        ...body,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    // Inline-await HMIS push via wrapper.
    const updatedBy = req.user?.username || "system";
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "lama",
      entityType: "lama-record",
      action: "lama_updated",
      payload: updated,
      operation: () => pushLamaUpdate(buildLamaUpdatePayload(updated, updatedBy)),
    });

    const { hmisLamaId } = await persistHmisLamaIdIfMissing(updated, hmisOutcome.result);
    const finalLama = hmisLamaId && !updated.hmisLamaId ? { ...updated, hmisLamaId } : updated;

    res.status(200).json({ message: "LAMA record updated", data: finalLama });
  } catch (error) {
    console.error("Error updating LAMA record:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Update DAMA record
 */
export const updateDamaRecord = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const actorId = getClinicalActor(req, res);
    if (actorId === null) return;

    const { id } = req.params;
    const body = stripAuditFields({ ...req.body });
    delete body.id;
    delete body.emergencyId;

    if (body.dischargeTime) body.dischargeTime = new Date(body.dischargeTime as string | Date);

    const updated = await prisma.damaRecord.update({
      where: { id: parseInt(id) },
      data: {
        ...body,
        updatedBy: req.user!.username,
        updatedById: actorId,
      },
    });

    // Inline-await HMIS push via wrapper.
    const updatedBy = req.user?.username || "system";
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "dama",
      entityType: "dama-record",
      action: "dama_updated",
      payload: updated,
      operation: () => pushDamaUpdate(buildDamaUpdatePayload(updated, updatedBy)),
    });

    const { hmisDamaId } = await persistHmisDamaIdIfMissing(updated, hmisOutcome.result);
    const finalDama = hmisDamaId && !updated.hmisDamaId ? { ...updated, hmisDamaId } : updated;

    res.status(200).json({ message: "DAMA record updated", data: finalDama });
  } catch (error) {
    console.error("Error updating DAMA record:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get LAMA record by emergency
 */
export const getLamaByEmergency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { emergencyId } = req.query;
    if (!emergencyId) {
      res.status(400).json({ message: "emergencyId required" });
      return;
    }
    const record = await prisma.lamaRecord.findUnique({
      where: { emergencyId: parseInt(emergencyId as string) },
      include: { emergency: true },
    });
    if (!record) {
      res.status(404).json({ message: "LAMA record not found" });
      return;
    }
    res.status(200).json({ message: "LAMA record retrieved", data: record });
  } catch (error) {
    console.error("Error retrieving LAMA by emergency:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get DAMA record by emergency
 */
export const getDamaByEmergency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { emergencyId } = req.query;
    if (!emergencyId) {
      res.status(400).json({ message: "emergencyId required" });
      return;
    }
    const record = await prisma.damaRecord.findUnique({
      where: { emergencyId: parseInt(emergencyId as string) },
      include: { emergency: true },
    });
    if (!record) {
      res.status(404).json({ message: "DAMA record not found" });
      return;
    }
    res.status(200).json({ message: "DAMA record retrieved", data: record });
  } catch (error) {
    console.error("Error retrieving DAMA by emergency:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Upload signature for LAMA/DAMA — generic helper
 */
const uploadSignatureHandler = async (
  type: "lama" | "dama",
  field: "patientSignature" | "witnessSignature",
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

    const url = await uploadBufferToGCS(file, `${type}/${id}/signatures`);

    const auditStamp = {
      updatedBy: req.user!.username,
      updatedById: actorId,
    };
    const updated =
      type === "lama"
        ? await prisma.lamaRecord.update({
            where: { id: parseInt(id) },
            data: { [field]: url, ...auditStamp },
          })
        : await prisma.damaRecord.update({
            where: { id: parseInt(id) },
            data: { [field]: url, ...auditStamp },
          });

    res.status(200).json({
      message: `${field} uploaded`,
      data: { url, record: updated },
    });
  } catch (error) {
    console.error(`Error uploading ${type} ${field}:`, error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

export const uploadLamaPatientSignature = (req: Request, res: Response) =>
  uploadSignatureHandler("lama", "patientSignature", req, res);
export const uploadLamaWitnessSignature = (req: Request, res: Response) =>
  uploadSignatureHandler("lama", "witnessSignature", req, res);
export const uploadDamaPatientSignature = (req: Request, res: Response) =>
  uploadSignatureHandler("dama", "patientSignature", req, res);
export const uploadDamaWitnessSignature = (req: Request, res: Response) =>
  uploadSignatureHandler("dama", "witnessSignature", req, res);

/**
 * LAMA/DAMA statistics
 */
export const getLamaDamaStats = async (
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

    const [lamaTotal, damaTotal, lamaThisMonth, damaThisMonth] = await Promise.all([
      prisma.lamaRecord.count({ where }),
      prisma.damaRecord.count({ where }),
      prisma.lamaRecord.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      prisma.damaRecord.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
    ]);

    res.status(200).json({
      message: "LAMA/DAMA statistics retrieved",
      data: {
        lamaTotal,
        damaTotal,
        total: lamaTotal + damaTotal,
        thisMonth: { lama: lamaThisMonth, dama: damaThisMonth },
      },
    });
  } catch (error) {
    console.error("Error fetching LAMA/DAMA stats:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Download LAMA/DAMA documentation (JSON)
 */
const downloadDocumentation = async (
  type: "lama" | "dama",
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const record =
      type === "lama"
        ? await prisma.lamaRecord.findUnique({
            where: { id: parseInt(id) },
            include: { emergency: true },
          })
        : await prisma.damaRecord.findUnique({
            where: { id: parseInt(id) },
            include: { emergency: true },
          });

    if (!record) {
      res.status(404).json({ message: `${type.toUpperCase()} record not found` });
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${type}-${id}.json"`
    );
    res.status(200).send(JSON.stringify(record, null, 2));
  } catch (error) {
    console.error(`Error downloading ${type} doc:`, error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

export const downloadLamaDocumentation = (req: Request, res: Response) =>
  downloadDocumentation("lama", req, res);
export const downloadDamaDocumentation = (req: Request, res: Response) =>
  downloadDocumentation("dama", req, res);

/**
 * Generate LAMA/DAMA report PDF
 */
const generateReportPdf = async (
  type: "lama" | "dama",
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const record =
      type === "lama"
        ? await prisma.lamaRecord.findUnique({
            where: { id: parseInt(id) },
            include: { emergency: true },
          })
        : await prisma.damaRecord.findUnique({
            where: { id: parseInt(id) },
            include: { emergency: true },
          });

    if (!record) {
      res.status(404).json({ message: `${type.toUpperCase()} record not found` });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${type.toUpperCase()}-Report-${id}.pdf"`
    );

    const doc = new PDFDocument({ margin: 50, bufferPages: true });
    doc.pipe(res);

    const title =
      type === "lama"
        ? "LEAVE AGAINST MEDICAL ADVICE (LAMA)"
        : "DISCHARGE AGAINST MEDICAL ADVICE (DAMA)";

    doc.fontSize(16).font("Helvetica-Bold").text(title, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor("#666")
      .text("CONFIDENTIAL — NABH ACC.6 Compliant Documentation", { align: "center" })
      .fillColor("black");
    doc.moveDown(1);

    if (record.emergency) {
      doc.fontSize(11).font("Helvetica-Bold").text("Patient Information:");
      doc.font("Helvetica").fontSize(10);
      doc.text(`PRN: ${record.emergency.prn}`);
      doc.text(`Name: ${record.emergency.patientName}`);
      if (record.emergency.phoneNumber) doc.text(`Phone: ${record.emergency.phoneNumber}`);
      doc.moveDown(0.5);
    }

    if (type === "lama") {
      const lama = record as any;
      doc.font("Helvetica-Bold").text("LAMA Time:");
      doc.font("Helvetica").text(new Date(lama.lamaTime).toLocaleString());
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text("Doctor's Advice:");
      doc.font("Helvetica").text(lama.doctorAdvice);
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text(`Risk Explained: ${lama.riskExplained ? "Yes" : "No"}`);
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text("Reason for LAMA:");
      doc.font("Helvetica").text(lama.reasonForLama);
    } else {
      const dama = record as any;
      doc.font("Helvetica-Bold").text("Discharge Time:");
      doc.font("Helvetica").text(new Date(dama.dischargeTime).toLocaleString());
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text("Doctor's Recommendation:");
      doc.font("Helvetica").text(dama.doctorRecommendation);
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text(`Patient Declines Advice: ${dama.patientDeclinesAdvice ? "Yes" : "No"}`);
      if (dama.followUpAdvice) {
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").text("Follow-up Advice:");
        doc.font("Helvetica").text(dama.followUpAdvice);
      }
    }

    doc.moveDown(1);
    doc.font("Helvetica-Bold").text("Signatures:");
    doc.font("Helvetica");
    const rec = record as any;
    doc.text(`Patient signed: ${rec.patientSignature ? "Yes" : "No"}`);
    if (rec.witnessName) {
      doc.text(`Witness: ${rec.witnessName}`);
      doc.text(`Witness signed: ${rec.witnessSignature ? "Yes" : "No"}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#888")
      .text(`Generated: ${new Date().toISOString()}`, { align: "center" })
      .fillColor("black");

    doc.end();
  } catch (error) {
    console.error(`Error generating ${type} PDF:`, error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error", error });
    }
  }
};

export const generateLamaReport = (req: Request, res: Response) =>
  generateReportPdf("lama", req, res);
export const generateDamaReport = (req: Request, res: Response) =>
  generateReportPdf("dama", req, res);

/**
 * Verify LAMA/DAMA documentation — checks required fields are present
 */
export const verifyDocumentation = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { type, id } = req.params;

    if (type !== "lama" && type !== "dama") {
      res.status(400).json({ message: "Invalid type, must be lama or dama" });
      return;
    }

    const record =
      type === "lama"
        ? await prisma.lamaRecord.findUnique({ where: { id: parseInt(id) } })
        : await prisma.damaRecord.findUnique({ where: { id: parseInt(id) } });

    if (!record) {
      res.status(404).json({ message: `${type.toUpperCase()} record not found` });
      return;
    }

    const issues: string[] = [];
    const rec = record as any;
    if (!rec.patientSignature) issues.push("Patient signature missing");
    if (!rec.witnessName) issues.push("Witness name missing");
    if (!rec.witnessSignature) issues.push("Witness signature missing");
    if (type === "lama" && !rec.riskExplained) issues.push("Risk not marked as explained");
    if (type === "lama" && !rec.reasonForLama) issues.push("Reason for LAMA missing");
    if (type === "dama" && !rec.doctorRecommendation) issues.push("Doctor recommendation missing");

    const compliant = issues.length === 0;

    await createHmisAuditLog({
      direction: "push",
      module: type,
      action: "verify",
      payload: JSON.stringify({ id, compliant, issues }),
      status: "success",
    });

    res.status(200).json({
      message: "Verification complete",
      data: { compliant, issues, record },
    });
  } catch (error) {
    console.error("Error verifying documentation:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * LAMA/DAMA compliance report — summary of documentation quality
 */
export const getComplianceReport = async (
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

    const [lamaRecords, damaRecords] = await Promise.all([
      prisma.lamaRecord.findMany({ where }),
      prisma.damaRecord.findMany({ where }),
    ]);

    const analyzeRecords = (records: any[], type: "lama" | "dama") => {
      const total = records.length;
      let compliant = 0;
      const issues: string[] = [];
      records.forEach((r) => {
        const recIssues: string[] = [];
        if (!r.patientSignature) recIssues.push("patient-signature");
        if (!r.witnessSignature) recIssues.push("witness-signature");
        if (type === "lama" && !r.riskExplained) recIssues.push("risk-not-explained");
        if (recIssues.length === 0) compliant++;
        else issues.push(...recIssues);
      });
      return {
        total,
        compliant,
        nonCompliant: total - compliant,
        complianceRate: total ? Math.round((compliant / total) * 100) : 0,
        commonIssues: issues.reduce((acc: any, i) => {
          acc[i] = (acc[i] || 0) + 1;
          return acc;
        }, {}),
      };
    };

    res.status(200).json({
      message: "Compliance report generated",
      data: {
        lama: analyzeRecords(lamaRecords, "lama"),
        dama: analyzeRecords(damaRecords, "dama"),
      },
    });
  } catch (error) {
    console.error("Error generating compliance report:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};
