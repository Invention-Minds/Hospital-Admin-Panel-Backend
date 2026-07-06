import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.4d — OP Procedures (outpatient minor procedure flow).
// CRUD + status transitions (start / end / cancel + sign).
// Valid statuses: SCHEDULED → IN_PROGRESS → COMPLETED (or CANCELLED).

const generateProcedureNo = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const count = await prisma.opProcedure.count();
  return `JMRH-OP-PROC-${year}-${String(count + 1).padStart(4, '0')}`;
};

interface CreateBody {
  prn: string;
  patientName: string;
  age?: number | null;
  gender?: string | null;
  phoneNumber?: string | null;
  opdAppointmentId?: number | null;
  sourceModule?: string;
  procedureName: string;
  procedureCode?: string | null;
  departmentId?: number | null;
  departmentName?: string | null;
  performingDoctor: string;
  performingDoctorId?: number | null;
  assistantName?: string | null;
  roomName?: string | null;
  anaesthesiaType?: string | null;
  anaesthesiaAgent?: string | null;
  scheduledAt?: string | null;
  preProcedureNotes?: string | null;
}

export const listProcedures = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, prn, fromDate, toDate, performingDoctor } = req.query;
    const where: Record<string, unknown> = {};
    if (status && typeof status === 'string') where.status = status;
    if (prn && typeof prn === 'string') where.prn = prn;
    if (performingDoctor && typeof performingDoctor === 'string') {
      where.performingDoctor = { contains: performingDoctor };
    }
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate && typeof fromDate === 'string') range.gte = new Date(fromDate);
      if (toDate && typeof toDate === 'string') range.lte = new Date(toDate);
      where.scheduledAt = range;
    }
    const rows = await prisma.opProcedure.findMany({
      where,
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[op-procedure] list failed:', error);
    res.status(500).json({ message: 'Failed to list procedures' });
  }
};

export const getProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.opProcedure.findUnique({ where: { id: req.params.id } });
    if (!row) { res.status(404).json({ message: 'Procedure not found' }); return; }
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[op-procedure] get failed:', error);
    res.status(500).json({ message: 'Failed to load procedure' });
  }
};

