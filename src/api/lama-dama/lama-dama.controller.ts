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
import fs from "fs";
import path from "path";
import { getClinicalActor, stripAuditFields } from "../../middleware/audit-guard";
import { raiseByRule } from "../incident/rule-catalogue";

/**
 * Typed payloads sent to HMIS for LAMA / DAMA lifecycle events.
 * Exported so tests can assert exact shapes without re-deriving them.
 */
export interface LamaCreateHmisPayload {
  emergencyId: number | null;
  admissionId: string | null;
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
  emergencyId: number | null;
  admissionId?: string | null;
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
  admissionId: lama.admissionId ?? null,
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
  emergencyId: number | null;
  admissionId: string | null;
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
  emergencyId: number | null;
  admissionId?: string | null;
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
  admissionId: dama.admissionId ?? null,
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
      admissionId,
      doctorAdvice,
      riskExplained,
      patientSignature,
      witnessName,
      witnessSignature,
      reasonForLama,
    } = req.body;

    // Exactly one source link must be provided (emergency OR IPD admission).
    if ((emergencyId && admissionId) || (!emergencyId && !admissionId)) {
      res.status(400).json({
        message: "Provide exactly one of emergencyId / admissionId",
      });
      return;
    }

    if (!doctorAdvice || !reasonForLama) {
      res.status(400).json({
        message: "Missing required fields: doctorAdvice, reasonForLama",
      });
      return;
    }

    // Resolve the linked source (emergency or admission) and pre-check duplicates.
    let emergency:
      | { patientName: string | null; patientPrn: string | null }
      | null = null;
    let admission: { prn: string | null } | null = null;

    if (emergencyId) {
      emergency = await prisma.emergency.findUnique({
        where: { id: parseInt(emergencyId) },
        select: { patientName: true, patientPrn: true },
      });
      if (!emergency) {
        res.status(404).json({ message: "Emergency case not found" });
        return;
      }
      const existingLama = await prisma.lamaRecord.findUnique({
        where: { emergencyId: parseInt(emergencyId) },
      });
      if (existingLama) {
        res
          .status(400)
          .json({ message: "LAMA record already exists for this emergency" });
        return;
      }
    } else {
      admission = await prisma.ipdAdmission.findUnique({
        where: { id: admissionId },
        select: { prn: true },
      });
      if (!admission) {
        res.status(404).json({ message: "IPD admission not found" });
        return;
      }
      const existingLama = await prisma.lamaRecord.findFirst({
        where: { admissionId },
      });
      if (existingLama) {
        res
          .status(400)
          .json({ message: "LAMA record already exists for this admission" });
        return;
      }
    }

    // Create LAMA record — NABH MRD.1 coexistence stamping.
    const lamaRecord = await prisma.lamaRecord.create({
      data: {
        emergencyId: emergencyId ? parseInt(emergencyId) : null,
        admissionId: admissionId ?? null,
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

    // Phase 9.24 — auto-incident: LAMA raised without a patient signature.
    if (!patientSignature) {
      raiseByRule('LAMA_DAMA_WITHOUT_SIGNATURE', {
        emergencyId: emergencyId ? parseInt(emergencyId) : null,
        admissionId: admissionId ?? null,
        patientName: emergency?.patientName ?? null,
        patientPrn: emergency?.patientPrn ?? admission?.prn ?? null,
        extras: { type: 'LAMA', lamaId: lamaRecord.id },
      }).catch(() => { /* hooks are best-effort */ });
    }

    // Update source status (emergency cases flip to LAMA; IPD status is owned by the IPD module).
    if (emergencyId) {
      await prisma.emergency.update({
        where: { id: parseInt(emergencyId) },
        data: { status: "LAMA" },
      });
    }

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
      admissionId,
      doctorRecommendation,
      patientDeclinesAdvice,
      patientSignature,
      witnessName,
      witnessSignature,
      followUpAdvice,
    } = req.body;

    // Exactly one source link must be provided (emergency OR IPD admission).
    if ((emergencyId && admissionId) || (!emergencyId && !admissionId)) {
      res.status(400).json({
        message: "Provide exactly one of emergencyId / admissionId",
      });
      return;
    }

    if (!doctorRecommendation) {
      res.status(400).json({
        message: "Missing required fields: doctorRecommendation",
      });
      return;
    }

    // Resolve the linked source (emergency or admission) and pre-check duplicates.
    let emergency:
      | { patientName: string | null; patientPrn: string | null }
      | null = null;
    let admission: { prn: string | null } | null = null;

    if (emergencyId) {
      emergency = await prisma.emergency.findUnique({
        where: { id: parseInt(emergencyId) },
        select: { patientName: true, patientPrn: true },
      });
      if (!emergency) {
        res.status(404).json({ message: "Emergency case not found" });
        return;
      }
      const existingDama = await prisma.damaRecord.findUnique({
        where: { emergencyId: parseInt(emergencyId) },
      });
      if (existingDama) {
        res
          .status(400)
          .json({ message: "DAMA record already exists for this emergency" });
        return;
      }
    } else {
      admission = await prisma.ipdAdmission.findUnique({
        where: { id: admissionId },
        select: { prn: true },
      });
      if (!admission) {
        res.status(404).json({ message: "IPD admission not found" });
        return;
      }
      const existingDama = await prisma.damaRecord.findFirst({
        where: { admissionId },
      });
      if (existingDama) {
        res
          .status(400)
          .json({ message: "DAMA record already exists for this admission" });
        return;
      }
    }

    // Create DAMA record — NABH MRD.1 coexistence stamping.
    const damaRecord = await prisma.damaRecord.create({
      data: {
        emergencyId: emergencyId ? parseInt(emergencyId) : null,
        admissionId: admissionId ?? null,
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

    // Phase 9.24 — auto-incident: DAMA raised without a patient signature.
    if (!patientSignature) {
      raiseByRule('LAMA_DAMA_WITHOUT_SIGNATURE', {
        emergencyId: emergencyId ? parseInt(emergencyId) : null,
        admissionId: admissionId ?? null,
        patientName: emergency?.patientName ?? null,
        patientPrn: emergency?.patientPrn ?? admission?.prn ?? null,
        extras: { type: 'DAMA', damaId: damaRecord.id },
      }).catch(() => { /* hooks are best-effort */ });
    }

    // Update source status (emergency cases flip to DAMA; IPD status is owned by the IPD module).
    if (emergencyId) {
      await prisma.emergency.update({
        where: { id: parseInt(emergencyId) },
        data: { status: "DAMA" },
      });
    }

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
      include: {
        emergency: { select: { prn: true, patientName: true } },
        admission: { select: { admissionNo: true, prn: true } },
      },
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
      include: {
        emergency: { select: { prn: true, patientName: true } },
        admission: { select: { admissionNo: true, prn: true } },
      },
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
            include: { emergency: true, admission: true },
          })
        : await prisma.damaRecord.findUnique({
            where: { id: parseInt(id) },
            include: { emergency: true, admission: true },
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
            include: { emergency: true, admission: true },
          })
        : await prisma.damaRecord.findUnique({
            where: { id: parseInt(id) },
            include: { emergency: true, admission: true },
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

    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    doc.pipe(res);

    const generatedAt = new Date();
    const HOSPITAL_NAME = "Jayadev Memorial Rashtrotthana Hospital & Research Centre";
    const TEAL = "#0098A3";
    const LEFT = doc.page.margins.left; // 50
    const RIGHT = doc.page.width - doc.page.margins.right; // page width - 50
    const CONTENT_WIDTH = RIGHT - LEFT;

    // Branded letterhead. The hospital's PDF template (used elsewhere for the
    // estimation form) carries the header band + footer band + watermark, so we
    // use it as a full-page background. If the asset is unavailable at runtime,
    // fall back to a clean text letterhead so generation never fails.
    const backgroundImagePath = path.join(
      __dirname,
      "../../assets/JMRH Estimation Form.png"
    );
    const hasLetterhead = fs.existsSync(backgroundImagePath);

    const drawLetterhead = (): void => {
      if (hasLetterhead) {
        doc.image(backgroundImagePath, 0, 0, { width: 595, height: 842 });
        doc.y = 120; // start body below the template header band
      } else {
        doc.save();
        doc.fontSize(15).font("Helvetica-Bold").fillColor("black")
          .text(HOSPITAL_NAME, LEFT, 50, { width: CONTENT_WIDTH, align: "center" });
        const ruleY = doc.y + 4;
        doc.moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).lineWidth(1).strokeColor("#999").stroke();
        doc.restore();
      }
    };

    // Re-paint the letterhead on every new page so multi-page reports stay branded.
    doc.on("pageAdded", drawLetterhead);
    drawLetterhead();

    // Title + subtitle below the header band (template header occupies the top
    // ~110pt; text fallback uses a smaller top offset).
    const titleTop = hasLetterhead ? 120 : 95;
    const title =
      type === "lama"
        ? "LEAVE AGAINST MEDICAL ADVICE (LAMA)"
        : "DISCHARGE AGAINST MEDICAL ADVICE (DAMA)";

    doc.fontSize(16).font("Helvetica-Bold").fillColor(TEAL)
      .text(title, LEFT, titleTop, { width: CONTENT_WIDTH, align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).font("Helvetica").fillColor("#666")
      .text("CONFIDENTIAL — NABH ACC.6 Compliant Documentation", LEFT, doc.y, {
        width: CONTENT_WIDTH,
        align: "center",
      })
      .fillColor("black");
    doc.moveDown(1.2);

    // Section heading helper — consistent teal label with a thin underline.
    const sectionHeading = (heading: string): void => {
      doc.fontSize(12).font("Helvetica-Bold").fillColor(TEAL)
        .text(heading, LEFT, doc.y, { width: CONTENT_WIDTH });
      const y = doc.y + 2;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.fillColor("black");
      doc.moveDown(0.6);
    };

    // Labelled "Label: value" line with consistent label styling.
    const fieldRow = (label: string, value: string): void => {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333")
        .text(`${label}: `, LEFT, doc.y, { continued: true })
        .font("Helvetica").fillColor("black")
        .text(value || "—");
    };

    // Patient block — emergency-sourced records show the ER PRN/name/phone;
    // IPD-sourced records fall back to the admission's PRN + admission no.
    if (record.emergency || record.admission) {
      sectionHeading("Patient Information");
      // Two-column labelled block: PRN | Name (or Admission No) on one row.
      const colGap = 20;
      const colWidth = (CONTENT_WIDTH - colGap) / 2;
      const rowY = doc.y;
      const labelledCell = (label: string, value: string, x: number, w: number): void => {
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#333")
          .text(`${label}: `, x, rowY, { continued: true, width: w })
          .font("Helvetica").fillColor("black")
          .text(value || "—");
      };
      if (record.emergency) {
        labelledCell("PRN", String(record.emergency.prn ?? ""), LEFT, colWidth);
        labelledCell("Name", record.emergency.patientName ?? "", LEFT + colWidth + colGap, colWidth);
        doc.moveDown(0.4);
        if (record.emergency.phoneNumber) fieldRow("Phone", record.emergency.phoneNumber);
      } else if (record.admission) {
        labelledCell("PRN", String(record.admission.prn ?? ""), LEFT, colWidth);
        labelledCell("Admission No", record.admission.admissionNo ?? "", LEFT + colWidth + colGap, colWidth);
      }
      doc.moveDown(1);
    }

    if (type === "lama") {
      const lama = record as any;
      sectionHeading("LAMA Details");
      fieldRow("LAMA Time", new Date(lama.lamaTime).toLocaleString());
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333").text("Doctor's Advice:");
      doc.font("Helvetica").fillColor("black").text(lama.doctorAdvice || "—");
      doc.moveDown(0.3);
      fieldRow("Risk Explained", lama.riskExplained ? "Yes" : "No");
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333").text("Reason for LAMA:");
      doc.font("Helvetica").fillColor("black").text(lama.reasonForLama || "—");
    } else {
      const dama = record as any;
      sectionHeading("DAMA Details");
      fieldRow("Discharge Time", new Date(dama.dischargeTime).toLocaleString());
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333").text("Doctor's Recommendation:");
      doc.font("Helvetica").fillColor("black").text(dama.doctorRecommendation || "—");
      doc.moveDown(0.3);
      fieldRow("Patient Declines Advice", dama.patientDeclinesAdvice ? "Yes" : "No");
      if (dama.followUpAdvice) {
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#333").text("Follow-up Advice:");
        doc.font("Helvetica").fillColor("black").text(dama.followUpAdvice);
      }
    }

    // Signatures — patientSignature / witnessSignature now hold a SignatureBlob
    // id (e-sign pad). Resolve it and embed the captured image. Falls back
    // gracefully for legacy values (an old GCS URL stored directly) or none.
    // Layout: label line, then the image at a fixed box, then advance the cursor
    // past the image so the signer name + timestamp render BELOW it (no overlap).
    const SIG_FIT: [number, number] = [180, 60];
    const renderSignature = async (sigRef: string | null, label: string): Promise<void> => {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333")
        .text(`${label}:`, LEFT, doc.y);
      doc.fillColor("black");
      doc.moveDown(0.2);
      if (!sigRef) { doc.font("Helvetica").fontSize(10).text("Not signed"); return; }
      try {
        const blob = await prisma.signatureBlob.findUnique({
          where: { id: sigRef },
          select: { blobUrl: true, signerName: true, capturedAt: true },
        });
        if (blob?.blobUrl?.startsWith("data:image")) {
          const b64 = blob.blobUrl.split(",")[1] ?? "";
          const imgTop = doc.y;
          doc.image(Buffer.from(b64, "base64"), LEFT, imgTop, { fit: SIG_FIT });
          // Advance the cursor past the image height before writing the caption.
          doc.y = imgTop + SIG_FIT[1] + 4;
          const stamp = blob.capturedAt
            ? `  ·  ${new Date(blob.capturedAt).toLocaleString()}`
            : "";
          doc.font("Helvetica").fontSize(9).fillColor("#555")
            .text(`${blob.signerName ?? ""}${stamp}`.trim() || "Signed", LEFT, doc.y)
            .fillColor("black");
          return;
        }
        if (blob?.blobUrl) {
          doc.font("Helvetica").fontSize(10).text(`Signed (image at ${blob.blobUrl})`);
          return;
        }
        // Not a SignatureBlob id (legacy free-text / GCS URL).
        doc.font("Helvetica").fontSize(10).text("Signed");
      } catch {
        doc.font("Helvetica").fontSize(10).text("Signed");
      }
    };

    doc.moveDown(1.2);
    sectionHeading("Signatures");
    const rec = record as any;
    await renderSignature(rec.patientSignature, "Patient signature");
    doc.moveDown(1);
    if (rec.witnessName) {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#333")
        .text("Witness: ", LEFT, doc.y, { continued: true })
        .font("Helvetica").fillColor("black").text(rec.witnessName);
      doc.moveDown(0.3);
      await renderSignature(rec.witnessSignature, "Witness signature");
    }

    // Footer on every page — thin rule, hospital name (left), page X of N
    // (right), and generated timestamp. Drawn here via bufferPages so the
    // total page count (N) is known.
    // Stop re-painting the letterhead before drawing footers: writing in the
    // bottom-margin zone must NOT trigger new (blank, branded) pages.
    doc.removeAllListeners("pageAdded");
    const range = doc.bufferedPageRange();
    const footerStamp = `Generated: ${generatedAt.toLocaleString()}`;
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Zero the bottom margin while drawing so footer text positioned below the
      // normal content area doesn't auto-add a page. Restore afterwards.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - 40;
      doc.lineWidth(0.5).strokeColor("#cccccc")
        .moveTo(LEFT, footerY).lineTo(RIGHT, footerY).stroke();
      doc.fontSize(8).font("Helvetica").fillColor("#888");
      doc.text(HOSPITAL_NAME, LEFT, footerY + 5, {
        width: CONTENT_WIDTH * 0.65,
        align: "left",
        lineBreak: false,
      });
      doc.text(`Page ${i + 1} of ${range.count}`, RIGHT - 120, footerY + 5, {
        width: 120,
        align: "right",
        lineBreak: false,
      });
      doc.text(footerStamp, LEFT, footerY + 16, {
        width: CONTENT_WIDTH,
        align: "left",
        lineBreak: false,
      });
      doc.fillColor("black");
      doc.page.margins.bottom = savedBottom;
    }

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
