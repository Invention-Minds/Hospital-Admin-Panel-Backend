import prisma from '../../service/prisma-client';
import { pushIpdAdmission } from '../hmis-sync/hmis-client';
import { syncWithHmis } from '../hmis-sync/hmis-sync-wrapper';

/**
 * Convert Emergency Case to IPD Admission
 * Carries forward emergency assessments, vitals, and MLC case if applicable
 */
export const convertEmergencyToIpd = async (
  emergencyId: number,
  wardId: string,
  bedId: string,
  admittingDoctorId: number,
  admittingDoctorName: string,
  admissionType: string = 'emergency'
): Promise<any> => {
  try {
    // Fetch the Emergency case
    const emergency = await prisma.emergency.findUnique({
      where: { id: emergencyId },
      include: {
        mlcCase: true,
      },
    });

    if (!emergency) {
      throw new Error(`Emergency case ${emergencyId} not found`);
    }

    // Fetch any MLC case associated with this emergency
    const mlcCase = await prisma.mlcCase.findFirst({
      where: { emergencyId },
    });

    // Fetch any pending prescriptions from this emergency
    const pendingPrescriptions = await prisma.prescription.findMany({
      where: {
        prn: emergency.prn?.toString() || '',
      },
    });

    // Fetch pending investigations
    const pendingInvestigations = await prisma.investigationOrder.findMany({
      where: {
        prn: emergency.prn?.toString() || '',
      },
      include: {
        labTests: true,
        radiologyTests: true,
        packages: true,
      },
    });

    // Generate IPD Admission Number
    const lastAdmission = await prisma.ipdAdmission.findFirst({
      orderBy: { id: 'desc' },
      select: { admissionNo: true },
    });

    let nextAdmissionNumber = 1;
    if (lastAdmission?.admissionNo) {
      const match = lastAdmission.admissionNo.match(/IPD-(\d+)$/);
      if (match) {
        nextAdmissionNumber = parseInt(match[1]) + 1;
      }
    }
    const admissionNo = `JMRH-IPD-${String(nextAdmissionNumber).padStart(4, '0')}`;

    // Create IPD Admission with Emergency details
    const ipdAdmission = await prisma.ipdAdmission.create({
      data: {
        admissionNo,
        prn: emergency.prn?.toString() || '',
        admissionDate: new Date(),
        admissionTime: new Date().toLocaleTimeString(),
        admissionType, // 'emergency'
        sourceModule: 'emergency',
        referralEmergencyId: emergencyId.toString(),
        referralMlcId: mlcCase?.id?.toString(), // Link to MLC if it exists
        referringDoctor: emergency.hmisEmergencyId ? 'Emergency Department' : 'Self Referred',
        admittingDoctor: admittingDoctorName,
        department: 'General',
        wardId,
        bedId,
        roomType: emergency.triageCategory === 'red' ? 'ICU' : 'general',
        diagnosis: emergency.presentingComplaint || 'Emergency Admission',
        status: 'admitted',
      },
    });

    // Mark the bed as occupied
    await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'occupied' },
    });

    // Update Emergency status to mark it as admitted to IPD
    await prisma.emergency.update({
      where: { id: emergencyId },
      data: {
        status: 'admitted-ipd',
      },
    });

    // Push to HMIS via the audit-wrapped pipeline.
    const hmisPayload = {
      admissionNo,
      prn: emergency.prn,
      admittingDoctor: admittingDoctorName,
      department: 'Emergency Department',
      diagnosis: emergency.presentingComplaint || 'Emergency Admission',
      sourceModule: 'emergency',
      referralEmergencyId: emergencyId,
      referralMlcId: mlcCase?.id,
      admissionType,
      triageCategory: emergency.triageCategory,
      traumaScore: emergency.traumaScore,
    };
    await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'admission',
      action: 'admission_from_emergency',
      payload: {
        admissionNo,
        prn: emergency.prn,
        referralEmergencyId: emergencyId,
        referralMlcId: mlcCase?.id,
        admissionType,
      },
      operation: () => pushIpdAdmission(hmisPayload),
    });

    return {
      ipdAdmission,
      mlcCase,
      pendingPrescriptions,
      pendingInvestigations,
    };
  } catch (error) {
    console.error('Error converting Emergency to IPD:', error);
    throw error;
  }
};
