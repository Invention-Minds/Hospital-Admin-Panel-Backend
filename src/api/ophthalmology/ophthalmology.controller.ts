import { Request, Response } from "express";
import { PrismaClient } from '@prisma/client';
import { auditLog } from '../../service/app-audit';

const prisma = new PrismaClient();

// ─── Optometrist work-up ↔ doctor verification ───────────────────────
//
// An optometrist records the refraction work-up before the consult. Those
// values are PROVISIONAL until the doctor verifies them — a mis-entry must
// never silently become the doctor's signed word. The optometrist may write
// ONLY the fields below; everything else (examination, diagram, diagnosis,
// advice) stays doctor-owned and is rejected server-side, not just hidden
// in the UI.
const WORKUP_FIELDS = [
  // Visual acuity
  'uaVr', 'uaVl', 'glVr', 'glVl', 'nearVr', 'nearVl',
  // Current glass power (+ ADD)
  'curSphR', 'curCylR', 'curAxisR', 'curVAR',
  'curSphL', 'curCylL', 'curAxisL', 'curVAL',
  'curAdd', 'curIPD', 'curType',
  'curAddSphR', 'curAddCylR', 'curAddAxisR', 'curAddVAR',
  'curAddSphL', 'curAddCylL', 'curAddAxisL', 'curAddVAL',
  // Auto refraction — before dilation
  'arSphR', 'arCylR', 'arAxisR', 'arVAR',
  'arSphL', 'arCylL', 'arAxisL', 'arVAL', 'arIPD',
  // Auto refraction — after dilation (cycloplegic)
  'arDilSphR', 'arDilCylR', 'arDilAxisR', 'arDilVAR',
  'arDilSphL', 'arDilCylL', 'arDilAxisL', 'arDilVAL', 'arDilIPD',
  // Subjective refraction (+ ADD)
  'srSphR', 'srCylR', 'srAxisR', 'srVAR',
  'srSphL', 'srCylL', 'srAxisL', 'srVAL', 'srIPD', 'srType',
  'srAddSphR', 'srAddCylR', 'srAddAxisR', 'srAddVAR',
  'srAddSphL', 'srAddCylL', 'srAddAxisL', 'srAddVAL',
  // IOP / NCT
  'iopR', 'iopL', 'includeIOP',
] as const;

// Provenance columns the server owns outright. A client that posts these on
// the generic save path is ignored — otherwise an optometrist could mark
// their own work-up "verified by doctor".
const SERVER_OWNED_FIELDS = [
  'workupStatus', 'recordedBy', 'recordedById', 'recordedAt',
  'verifiedBy', 'verifiedById', 'verifiedAt', 'workupSnapshot',
];

interface Actor {
  userId: number | null;
  username: string | null;
  role: string | null;
  subAdminType: string | null;
  doctorId: number | null;
}

/** Resolve the caller's role from the DB — the JWT only carries id/username. */
async function resolveActor(req: Request): Promise<Actor> {
  const userId = typeof req.user?.id === 'number' ? req.user.id : null;
  if (userId == null) {
    return { userId: null, username: null, role: null, subAdminType: null, doctorId: null };
  }
  const [user, doctor] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, fullName: true, role: true, subAdminType: true },
    }),
    prisma.doctor.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return {
    userId,
    username: user?.fullName || user?.username || req.user?.username || null,
    role: user?.role ?? null,
    subAdminType: user?.subAdminType ?? null,
    doctorId: doctor?.id ?? null,
  };
}

const isOptometrist = (a: Actor): boolean =>
  (a.subAdminType || '').toLowerCase() === 'optometrist';

/** Doctors verify. Admins may verify too (they cover for edge cases). */
const canVerify = (a: Actor): boolean =>
  a.doctorId != null || a.role === 'super_admin' || a.role === 'admin';

