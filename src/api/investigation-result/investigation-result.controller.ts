import type { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../service/prisma-client';
import bucket from '../../config/googeCloudStorage';
import { auditLog } from '../../service/app-audit';

// Phase 9.11 — Lab & Radiology results / report attachment.
//
// Backs the demo workflow:
//   Lab/Radiology coordinator opens /lab-radiology/reports → sees pending
//   InvestigationOrders → uploads the report PDF + structured metadata →
//   the result row is created → doctor gets a Notification → the result
//   surfaces on the patient profile "Reports" tab AND on the IPD
//   admission "Reports" tab.
//
// Same model also accepts third-party HMIS feed payloads in Phase B via
// the /webhook/:provider entry point (see investigation-result.webhook.ts).
// `hmisResultId` is the dedup key.

interface ResultBody {
  orderId?: number;
  testName?: string;
  department?: 'lab' | 'radiology';
  result?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  findings?: string | null;
  impression?: string | null;
  criticalFlag?: boolean;
  status?: 'pending' | 'partial' | 'final';
  reportedAt?: string | null;
}

const VALID_DEPARTMENTS = ['lab', 'radiology'] as const;
const VALID_STATUS = ['pending', 'partial', 'final'] as const;

// ─── Helpers ───────────────────────────────────────────────────────────

const safeNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const uploadToGcs = async (
  file: Express.Multer.File,
): Promise<{ url: string; mimeType: string; sha256: string }> => {
  const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
  const datePath = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const objectName = `reports/${datePath}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
  const blob = bucket.file(objectName);
  const stream = blob.createWriteStream({ resumable: false, contentType: file.mimetype });
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', () => resolve());
    stream.end(file.buffer);
  });
  return {
    url: `https://storage.googleapis.com/${bucket.name}/${objectName}`,
    mimeType: file.mimetype || 'application/pdf',
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
};

// Push a Notification row so the ordering doctor sees the result in their bell.
//
// Phase 6 / Concern #3 — clinical-safety fix:
//   1. Notification.userId must be User.id, not Doctor.id. Look up doctor.userId.
//      If null, log a warning and create the bell with userId=null + targetRole='doctor'
//      so it surfaces in any doctor's role-targeted feed even if not user-targeted.
//   2. Only fire on `status === 'final'` — pending/partial drafts shouldn't
//      ping the doctor (the upstream caller now passes resultStatus).
//   3. Enrich the message: include patient name, value, unit, ref range.
const notifyDoctorOfResult = async (params: {
  doctorId: number;
  resultId: number;
  testName: string;
  isCritical: boolean;
  prn: string;
  patientName?: string | null;
  value?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  resultStatus?: string;
}): Promise<void> => {
  try {
    // Skip non-final results — only ping on the final report.
    if (params.resultStatus && params.resultStatus !== 'final') return;

    const doctor = await prisma.doctor.findUnique({
      where: { id: params.doctorId },
      select: { userId: true, name: true },
    });
    if (!doctor) {
      console.warn('[investigation-result] notify skipped — Doctor not found id=' + params.doctorId);
      return;
    }
    if (!doctor.userId) {
      console.warn('[investigation-result] notify: Doctor.userId is NULL for ' + (doctor.name ?? params.doctorId) + ' — bell will be role-only');
    }

    const patientPart = params.patientName ? params.patientName + ' (PRN ' + params.prn + ')' : 'PRN ' + params.prn;
    const valuePart = params.value
      ? ' · value=' + params.value + (params.unit ? ' ' + params.unit : '') + (params.referenceRange ? ' (ref ' + params.referenceRange + ')' : '')
      : '';
    const actionVerb = params.isCritical ? 'ACKNOWLEDGE NOW' : 'Review';

    await prisma.notification.create({
      data: {
        type: 'report_arrived',
        title: (params.isCritical ? 'CRITICAL: ' : '') + params.testName + ' — ' + (params.patientName ?? 'PRN ' + params.prn),
        message: actionVerb + ' · ' + patientPart + valuePart,
        status: 'unread',
        entityType: 'InvestigationResult',
        entityId: params.resultId,
        isCritical: params.isCritical,
        targetRole: 'doctor',
        userId: doctor.userId ?? undefined,
      },
    });
  } catch (e) {
    // Don't fail the upload because notification couldn't be created.
    console.warn('[investigation-result] notification create failed:', (e as Error).message);
  }
};

// ─── Upload (manual create) ────────────────────────────────────────────

export const uploadResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    const body = (req.body ?? {}) as ResultBody;

    const orderId = safeNum(body.orderId);
    if (!orderId) { res.status(400).json({ message: 'orderId is required' }); return; }
    if (!body.testName?.trim()) { res.status(400).json({ message: 'testName is required' }); return; }
    if (!body.department || !VALID_DEPARTMENTS.includes(body.department)) {
      res.status(400).json({ message: `department must be one of: ${VALID_DEPARTMENTS.join(', ')}` });
      return;
    }
    if (!body.status || !VALID_STATUS.includes(body.status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUS.join(', ')}` });
      return;
    }

    const order = await prisma.investigationOrder.findUnique({
      where: { id: orderId },
      select: { id: true, prn: true, doctorId: true, doctorName: true },
    });
    if (!order) { res.status(404).json({ message: 'InvestigationOrder not found' }); return; }

    let reportUrl: string | null = null;
    if (file) {
      const up = await uploadToGcs(file);
      reportUrl = up.url;
    }

    const reportedAt = parseDate(body.reportedAt) ?? new Date();

    const row = await prisma.investigationResult.create({
      data: {
        orderId,
        prn: order.prn,
        testName: body.testName.trim(),
        department: body.department,
        result: body.result ?? null,
        unit: body.unit ?? null,
        referenceRange: body.referenceRange ?? null,
        findings: body.findings ?? null,
        impression: body.impression ?? null,
        criticalFlag: !!body.criticalFlag,
        reportUrl,
        reportedAt,
        status: body.status,
        uploadedBy: req.user?.username ?? null,
        uploadedById: typeof req.user?.id === 'number' ? req.user.id : null,
        uploadedAt: new Date(),
      },
    });

    // Look up patient name for the richer bell payload (best-effort).
    let patientName: string | null = null;
    try {
      const prnNum = Number(row.prn);
      if (Number.isFinite(prnNum)) {
        const patient = await prisma.patientDetails.findUnique({
          where: { prn: prnNum },
          select: { name: true },
        });
        patientName = patient?.name ?? null;
      }
    } catch { /* not fatal */ }

    await notifyDoctorOfResult({
      doctorId: order.doctorId,
      resultId: row.id,
      testName: row.testName,
      isCritical: row.criticalFlag,
      prn: row.prn,
      patientName,
      value: body.result ?? null,
      unit: body.unit ?? null,
      referenceRange: body.referenceRange ?? null,
      resultStatus: body.status,
    });

    await auditLog(req, {
      module: 'lab-radiology',
      action: 'UPLOAD_RESULT',
      entityType: 'InvestigationResult',
      entityId: String(row.id),
      payload: { orderId, testName: row.testName, department: row.department, status: row.status, critical: row.criticalFlag },
    });

    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[investigation-result] upload failed:', error);
    res.status(500).json({ message: 'Failed to upload result' });
  }
};

// ─── List by PRN (patient profile timeline) ────────────────────────────

export const listByPrn = async (req: Request, res: Response): Promise<void> => {
  try {
    const prn = req.params.prn?.trim();
    if (!prn) { res.status(400).json({ message: 'prn is required' }); return; }
    const department = req.query.department as string | undefined;
    const status = req.query.status as string | undefined;
    const from = parseDate(req.query.from as string | undefined);
    const to = parseDate(req.query.to as string | undefined);

    const rows = await prisma.investigationResult.findMany({
      where: {
        prn,
        isDeleted: false,
        ...(department && { department }),
        ...(status && { status }),
        ...((from || to) && {
          createdAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        }),
      },
      include: {
        order: { select: { id: true, doctorId: true, doctorName: true, date: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[investigation-result] listByPrn failed:', error);
    res.status(500).json({ message: 'Failed to list results' });
  }
};

// ─── List by admission (IPD-scoped, date-bounded) ──────────────────────

export const listByAdmission = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    if (!admissionId) { res.status(400).json({ message: 'admissionId is required' }); return; }

    const admission = await prisma.ipdAdmission.findUnique({
      where: { id: admissionId },
      select: { id: true, prn: true, admissionDate: true, status: true },
    });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    // If the admission has a discharge row, bound the result window by it.
    // Otherwise (still admitted) — use now() as the upper bound.
    const discharge = await prisma.ipdDischarge.findFirst({
      where: { admissionId },
      orderBy: { dischargeDate: 'desc' },
      select: { dischargeDate: true },
    });
    const upper = discharge?.dischargeDate ?? new Date();

    const rows = await prisma.investigationResult.findMany({
      where: {
        prn: admission.prn,
        isDeleted: false,
        createdAt: { gte: admission.admissionDate, lte: upper },
      },
      include: {
        order: { select: { id: true, doctorId: true, doctorName: true, date: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    res.status(200).json({ data: rows, window: { from: admission.admissionDate, to: upper } });
  } catch (error) {
    console.error('[investigation-result] listByAdmission failed:', error);
    res.status(500).json({ message: 'Failed to list admission results' });
  }
};

// ─── List by order (doctor's view from a specific order) ───────────────

export const listByOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(orderId)) { res.status(400).json({ message: 'Invalid orderId' }); return; }
    const rows = await prisma.investigationResult.findMany({
      where: { orderId, isDeleted: false },
      orderBy: [{ createdAt: 'asc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[investigation-result] listByOrder failed:', error);
    res.status(500).json({ message: 'Failed to list order results' });
  }
};

// ─── Pending-orders worklist (Reports admin page) ──────────────────────

// Returns InvestigationOrders that have at least one lab/radiology test and
// no FINAL result attached yet. Used by the lab/radiology coordinator's
// /lab-radiology/reports page to find what's still owed.
export const pendingOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const department = req.query.department as string | undefined;
    const days = Number(req.query.days ?? '14');
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - (Number.isFinite(days) ? days : 14));

    const orders = await prisma.investigationOrder.findMany({
      where: {
        createdAt: { gte: sinceDate },
        ...(department === 'lab' && { labTests: { some: {} } }),
        ...(department === 'radiology' && { radiologyTests: { some: {} } }),
      },
      include: {
        labTests: { select: { id: true, description: true, department: true } },
        radiologyTests: { select: { id: true, description: true, department: true } },
        results: {
          where: { isDeleted: false },
          select: { id: true, testName: true, department: true, status: true, createdAt: true, criticalFlag: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    // Compute "pending" flag = order has any test (lab or radiology) where
    // no result with that testName + final status exists yet.
    const enriched = orders.map((o) => {
      const finalNames = new Set(
        o.results.filter((r) => r.status === 'final').map((r) => r.testName.toLowerCase().trim()),
      );
      const expectedLab = o.labTests.map((t) => ({ name: t.description, dept: 'lab' as const }));
      const expectedRad = o.radiologyTests.map((t) => ({ name: t.description, dept: 'radiology' as const }));
      const expected = [...expectedLab, ...expectedRad];
      const pending = expected.filter((e) => !finalNames.has(e.name.toLowerCase().trim()));
      return {
        ...o,
        pendingTests: pending,
        isComplete: pending.length === 0,
      };
    });

    res.status(200).json({ data: enriched });
  } catch (error) {
    console.error('[investigation-result] pendingOrders failed:', error);
    res.status(500).json({ message: 'Failed to list pending orders' });
  }
};

// ─── Get single result ─────────────────────────────────────────────────

export const getResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const row = await prisma.investigationResult.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, doctorId: true, doctorName: true, date: true, remarks: true } },
      },
    });
    if (!row || row.isDeleted) { res.status(404).json({ message: 'Result not found' }); return; }
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[investigation-result] getResult failed:', error);
    res.status(500).json({ message: 'Failed to fetch result' });
  }
};

// ─── Update (re-upload file or edit metadata) ──────────────────────────

export const updateResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.investigationResult.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) { res.status(404).json({ message: 'Result not found' }); return; }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    const body = (req.body ?? {}) as ResultBody;

    let reportUrl: string | undefined;
    if (file) {
      const up = await uploadToGcs(file);
      reportUrl = up.url;
    }

    if (body.department && !VALID_DEPARTMENTS.includes(body.department)) {
      res.status(400).json({ message: `department must be one of: ${VALID_DEPARTMENTS.join(', ')}` });
      return;
    }
    if (body.status && !VALID_STATUS.includes(body.status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUS.join(', ')}` });
      return;
    }

    const row = await prisma.investigationResult.update({
      where: { id },
      data: {
        ...(body.testName !== undefined && { testName: body.testName.trim() }),
        ...(body.department !== undefined && { department: body.department }),
        ...(body.result !== undefined && { result: body.result }),
        ...(body.unit !== undefined && { unit: body.unit }),
        ...(body.referenceRange !== undefined && { referenceRange: body.referenceRange }),
        ...(body.findings !== undefined && { findings: body.findings }),
        ...(body.impression !== undefined && { impression: body.impression }),
        ...(body.criticalFlag !== undefined && { criticalFlag: !!body.criticalFlag }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.reportedAt !== undefined && { reportedAt: parseDate(body.reportedAt) }),
        ...(reportUrl && { reportUrl }),
      },
    });

    await auditLog(req, {
      module: 'lab-radiology',
      action: 'UPDATE_RESULT',
      entityType: 'InvestigationResult',
      entityId: String(row.id),
      payload: { status: row.status, critical: row.criticalFlag },
    });

    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[investigation-result] updateResult failed:', error);
    res.status(500).json({ message: 'Failed to update result' });
  }
};

