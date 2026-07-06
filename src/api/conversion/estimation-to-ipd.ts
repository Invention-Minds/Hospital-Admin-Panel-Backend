import prisma from '../../service/prisma-client';

/**
 * Refer a confirmed Estimation for IPD admission (NABH WF-2 path).
 *
 * Mirrors `proposeFromOpd` — the doctor / estimation staff never pick a bed.
 * This:
 *   1. Creates an IpdAdmission in status='PROPOSED' (no ward/bed yet),
 *      sourceModule='estimation', referralEstimationId set.
 *   2. Raises an IpdBedRequest in status='REQUESTED' for the NS queue.
 *   3. Flips the admission to status='BED_REQUESTED'.
 *
 * Idempotent: if a non-cancelled admission already exists for this estimation,
 * it is returned as-is (so the UI can show "Referred ✓" rather than duplicate).
 */
export interface ProposeFromEstimationInput {
  estimationId: string;
  diagnosis: string;
  urgency?: 'routine' | 'urgent' | 'emergency';
  preferredBedType?: string;
  preferredWardId?: string;
  admissionType?: string;
  actorUsername?: string | null;
  actorId?: number | null;
}

export const proposeFromEstimation = async (input: ProposeFromEstimationInput) => {
  const est = await prisma.estimationDetails.findUnique({
    where: { estimationId: input.estimationId },
  });
  if (!est) {
    throw new Error(`Estimation ${input.estimationId} not found`);
  }

  // PRN lives on EstimationDetails.patientUHID (Int?). Without it we can't
  // create an admission tied to a patient.
  const prnString = est.patientUHID != null ? String(est.patientUHID) : '';
  if (!prnString) {
    throw new Error(
      `Cannot refer for admission: estimation ${input.estimationId} has no patient UHID. Attach the patient first.`,
    );
  }

  // Idempotency — one live admission per estimation.
  const existing = await prisma.ipdAdmission.findFirst({
    where: { referralEstimationId: input.estimationId, status: { not: 'cancelled' } },
    include: { bedRequests: true },
  });
  if (existing) {
    return { admission: existing, bedRequest: existing.bedRequests?.[0] ?? null, alreadyExisted: true };
  }

  // Generate next admission number (zero-padded → lexical == numeric sort).
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

  // Preferred room type: explicit input wins, else the estimation's roomType.
  const preferredBedType = input.preferredBedType || est.roomType || 'general';

  const admission = await prisma.ipdAdmission.create({
    data: {
      admissionNo,
      prn: prnString,
      admissionDate: new Date(),
      admissionTime: new Date().toLocaleTimeString(),
      admissionType: input.admissionType || 'elective',
      sourceModule: 'estimation',
      referralEstimationId: input.estimationId,
      referringDoctor: est.consultantName ?? null,
      admittingDoctor: est.consultantName || 'Consultant',
      department: 'General',
      // No wardId / bedId — assigned by NS at accept time.
      roomType: preferredBedType,
      diagnosis: input.diagnosis,
      status: 'PROPOSED',
      createdBy: input.actorUsername ?? null,
    },
  });

  const bedRequest = await prisma.ipdBedRequest.create({
    data: {
      admissionId: admission.id,
      wardId: input.preferredWardId ?? null,
      preferredBedType,
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

  return { admission, bedRequest, alreadyExisted: false };
};