/** Keep only the optometrist-writable keys from an incoming payload. */
function pickWorkupFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of WORKUP_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// Create or Update Ophthalmology Prescription
export const saveOphthalmologyPrescription = async (req: Request, res: Response) => {
  try {
    const {
      diagramMarks,
      vfData,
      eomData,
      gonioData,
      ...presData
    } = req.body;

    // Provenance is server-owned — never take it from the client, or an
    // optometrist could self-verify their own work-up.
    for (const f of SERVER_OWNED_FIELDS) delete presData[f];

    presData.diagramImage = presData.diagramImage || null;
    presData.diagnosisList = presData.diagnosisList || "[]";

    presData.vfData = vfData ? JSON.stringify(vfData) : null;
    presData.eomData = eomData ? JSON.stringify(eomData) : null;
    presData.gonioData = gonioData ? JSON.stringify(gonioData) : null;

    let prescription;
    const isNew = !presData.prescriptionId;

    if (!presData.prescriptionId) {
      presData.prescriptionId = "OPH-" + Date.now();

      prescription = await prisma.ophthalmologyPrescription.create({
        data: presData
      });
    } else {
      // If the doctor changes a work-up value on an already-verified record,
      // the record must stop claiming it matches what was verified.
      const prior = await prisma.ophthalmologyPrescription.findUnique({
        where: { prescriptionId: presData.prescriptionId },
      });
      if (prior?.workupSnapshot && (prior.workupStatus === 'verified' || prior.workupStatus === 'amended')) {
        let snapshot: Record<string, unknown> | null = null;
        try { snapshot = JSON.parse(prior.workupSnapshot); } catch { snapshot = null; }
        const merged = { ...(prior as unknown as Record<string, unknown>), ...presData };
        if (changedSinceWorkup(snapshot, merged).length) presData.workupStatus = 'amended';
      }

      prescription = await prisma.ophthalmologyPrescription.update({
        where: { prescriptionId: presData.prescriptionId },
        data: presData
      });

      // 🔥 Remove old diagram marks
      await prisma.ophthalmologyDiagramMark.deleteMany({
        where: { prescriptionId: presData.prescriptionId }
      });
    }

    // 🔥 Save diagram marks
    if (Array.isArray(diagramMarks)) {
      await prisma.ophthalmologyDiagramMark.createMany({
        data: diagramMarks.map(m => ({
          ...m,
          prescriptionId: prescription.prescriptionId
        }))
      });
    }

    await auditLog(req, {
      module: 'ophthalmology',
      action: isNew ? 'CREATE' : 'UPDATE',
      entityType: 'OphthalmologyPrescription',
      entityId: prescription.prescriptionId,
      payload: { prn: prescription.prn, appointmentId: prescription.appointmentId },
    });

    res.json({ success: true, prescription });

  } catch (err) {
    console.error('[ophthalmology] saveOphthalmologyPrescription failed:', err);
    res.status(500).json({ success: false, error: "Save failed" });
  }
};



// Get prescription by appointment
export const getPrescriptionByAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;

    const prescription = await prisma.ophthalmologyPrescription.findFirst({
      where: { appointmentId: Number(appointmentId) },
      include: { diagramMarks: true }
    });

    res.json({ success: true, prescription });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch prescription" });
  }
};

// Get prescription history for patient
export const getPatientEyeHistory = async (req: Request, res: Response) => {
  try {
    const { prn } = req.params;

    const prescriptions = await prisma.ophthalmologyPrescription.findMany({
      where: { prn: Number(prn) },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, prescriptions });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch patient history" });
  }
};

// Delete prescription
export const deleteOphthalmologyPrescription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await prisma.ophthalmologyPrescription.delete({
      where: { id: Number(id) },
    });

    await auditLog(req, {
      module: 'ophthalmology',
      action: 'DELETE',
      entityType: 'OphthalmologyPrescription',
      entityId: deleted.prescriptionId,
      payload: { prn: deleted.prn },
    });

    res.json({ success: true, message: "Prescription deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to delete prescription" });
  }
};


// Add a new option (e.g. new cornea option)
export const addExamOption = async (req: Request, res: Response) => {
  try {
    const { fieldName, optionLabel, departmentId, createdBy } = req.body;

    const exists = await prisma.ophthalmologyExaminationOption.findFirst({
      where: { fieldName, optionLabel },
    });

    if (exists) {
      res.json({ success: false, message: "Option already exists" });
      return
    }

    const option = await prisma.ophthalmologyExaminationOption.create({
      data: { fieldName, optionLabel, departmentId, createdBy },
    });

    res.json({ success: true, option });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to add option" });
  }
};

// Get options for a specific field
export const getExamOptions = async (req: Request, res: Response) => {
  try {
    const { fieldName } = req.params;

    const options = await prisma.ophthalmologyExaminationOption.findMany({
      where: { fieldName },
      orderBy: { optionLabel: "asc" },
    });

    res.json({ success: true, options });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch options" });
  }
};

