import prisma from '../../service/prisma-client';

/**
 * Phase 3 — WF-2 NABH-compliant referral path.
 *
 * Unlike the legacy `convertOpdToIpd` (which jumps straight to status='admitted'),
 * this helper:
 *   1. Creates an IpdAdmission in status='PROPOSED' (no ward/bed yet).
 *   2. Raises an IpdBedRequest in status='REQUESTED' for the NS queue.
 *   3. Flips the admission to status='BED_REQUESTED'.
 *
 * The bed-request then walks through the WF-2 handshake:
 *   REQUESTED → ACCEPTED (NS) → CLOSED (attender bedside acceptance)
 * and only at the final step does the admission flip to 'admitted'.
 */
export interface ProposeFromOpdInput {
  appointmentId: number;
  diagnosis: string;
  urgency?: 'routine' | 'urgent' | 'emergency';
  preferredBedType?: string;
  preferredWardId?: string;
  admittingDoctorId?: number | null;
  admittingDoctorName: string;
  admissionType?: string;
  actorUsername?: string | null;
  actorId?: number | null;
}

export const proposeFromOpd = async (input: ProposeFromOpdInput) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { doctor: true, patient: true },
  });
  if (!appointment) {
    throw new Error(`Appointment ${input.appointmentId} not found`);
  }

  // Generate next admission number. IpdAdmission.id is a UUID, so ordering by
  // id is meaningless — order by admissionNo descending instead (zero-padded
  // format `JMRH-IPD-0001` makes lexical sort identical to numeric sort).
  const lastAdmission = await prisma.ipdAdmission.findFirst({
    where: { admissionNo: { startsWith: 'JMRH-IPD-' } },
    orderBy: { admissionNo: 'desc' },
    select: { admissionNo: true },
  });
  let nextNumber = 1;
  if (lastAdmission?.admissionNo) {
    const m = lastAdmission.admissionNo.match(/IPD-(\d+)$/);
    if (m) nextNumber = parseInt(m[1], 10) + 1;
  }
  const admissionNo = `JMRH-IPD-${String(nextNumber).padStart(4, '0')}`;

  // PRN sources, in order of preference:
  //   1. appointment.prnNumber          — snapshotted on the appointment row
  //   2. appointment.patient?.prn       — joined patient row (legacy fallback)
  //   3. ''                             — last-resort empty (won't pass schema reqd)
  const prnFromAppt =
    typeof appointment.prnNumber === 'number' ? appointment.prnNumber.toString() : null;
  const prnFromPatient =
    typeof appointment.patient?.prn === 'number' ? appointment.patient.prn.toString() : null;
  const prnString = prnFromAppt ?? prnFromPatient ?? '';
  if (!prnString) {
    throw new Error(
      `Cannot refer for admission: appointment ${input.appointmentId} has no PRN linked. Ask reception to attach the patient first.`,
    );
  }

  const admission = await prisma.ipdAdmission.create({
    data: {
      admissionNo,
      prn: prnString,
      admissionDate: new Date(),
      admissionTime: new Date().toLocaleTimeString(),
      admissionType: input.admissionType || 'routine',
      sourceModule: 'opd',
      referralOpdId: input.appointmentId.toString(),
      referringDoctor: appointment.doctor?.name,
      admittingDoctor: input.admittingDoctorName,
      department: appointment.doctor?.departmentName || 'General',
      // No wardId / bedId yet — they get assigned by NS at accept time.
      roomType: input.preferredBedType || 'general',
      diagnosis: input.diagnosis,
      status: 'PROPOSED',
      createdBy: input.actorUsername ?? null,
    },
  });

  const bedRequest = await prisma.ipdBedRequest.create({
    data: {
      admissionId: admission.id,
      wardId: input.preferredWardId ?? null,
      preferredBedType: input.preferredBedType ?? null,
      urgency: input.urgency || 'routine',
      status: 'REQUESTED',
      requestedBy: input.actorUsername ?? null,
      requestedById: input.actorId ?? null,
    },
  });

  await prisma.ipdAdmission.update({
    where: { id: admission.id },
    data: { status: 'BED_REQUESTED', updatedBy: input.actorUsername ?? null },
  });

  return { admission, bedRequest };
};
