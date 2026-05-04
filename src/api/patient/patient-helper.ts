import { PrismaClient } from "@prisma/client";
import { pushPatient } from "../hmis-sync/hmis-client";
import { syncWithHmis } from "../hmis-sync/hmis-sync-wrapper";

const prisma = new PrismaClient();

/**
 * Generate unique PRN (Patient Registration Number)
 */
export const generatePRN = async (): Promise<number> => {
  try {
    const lastPatient = await prisma.patientDetails.findFirst({
      orderBy: { prn: "desc" },
    });

    const nextPRN = (lastPatient?.prn || 0) + 1;
    return nextPRN;
  } catch (error) {
    console.error("Error generating PRN:", error);
    throw error;
  }
};

/**
 * Push patient to HMIS with audit logging (wrapper-driven).
 * Non-blocking: HMIS failures are logged but do not propagate.
 */
export const syncPatientToHmis = async (patientData: {
  prn?: number | string | null;
  name?: string | null;
  dob?: string | null;
  gender?: string | null;
  mobileNo?: string | null;
  contactNo?: string | null;
  email?: string | null;
  address?: string | null;
  bloodGroup?: string | null;
}): Promise<void> => {
  const hmisPayload = {
    prn: patientData.prn,
    name: patientData.name,
    dob: patientData.dob,
    gender: patientData.gender,
    phoneNumber: patientData.mobileNo || patientData.contactNo,
    email: patientData.email,
    address: patientData.address,
    bloodGroup: patientData.bloodGroup,
  };

  await syncWithHmis({
    direction: "push",
    module: "patient",
    entityType: "patient",
    action: "create",
    payload: patientData,
    operation: () => pushPatient(hmisPayload),
  });
};

/**
 * Create or get patient with PRN sync
 */
export const createOrGetPatient = async (patientData: {
  prn?: number;
  name: string;
  mobileNo?: string;
  contactNo?: string;
  email?: string;
  age?: number | string;
  gender?: string;
  address?: string;
  bloodGroup?: string;
  dob?: string;
  country?: string;
  state?: string;
  district?: string;
  city?: string;
  area?: string;
  pin?: string;
  patientType?: string;
}) => {
  try {
    const existingPatient = await prisma.patientDetails.findFirst({
      where: {
        mobileNo: patientData.mobileNo || patientData.contactNo,
      },
    });

    if (existingPatient) {
      return existingPatient;
    }

    let prn = patientData.prn;
    if (!prn) {
      prn = await generatePRN();
    }

    const newPatient = await prisma.patientDetails.create({
      data: {
        prn,
        name: patientData.name,
        mobileNo: patientData.mobileNo,
        contactNo: patientData.contactNo,
        email: patientData.email,
        age: patientData.age?.toString(),
        gender: patientData.gender,
        address: patientData.address,
        bloodGroup: patientData.bloodGroup,
        dob: patientData.dob,
        country: patientData.country,
        state: patientData.state,
        district: patientData.district,
        city: patientData.city,
        area: patientData.area,
        pin: patientData.pin,
        patientType: patientData.patientType || "OPD",
      },
    });

    // Fire-and-forget; wrapper handles audit logging on both outcomes.
    void syncPatientToHmis(newPatient);

    return newPatient;
  } catch (error) {
    console.error("Error creating patient:", error);
    throw error;
  }
};

/**
 * Trigger HMIS sync for existing patients (batch operation)
 */
export const syncExistingPatientsToHmis = async (limit: number = 100) => {
  try {
    const patients = await prisma.patientDetails.findMany({
      take: limit,
      orderBy: { created_at: "desc" },
    });

    let successCount = 0;
    let failureCount = 0;

    for (const patient of patients) {
      try {
        await syncPatientToHmis(patient);
        successCount++;
      } catch (error) {
        console.error(`Failed to sync patient ${patient.prn}:`, error);
        failureCount++;
      }
    }

    return {
      message: `Synced ${successCount} patients to HMIS, ${failureCount} failed`,
      success: successCount,
      failed: failureCount,
    };
  } catch (error) {
    console.error("Error syncing patients:", error);
    throw error;
  }
};
