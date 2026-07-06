import prisma from '../../service/prisma-client';
import { pushIpdAdmission } from '../hmis-sync/hmis-client';
import { syncWithHmis } from '../hmis-sync/hmis-sync-wrapper';

/**
 * Convert OPD Appointment to IPD Admission
 * Carries forward patient details, prescriptions, and investigations
 */
export const convertOpdToIpd = async (
  appointmentId: number,
  wardId: string,
  bedId: string,
  admittingDoctorId: number,
  admittingDoctorName: string,
  admissionType: string = 'routine'
): Promise<any> => {
  try {
    // Fetch the OPD appointment.
    // NOTE on PRN sourcing: per the Sprint 4a Phase 1c going-forward rule
    // (docs/audits/patient-vs-patient-details.md), Appointment.patientId is
    // intentionally null and PRN lives on Appointment.prnNumber. The legacy
    // `patient: true` join almost always returns null. Read prnNumber off the
    // appointment row directly.
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: true,
      },
    });

    if (!appointment) {
      throw new Error(`Appointment ${appointmentId} not found`);
    }

    if (appointment.prnNumber == null) {
      throw new Error(
        `Appointment ${appointmentId} has no prnNumber; cannot convert to IPD without a patient identifier`
      );
    }

    const prnString = String(appointment.prnNumber);

    // Fetch any pending prescriptions from this OPD appointment
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const pendingPrescriptions = await prisma.prescription.findMany({
      where: {
        prn: prnString,
        prescribedDate: {
          gte: sevenDaysAgo.toISOString(), // Last 7 days
        },
      },
    });

    // Fetch pending investigations
    const pendingInvestigations = await prisma.investigationOrder.findMany({
      where: {
        prn: prnString,
      },
      include: {
        labTests: true,
        radiologyTests: true,
        packages: true,
      },
    });

    // Generate IPD Admission Number. IpdAdmission.id is a UUID so we can't
    // sort on it — order by admissionNo desc (zero-padded → lexical == numeric).
    const lastAdmission = await prisma.ipdAdmission.findFirst({
      where: { admissionNo: { startsWith: 'JMRH-IPD-' } },
      orderBy: { admissionNo: 'desc' },
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

    // Create IPD Admission
    const ipdAdmission = await prisma.ipdAdmission.create({
      data: {
        admissionNo,
        prn: prnString,
        admissionDate: new Date(),
        admissionTime: new Date().toLocaleTimeString(),
        admissionType,
        sourceModule: 'opd',
        referralOpdId: appointmentId.toString(),
        referringDoctor: appointment.doctor?.name,
        admittingDoctor: admittingDoctorName,
        department: appointment.doctor?.departmentName || 'General',
        wardId,
        bedId,
        roomType: 'general',
        diagnosis: `OPD Referral from ${appointment.doctor?.name || 'Doctor'}`,
        status: 'admitted',
      },
    });

    // Mark the bed as occupied
    await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'occupied' },
    });

    // Push to HMIS via the audit-wrapped pipeline.
    // Wrapper writes success AND failure audit logs automatically.
    const hmisPayload = {
      admissionNo,
      prn: prnString,
      admittingDoctor: admittingDoctorName,
      department: appointment.doctor?.departmentName || 'General',
      diagnosis: `OPD Referral from ${appointment.doctor?.name || 'Doctor'}`,
      sourceModule: 'opd',
      referralAppointmentId: appointmentId,
      admissionType,
    };
    await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'admission',
      action: 'admission_from_opd',
      payload: {
        admissionNo,
        prn: prnString,
        referralOpdId: appointmentId,
        admissionType,
      },
      operation: () => pushIpdAdmission(hmisPayload),
    });

    return {
      ipdAdmission,
      pendingPrescriptions,
      pendingInvestigations,
    };
  } catch (error) {
    console.error('Error converting OPD to IPD:', error);
    throw error;
  }
};
