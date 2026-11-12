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
 * Fill in the registered patient's mobile from an appointment, but only when
 * the record has NO number on file. Never overwrites: mobileNo/contactNo is
 * where the WhatsApp bot sends the record-access OTP (record-access.service
 * getRegisteredNumber), so replacing a number would hand records to whoever
 * typed it. Call only from staff-authenticated flows (check-in), never from
 * public website / bot bookings.
 *
 * Returns the 10-digit number written, or null when nothing changed (unknown
 * PRN, number already on file, or the appointment phone isn't 10 digits).
 */
export const backfillPatientPhone = async (
  prn: number,
  phone: string | null | undefined,
): Promise<string | null> => {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;

  const patient = await prisma.patientDetails.findUnique({
    where: { prn },
    select: { id: true, mobileNo: true, contactNo: true },
  });
  if (!patient) return null;

  const hasNumber = (v: string | null) => (v ?? "").replace(/\D/g, "").length > 0;
  if (hasNumber(patient.mobileNo) || hasNumber(patient.contactNo)) return null;

  // Conditional write so a concurrent edit that just added a number wins.
  const result = await prisma.patientDetails.updateMany({
    where: {
      id: patient.id,
      OR: [{ mobileNo: null }, { mobileNo: "" }],
      AND: [{ OR: [{ contactNo: null }, { contactNo: "" }] }],
    },
    data: { mobileNo: digits },
  });
  return result.count > 0 ? digits : null;
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