export const createProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateBody;
    if (!body.prn?.trim() || !body.patientName?.trim() || !body.procedureName?.trim() || !body.performingDoctor?.trim()) {
      res.status(400).json({ message: 'prn, patientName, procedureName, performingDoctor are required' });
      return;
    }
    const procedureNo = await generateProcedureNo();
    const row = await prisma.opProcedure.create({
      data: {
        procedureNo,
        prn: body.prn.trim(),
        patientName: body.patientName.trim(),
        age: body.age ?? null,
        gender: body.gender ?? null,
        phoneNumber: body.phoneNumber ?? null,
        opdAppointmentId: body.opdAppointmentId ?? null,
        sourceModule: body.sourceModule ?? 'opd',
        procedureName: body.procedureName.trim(),
        procedureCode: body.procedureCode ?? null,
        departmentId: body.departmentId ?? null,
        departmentName: body.departmentName ?? null,
        performingDoctor: body.performingDoctor.trim(),
        performingDoctorId: body.performingDoctorId ?? null,
        assistantName: body.assistantName ?? null,
        roomName: body.roomName ?? null,
        anaesthesiaType: body.anaesthesiaType ?? null,
        anaesthesiaAgent: body.anaesthesiaAgent ?? null,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        preProcedureNotes: body.preProcedureNotes ?? null,
        status: 'SCHEDULED',
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'op-procedure',
      action: 'CREATE',
      entityType: 'OpProcedure',
      entityId: row.id,
      payload: { prn: row.prn, procedureName: row.procedureName },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[op-procedure] create failed:', error);
    res.status(500).json({ message: 'Failed to create procedure' });
  }
};

interface UpdateBody {
  procedureSteps?: string;
  findings?: string;
  complications?: string;
  conditionAtEnd?: string;
  disposition?: string;
  postProcedureInstructions?: string;
  assistantName?: string;
  anaesthesiaType?: string;
  anaesthesiaAgent?: string;
  roomName?: string;
}

export const updateProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.opProcedure.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Procedure not found' }); return; }
    if (existing.status === 'CANCELLED') {
      res.status(409).json({ message: 'Cannot edit a cancelled procedure' });
      return;
    }
    const body = req.body as UpdateBody;
    const row = await prisma.opProcedure.update({
      where: { id },
      data: {
        ...(body.procedureSteps !== undefined && { procedureSteps: body.procedureSteps }),
        ...(body.findings !== undefined && { findings: body.findings }),
        ...(body.complications !== undefined && { complications: body.complications }),
        ...(body.conditionAtEnd !== undefined && { conditionAtEnd: body.conditionAtEnd }),
        ...(body.disposition !== undefined && { disposition: body.disposition }),
        ...(body.postProcedureInstructions !== undefined && { postProcedureInstructions: body.postProcedureInstructions }),
        ...(body.assistantName !== undefined && { assistantName: body.assistantName }),
        ...(body.anaesthesiaType !== undefined && { anaesthesiaType: body.anaesthesiaType }),
        ...(body.anaesthesiaAgent !== undefined && { anaesthesiaAgent: body.anaesthesiaAgent }),
        ...(body.roomName !== undefined && { roomName: body.roomName }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[op-procedure] update failed:', error);
    res.status(500).json({ message: 'Failed to update procedure' });
  }
};

export const startProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.opProcedure.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Procedure not found' }); return; }
    if (existing.status !== 'SCHEDULED') {
      res.status(409).json({ message: `Cannot start a ${existing.status} procedure` });
      return;
    }
    const row = await prisma.opProcedure.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    await auditLog(req, {
      module: 'op-procedure',
      action: 'STATUS_CHANGE',
      entityType: 'OpProcedure',
      entityId: id,
      payload: { from: 'SCHEDULED', to: 'IN_PROGRESS' },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[op-procedure] start failed:', error);
    res.status(500).json({ message: 'Failed to start procedure' });
  }
};

interface CompleteBody {
  signatureId?: string;
  conditionAtEnd?: string;
  disposition?: string;
}

export const completeProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as CompleteBody;
    const existing = await prisma.opProcedure.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Procedure not found' }); return; }
    if (existing.status !== 'IN_PROGRESS') {
      res.status(409).json({ message: `Cannot complete a ${existing.status} procedure` });
      return;
    }
    const row = await prisma.opProcedure.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        ...(body.conditionAtEnd && { conditionAtEnd: body.conditionAtEnd }),
        ...(body.disposition && { disposition: body.disposition }),
        ...(body.signatureId && {
          signatureId: body.signatureId,
          signedBy: req.user?.username ?? null,
          signedById: typeof req.user?.id === 'number' ? req.user.id : null,
          signedAt: new Date(),
        }),
      },
    });
    await auditLog(req, {
      module: 'op-procedure',
      action: 'STATUS_CHANGE',
      entityType: 'OpProcedure',
      entityId: id,
      payload: { from: 'IN_PROGRESS', to: 'COMPLETED', signed: !!body.signatureId },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[op-procedure] complete failed:', error);
    res.status(500).json({ message: 'Failed to complete procedure' });
  }
};

interface CancelBody {
  reason: string;
}

export const cancelProcedure = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as CancelBody;
    if (!body.reason?.trim()) {
      res.status(400).json({ message: 'reason is required' });
      return;
    }
    const existing = await prisma.opProcedure.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Procedure not found' }); return; }
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      res.status(409).json({ message: `Cannot cancel a ${existing.status} procedure` });
      return;
    }
    const row = await prisma.opProcedure.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: body.reason },
    });
    await auditLog(req, {
      module: 'op-procedure',
      action: 'STATUS_CHANGE',
      entityType: 'OpProcedure',
      entityId: id,
      payload: { from: existing.status, to: 'CANCELLED', reason: body.reason },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[op-procedure] cancel failed:', error);
    res.status(500).json({ message: 'Failed to cancel procedure' });
  }
};
