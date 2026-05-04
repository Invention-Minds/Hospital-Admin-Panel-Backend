import { Request, Response } from "express";
import prisma from "../../service/prisma-client";
import { pushEmergencyToHmis } from "../hmis-sync/hmis-client";
import { createHmisAuditLog } from "../hmis-sync/hmis-audit";
import { syncWithHmis } from "../hmis-sync/hmis-sync-wrapper";
import { convertEmergencyToIpd } from "../conversion/emergency-to-ipd";

// Generate PRN for emergency case
const generateEmergencyPRN = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const lastEmergency = await prisma.emergency.findFirst({
    orderBy: { id: "desc" },
    take: 1,
  });

  const nextNumber = (lastEmergency?.id || 0) + 1;
  return `JMRH-ER-${year}-${String(nextNumber).padStart(4, "0")}`;
};

/**
 * Create new Emergency case
 * Auto-generates PRN and pushes to HMIS
 */
export const createEmergency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      patientName,
      phoneNumber,
      age,
      gender,
      triageCategory,
      presentingComplaint,
      abcdeAssessment,
      traumaScore,
      vitalsBP,
      vitalsHR,
      vitalsRR,
      vitalsSpO2,
      vitalsTemp,
      proceduresDone,
    } = req.body;

    // Validate required fields
    if (
      !patientName ||
      !triageCategory ||
      !presentingComplaint ||
      !abcdeAssessment
    ) {
      res.status(400).json({
        message:
          "Missing required fields: patientName, triageCategory, presentingComplaint, abcdeAssessment",
      });
      return;
    }

    // Generate PRN
    const prn = await generateEmergencyPRN();

    // Create emergency case in Docminds
    const emergency = await prisma.emergency.create({
      data: {
        prn,
        patientName,
        phoneNumber,
        age,
        gender,
        triageCategory,
        presentingComplaint,
        abcdeAssessment,
        traumaScore,
        vitalsBP,
        vitalsHR,
        vitalsRR,
        vitalsSpO2,
        vitalsTemp,
        proceduresDone,
        status: "arrived",
        docmindsCreated: true,
        createdBy: req.user?.username || "system",
      },
    });

    // Push to HMIS via the audit-wrapped pipeline (writes success + failure logs).
    const hmisOutcome = await syncWithHmis({
      direction: "push",
      module: "emergency",
      entityType: "emergency-case",
      action: "create",
      payload: emergency,
      operation: () =>
        pushEmergencyToHmis({
          prn: emergency.prn,
          patientName: emergency.patientName,
          phoneNumber: emergency.phoneNumber,
          age: emergency.age,
          gender: emergency.gender,
          triageCategory: emergency.triageCategory,
          presentingComplaint: emergency.presentingComplaint,
        }),
    });

    if (hmisOutcome.success) {
      await prisma.emergency.update({
        where: { id: emergency.id },
        data: { hmisCreated: true },
      });
    }

    res.status(201).json({
      message: "Emergency case created successfully",
      data: emergency,
    });
  } catch (error) {
    console.error("Error creating emergency case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get emergency case by ID
 */
export const getEmergency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const emergency = await prisma.emergency.findUnique({
      where: { id: parseInt(id) },
      include: {
        progressNotes: {
          orderBy: { time: "desc" },
        },
        mlcCase: true,
        lamaRecord: true,
        damaRecord: true,
      },
    });

    if (!emergency) {
      res.status(404).json({ message: "Emergency case not found" });
      return;
    }

    res.status(200).json({
      message: "Emergency case retrieved successfully",
      data: emergency,
    });
  } catch (error) {
    console.error("Error retrieving emergency case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get all emergency cases with filters
 */
export const getEmergencyList = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { status, triageCategory, page = 1, limit = 10 } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (triageCategory) where.triageCategory = triageCategory;

    const emergencies = await prisma.emergency.findMany({
      where,
      include: {
        progressNotes: {
          take: 1,
          orderBy: { time: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string),
    });

    const total = await prisma.emergency.count({ where });

    res.status(200).json({
      message: "Emergency cases retrieved successfully",
      data: emergencies,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error("Error retrieving emergency cases:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Update emergency status
 */
export const updateEmergencyStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (
      ![
        "arrived",
        "stabilized",
        "referred",
        "admitted-ipd",
        "LAMA",
        "DAMA",
        "discharged",
      ].includes(status)
    ) {
      res.status(400).json({ message: "Invalid status" });
      return;
    }

    const emergency = await prisma.emergency.update({
      where: { id: parseInt(id) },
      data: {
        status,
        updatedBy: req.user?.username || "system",
      },
    });

    // Push update to HMIS
    try {
      await createHmisAuditLog({
        direction: "push",
        module: "emergency",
        action: "status_update",
        payload: JSON.stringify({ id: emergency.id, status }),
        status: "success",
      });
    } catch (hmisError) {
      console.error("HMIS audit log failed:", hmisError);
    }

    res.status(200).json({
      message: "Emergency status updated successfully",
      data: emergency,
    });
  } catch (error) {
    console.error("Error updating emergency status:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Add progress note to emergency case
 */
export const addProgressNote = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      doctorName,
      observation,
      vitalsBP,
      vitalsHR,
      vitalsRR,
      vitalsSpO2,
      vitalsTemp,
    } = req.body;

    if (!doctorName || !observation) {
      res
        .status(400)
        .json({
          message: "Missing required fields: doctorName, observation",
        });
      return;
    }

    const progressNote = await prisma.emergencyProgressNote.create({
      data: {
        emergencyId: parseInt(id),
        doctorName,
        observation,
        vitalsBP,
        vitalsHR,
        vitalsRR,
        vitalsSpO2,
        vitalsTemp,
        createdBy: req.user?.username || "system",
      },
    });

    res.status(201).json({
      message: "Progress note added successfully",
      data: progressNote,
    });
  } catch (error) {
    console.error("Error adding progress note:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get all progress notes for an emergency case
 */
export const getProgressNotes = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const progressNotes = await prisma.emergencyProgressNote.findMany({
      where: { emergencyId: parseInt(id) },
      orderBy: { time: "desc" },
    });

    res.status(200).json({
      message: "Progress notes retrieved successfully",
      data: progressNotes,
    });
  } catch (error) {
    console.error("Error retrieving progress notes:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Update emergency case (general update)
 */
export const updateEmergency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const body = { ...req.body };
    // Strip fields that shouldn't be overwritten directly
    delete body.id;
    delete body.prn;
    delete body.createdAt;

    const emergency = await prisma.emergency.update({
      where: { id: parseInt(id) },
      data: {
        ...body,
        updatedBy: req.user?.username || "system",
      },
    });

    res.status(200).json({
      message: "Emergency case updated successfully",
      data: emergency,
    });
  } catch (error) {
    console.error("Error updating emergency case:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get emergency cases by date range
 */
export const getEmergencyByDate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { date, fromDate, toDate } = req.query;

    let where: any = {};
    if (date) {
      const start = new Date(date as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    } else if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate as string);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    } else {
      res.status(400).json({ message: "Provide date or fromDate+toDate" });
      return;
    }

    const emergencies = await prisma.emergency.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      message: "Emergency cases by date retrieved",
      data: emergencies,
    });
  } catch (error) {
    console.error("Error retrieving emergency cases by date:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get emergency queue (pending/active cases - not discharged/admitted)
 */
export const getEmergencyQueue = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const pending = await prisma.emergency.findMany({
      where: {
        status: { in: ["arrived", "stabilized", "referred"] },
      },
      orderBy: [
        { triageCategory: "asc" }, // red first alphabetically, we sort below
        { createdAt: "asc" },
      ],
    });

    // Custom sort by triage priority
    const priority: Record<string, number> = { red: 1, yellow: 2, green: 3, black: 4 };
    pending.sort(
      (a, b) => (priority[a.triageCategory] || 99) - (priority[b.triageCategory] || 99)
    );

    res.status(200).json({
      message: "Emergency queue retrieved",
      data: pending,
      count: pending.length,
    });
  } catch (error) {
    console.error("Error retrieving emergency queue:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Get emergency statistics
 */
export const getEmergencyStats = async (
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

    const [total, arrived, stabilized, admittedIpd, lama, dama, discharged, red, yellow, green, black] = await Promise.all([
      prisma.emergency.count({ where }),
      prisma.emergency.count({ where: { ...where, status: "arrived" } }),
      prisma.emergency.count({ where: { ...where, status: "stabilized" } }),
      prisma.emergency.count({ where: { ...where, status: "admitted-ipd" } }),
      prisma.emergency.count({ where: { ...where, status: "LAMA" } }),
      prisma.emergency.count({ where: { ...where, status: "DAMA" } }),
      prisma.emergency.count({ where: { ...where, status: "discharged" } }),
      prisma.emergency.count({ where: { ...where, triageCategory: "red" } }),
      prisma.emergency.count({ where: { ...where, triageCategory: "yellow" } }),
      prisma.emergency.count({ where: { ...where, triageCategory: "green" } }),
      prisma.emergency.count({ where: { ...where, triageCategory: "black" } }),
    ]);

    res.status(200).json({
      message: "Emergency statistics retrieved",
      data: {
        total,
        byStatus: { arrived, stabilized, admittedIpd, lama, dama, discharged },
        byTriage: { red, yellow, green, black },
      },
    });
  } catch (error) {
    console.error("Error fetching emergency stats:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

/**
 * Convert emergency case to IPD admission
 * Creates IPD admission record, carries forward vitals and investigations
 */
export const convertToIPD = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      wardId,
      bedId,
      admittingDoctorId,
      admittingDoctorName,
      admissionType = "emergency",
    } = req.body;

    // Validate required fields
    if (!wardId || !bedId || !admittingDoctorName) {
      res.status(400).json({
        message:
          "Missing required fields: wardId, bedId, admittingDoctorName",
      });
      return;
    }

    // Verify emergency case exists
    const emergency = await prisma.emergency.findUnique({
      where: { id: parseInt(id) },
    });

    if (!emergency) {
      res.status(404).json({ message: "Emergency case not found" });
      return;
    }

    // Convert emergency to IPD using the conversion helper
    const result = await convertEmergencyToIpd(
      emergency.id,
      wardId,
      bedId,
      admittingDoctorId || 0,
      admittingDoctorName,
      admissionType
    );

    res.status(201).json({
      message: "Emergency case converted to IPD admission",
      data: result,
    });
  } catch (error) {
    console.error("Error converting emergency to IPD:", error);
    res.status(500).json({
      message: "Error converting emergency case to IPD",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