// ─── Optometrist queue ────────────────────────────────────────────────
//
// Today's ophthalmology appointments with the work-up status of each, so the
// optometrist sees at a glance who still needs a refraction.
export const getOptometryQueue = async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const appointments = await prisma.appointment.findMany({
      where: {
        date,
        OR: [
          { department: { contains: 'ophthalm' } },
          { department: { contains: 'opthalm' } }, // common misspelling in dept masters
        ],
      },
      orderBy: [{ time: 'asc' }],
      select: {
        id: true, patientName: true, prnNumber: true, age: true, gender: true,
        doctorName: true, doctorId: true, department: true, date: true, time: true,
        status: true, checkedIn: true,
      },
    });

    // One query for every work-up on the board, then stitch — avoids N+1.
    const prescriptions = await prisma.ophthalmologyPrescription.findMany({
      where: { appointmentId: { in: appointments.map((a) => a.id) } },
      select: {
        appointmentId: true, prescriptionId: true, workupStatus: true,
        recordedBy: true, recordedAt: true, verifiedBy: true, verifiedAt: true,
      },
    });
    const byAppointment = new Map(prescriptions.map((p) => [p.appointmentId, p]));

    const rows = appointments.map((a) => ({
      ...a,
      workup: byAppointment.get(a.id) ?? null,
      workupStatus: byAppointment.get(a.id)?.workupStatus ?? 'pending',
    }));

    res.json({ success: true, date, rows });
  } catch (err) {
    console.error('[ophthalmology] getOptometryQueue failed:', err);
    res.status(500).json({ success: false, error: "Failed to load optometry queue" });
  }
};

/** Keys whose current value differs from what the optometrist submitted. */
function changedSinceWorkup(
  snapshot: Record<string, unknown> | null,
  current: Record<string, unknown>,
): string[] {
  if (!snapshot) return [];
  const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return WORKUP_FIELDS.filter((k) => norm(snapshot[k]) !== norm(current[k]));
}

// Optometrist submits the refraction work-up. Writes ONLY the work-up fields;
// anything else in the payload is discarded rather than trusted.
export const submitWorkup = async (req: Request, res: Response) => {
  try {
    const actor = await resolveActor(req);
    if (!isOptometrist(actor) && actor.role !== 'super_admin') {
      res.status(403).json({ success: false, error: "Only an optometrist can submit a work-up" });
      return;
    }

    const appointmentId = Number(req.body.appointmentId);
    if (!appointmentId || Number.isNaN(appointmentId)) {
      res.status(400).json({ success: false, error: "appointmentId is required" });
      return;
    }

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) {
      res.status(404).json({ success: false, error: "Appointment not found" });
      return;
    }

    const workup = pickWorkupFields(req.body);
    const existing = await prisma.ophthalmologyPrescription.findFirst({
      where: { appointmentId },
    });

    // Once the doctor has signed off, the work-up is closed to the optometrist.
    if (existing && (existing.workupStatus === 'verified' || existing.workupStatus === 'amended')) {
      res.status(409).json({
        success: false,
        error: "This work-up has already been verified by the doctor and can no longer be edited",
      });
      return;
    }

    const provenance = {
      workupStatus: 'submitted',
      recordedBy: actor.username,
      recordedById: actor.userId,
      recordedAt: new Date(),
      // Snapshot is what the DOCTOR will be diffed against — always the
      // optometrist's latest submission.
      workupSnapshot: JSON.stringify(workup),
    };

    let prescription;
    if (existing) {
      prescription = await prisma.ophthalmologyPrescription.update({
        where: { prescriptionId: existing.prescriptionId },
        data: { ...workup, ...provenance },
      });
    } else {
      prescription = await prisma.ophthalmologyPrescription.create({
        data: {
          ...workup,
          ...provenance,
          prescriptionId: "OPH-" + Date.now(),
          appointmentId,
          doctorId: appointment.doctorId ?? null,
          prn: appointment.prnNumber ?? 0,
          patientName: appointment.patientName,
          patientAge: appointment.age ?? null,
          patientGender: appointment.gender ?? null,
        },
      });
    }

    await auditLog(req, {
      module: 'ophthalmology',
      action: 'UPDATE',
      entityType: 'OphthalmologyPrescription',
      entityId: prescription.prescriptionId,
      payload: { workup: 'submitted', appointmentId, by: actor.username },
      notes: 'Optometrist work-up submitted',
    });

    res.json({ success: true, prescription });
  } catch (err) {
    console.error('[ophthalmology] submitWorkup failed:', err);
    res.status(500).json({ success: false, error: "Failed to submit work-up" });
  }
};