// ─── Acknowledge critical result ───────────────────────────────────────

export const acknowledgeResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.investigationResult.findUnique({
      where: { id },
      select: { id: true, criticalFlag: true, isDeleted: true, acknowledgedAt: true },
    });
    if (!existing || existing.isDeleted) { res.status(404).json({ message: 'Result not found' }); return; }
    if (existing.acknowledgedAt) {
      res.status(200).json({ data: { id, acknowledgedAt: existing.acknowledgedAt, alreadyAcked: true } });
      return;
    }
    const row = await prisma.investigationResult.update({
      where: { id },
      data: {
        acknowledgedBy: req.user?.username ?? null,
        acknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
        acknowledgedAt: new Date(),
      },
      select: { id: true, acknowledgedAt: true, acknowledgedBy: true },
    });
    await auditLog(req, {
      module: 'lab-radiology',
      action: 'ACK_RESULT',
      entityType: 'InvestigationResult',
      entityId: String(id),
      payload: null,
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[investigation-result] acknowledgeResult failed:', error);
    res.status(500).json({ message: 'Failed to acknowledge result' });
  }
};

// ─── Soft delete ───────────────────────────────────────────────────────

export const deleteResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.investigationResult.findUnique({ where: { id }, select: { id: true, isDeleted: true } });
    if (!existing) { res.status(404).json({ message: 'Result not found' }); return; }
    await prisma.investigationResult.update({ where: { id }, data: { isDeleted: true } });
    await auditLog(req, {
      module: 'lab-radiology', action: 'DELETE_RESULT', entityType: 'InvestigationResult',
      entityId: String(id), payload: null,
    });
    res.status(204).end();
  } catch (error) {
    console.error('[investigation-result] deleteResult failed:', error);
    res.status(500).json({ message: 'Failed to delete result' });
  }
};

// ─── Unacknowledged critical results for a patient (banner) ────────────

export const unackCritical = async (req: Request, res: Response): Promise<void> => {
  try {
    const prn = req.query.prn as string | undefined;
    if (!prn) { res.status(400).json({ message: 'prn is required' }); return; }
    const days = Number(req.query.days ?? '7');
    const since = new Date();
    since.setDate(since.getDate() - (Number.isFinite(days) ? days : 7));
    const rows = await prisma.investigationResult.findMany({
      where: {
        prn,
        criticalFlag: true,
        acknowledgedAt: null,
        isDeleted: false,
        createdAt: { gte: since },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[investigation-result] unackCritical failed:', error);
    res.status(500).json({ message: 'Failed to list unacknowledged critical results' });
  }
};