// Doctor verifies the work-up. Status becomes `verified` when the values are
// unchanged, `amended` when the doctor corrected something — and the changed
// field list is recorded in the audit trail either way.
export const verifyWorkup = async (req: Request, res: Response) => {
  try {
    const actor = await resolveActor(req);
    if (!canVerify(actor)) {
      res.status(403).json({ success: false, error: "Only the doctor can verify a work-up" });
      return;
    }

    const { prescriptionId } = req.params;
    const existing = await prisma.ophthalmologyPrescription.findUnique({
      where: { prescriptionId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: "Prescription not found" });
      return;
    }
    if (!existing.recordedAt) {
      res.status(400).json({ success: false, error: "There is no optometrist work-up to verify" });
      return;
    }

    let snapshot: Record<string, unknown> | null = null;
    try {
      snapshot = existing.workupSnapshot ? JSON.parse(existing.workupSnapshot) : null;
    } catch {
      snapshot = null;
    }
    const changed = changedSinceWorkup(snapshot, existing as unknown as Record<string, unknown>);

    const prescription = await prisma.ophthalmologyPrescription.update({
      where: { prescriptionId },
      data: {
        workupStatus: changed.length ? 'amended' : 'verified',
        verifiedBy: actor.username,
        verifiedById: actor.userId,
        verifiedAt: new Date(),
      },
    });

    await auditLog(req, {
      module: 'ophthalmology',
      action: 'STATUS_CHANGE',
      entityType: 'OphthalmologyPrescription',
      entityId: prescriptionId,
      payload: {
        workupStatus: prescription.workupStatus,
        recordedBy: existing.recordedBy,
        verifiedBy: actor.username,
        changedFields: changed,
      },
      notes: changed.length
        ? `Doctor amended ${changed.length} optometrist value(s) before verifying`
        : 'Doctor verified the optometrist work-up unchanged',
    });

    res.json({ success: true, prescription, changedFields: changed });
  } catch (err) {
    console.error('[ophthalmology] verifyWorkup failed:', err);
    res.status(500).json({ success: false, error: "Failed to verify work-up" });
  }
};

// ─── In-OPD drop administration (dilation / anaesthetic drops) ────────
//
// One row per instillation. Append-only by design: a mis-entry is corrected
// with a follow-up remark, never a silent edit, so the administration trail
// stays intact for NABH medication-administration evidence.

const VALID_EYES = ['OD', 'OS', 'OU'];

export const logDropAdministration = async (req: Request, res: Response) => {
  try {
    const { prn, appointmentId, prescriptionId, drugName, eye, dropCount, purpose, remarks } = req.body;

    if (!prn || Number.isNaN(Number(prn))) {
      res.status(400).json({ success: false, error: "prn is required" });
      return;
    }
    if (!drugName || typeof drugName !== 'string' || !drugName.trim()) {
      res.status(400).json({ success: false, error: "drugName is required" });
      return;
    }
    if (!eye || !VALID_EYES.includes(eye)) {
      res.status(400).json({ success: false, error: `eye must be one of: ${VALID_EYES.join(', ')}` });
      return;
    }

    const record = await prisma.ophthalmologyDropAdministration.create({
      data: {
        prn: Number(prn),
        appointmentId: appointmentId != null ? Number(appointmentId) : null,
        prescriptionId: prescriptionId || null,
        drugName: drugName.trim(),
        eye,
        dropCount: dropCount != null ? Number(dropCount) : 1,
        purpose: purpose || null,
        remarks: remarks || null,
        // Never trusted from the client — taken from the authenticated user.
        instilledBy: req.user?.username ?? null,
        instilledById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });

    await auditLog(req, {
      module: 'ophthalmology',
      action: 'CREATE',
      entityType: 'OphthalmologyDropAdministration',
      entityId: record.id,
      payload: { prn: record.prn, drugName: record.drugName, eye: record.eye },
    });

    res.json({ success: true, record });
  } catch (err) {
    console.error('[ophthalmology] logDropAdministration failed:', err);
    res.status(500).json({ success: false, error: "Failed to log drop administration" });
  }
};

// Drops instilled during one visit — drives the on-screen list + dilation timer.
export const getDropsByAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;

    const records = await prisma.ophthalmologyDropAdministration.findMany({
      where: { appointmentId: Number(appointmentId) },
      orderBy: { instilledAt: "asc" },
    });

    res.json({ success: true, records });
  } catch (err) {
    console.error('[ophthalmology] getDropsByAppointment failed:', err);
    res.status(500).json({ success: false, error: "Failed to fetch drops" });
  }
};
