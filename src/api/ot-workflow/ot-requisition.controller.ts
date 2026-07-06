import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.1a — OT Requisition queue.
//
// Ward / consultant raises a request for an OT slot; the OT manager
// picks it up from the queue and links it to a new OtSchedule. The
// requisition row stays around as the audit trail for the booking
// origin, including any cancellations or re-bookings.
//
// Mirrors the reference HMIS "Enter Requisition" / "Search Requisition"
// dialogs in the Impulse OT module.

const VALID_STATUSES = ['pending', 'scheduled', 'cancelled', 'fulfilled'];

interface CreateRequisitionBody {
  prn?: string | null;
  patientName?: string | null;
  patientAdmitted?: boolean;
  admissionId?: string | null;
  bedCategory?: string | null;
  phoneNumber?: string | null;
  otRoomId?: string | null;
  bookingFrom: string;
  bookingTo: string;
  primarySurgery: string;
  departmentId?: number | null;
  categoryCode?: string | null;
  surgeonId?: number | null;
  surgeonName?: string | null;
  anaesthetistId?: number | null;
  anaesthetistName?: string | null;
  anaesthesiaType?: string | null;
  additionalSurgeries?: unknown;
  specialInstructions?: string | null;
  requisitionBy?: string | null;
  estimationId?: string | null;
}

const generateRequisitionNo = async (): Promise<string> => {
  const year = new Date().getFullYear();
  // Lightweight counter — sequencing is approximate; uniqueness is enforced
  // by the @unique constraint, so a collision surfaces as a Prisma error.
  const count = await prisma.otRequisition.count();
  return `JMRH-OT-REQ-${year}-${String(count + 1).padStart(4, '0')}`;
};

export const listRequisitions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, prn, fromDate, toDate, estimationId } = req.query;
    const where: Record<string, unknown> = {};
    if (status && typeof status === 'string') where.status = status;
    if (prn && typeof prn === 'string') where.prn = prn;
    if (estimationId && typeof estimationId === 'string') where.estimationId = estimationId;
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate && typeof fromDate === 'string') range.gte = new Date(fromDate);
      if (toDate && typeof toDate === 'string') range.lte = new Date(toDate);
      where.bookingFrom = range;
    }
    const rows = await prisma.otRequisition.findMany({
      where,
      orderBy: { bookingFrom: 'desc' },
      take: 500,
      include: { schedules: { select: { id: true, status: true } } },
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[ot-requisition] list failed:', error);
    res.status(500).json({ message: 'Failed to list requisitions' });
  }
};

export const getRequisition = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.otRequisition.findUnique({
      where: { id: req.params.id },
      include: { schedules: true },
    });
    if (!row) { res.status(404).json({ message: 'Requisition not found' }); return; }
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-requisition] get failed:', error);
    res.status(500).json({ message: 'Failed to load requisition' });
  }
};

export const createRequisition = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateRequisitionBody;
    if (!body.bookingFrom || !body.bookingTo || !body.primarySurgery?.trim()) {
      res.status(400).json({ message: 'bookingFrom, bookingTo, primarySurgery are required' });
      return;
    }
    // Idempotency — one live requisition per estimation (when raised from one).
    if (body.estimationId) {
      const existing = await prisma.otRequisition.findFirst({
        where: { estimationId: body.estimationId, status: { not: 'cancelled' } },
      });
      if (existing) {
        res.status(200).json({ data: existing });
        return;
      }
    }
    const requisitionNo = await generateRequisitionNo();
    const row = await prisma.otRequisition.create({
      data: {
        requisitionNo,
        estimationId: body.estimationId ?? null,
        prn: body.prn ?? null,
        patientName: body.patientName ?? null,
        patientAdmitted: body.patientAdmitted ?? false,
        admissionId: body.admissionId ?? null,
        bedCategory: body.bedCategory ?? null,
        phoneNumber: body.phoneNumber ?? null,
        otRoomId: body.otRoomId ?? null,
        bookingFrom: new Date(body.bookingFrom),
        bookingTo: new Date(body.bookingTo),
        primarySurgery: body.primarySurgery.trim(),
        departmentId: body.departmentId ?? null,
        categoryCode: body.categoryCode ?? null,
        surgeonId: body.surgeonId ?? null,
        surgeonName: body.surgeonName ?? null,
        anaesthetistId: body.anaesthetistId ?? null,
        anaesthetistName: body.anaesthetistName ?? null,
        anaesthesiaType: body.anaesthesiaType ?? null,
        additionalSurgeries: (body.additionalSurgeries as never) ?? undefined,
        specialInstructions: body.specialInstructions ?? null,
        requisitionBy: body.requisitionBy ?? req.user?.username ?? null,
        requisitionById: typeof req.user?.id === 'number' ? req.user.id : null,
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[ot-requisition] create failed:', error);
    res.status(500).json({ message: 'Failed to create requisition' });
  }
};

export const updateRequisition = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as Partial<CreateRequisitionBody> & { status?: string };
    const existing = await prisma.otRequisition.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Requisition not found' }); return; }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const data: Record<string, unknown> = {};
    if (body.prn !== undefined) data.prn = body.prn;
    if (body.patientName !== undefined) data.patientName = body.patientName;
    if (body.patientAdmitted !== undefined) data.patientAdmitted = body.patientAdmitted;
    if (body.admissionId !== undefined) data.admissionId = body.admissionId;
    if (body.bedCategory !== undefined) data.bedCategory = body.bedCategory;
    if (body.phoneNumber !== undefined) data.phoneNumber = body.phoneNumber;
    if (body.otRoomId !== undefined) data.otRoomId = body.otRoomId;
    if (body.bookingFrom) data.bookingFrom = new Date(body.bookingFrom);
    if (body.bookingTo) data.bookingTo = new Date(body.bookingTo);
    if (body.primarySurgery) data.primarySurgery = body.primarySurgery;
    if (body.departmentId !== undefined) data.departmentId = body.departmentId;
    if (body.categoryCode !== undefined) data.categoryCode = body.categoryCode;
    if (body.surgeonId !== undefined) data.surgeonId = body.surgeonId;
    if (body.surgeonName !== undefined) data.surgeonName = body.surgeonName;
    if (body.anaesthetistId !== undefined) data.anaesthetistId = body.anaesthetistId;
    if (body.anaesthetistName !== undefined) data.anaesthetistName = body.anaesthetistName;
    if (body.anaesthesiaType !== undefined) data.anaesthesiaType = body.anaesthesiaType;
    if (body.additionalSurgeries !== undefined) data.additionalSurgeries = body.additionalSurgeries;
    if (body.specialInstructions !== undefined) data.specialInstructions = body.specialInstructions;
    if (body.status) data.status = body.status;

    const row = await prisma.otRequisition.update({ where: { id }, data });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-requisition] update failed:', error);
    res.status(500).json({ message: 'Failed to update requisition' });
  }
};

export const cancelRequisition = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reason } = req.body as { reason?: string };
    const row = await prisma.otRequisition.update({
      where: { id: req.params.id },
      data: { status: 'cancelled', cancelReason: reason ?? null },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[ot-requisition] cancel failed:', error);
    res.status(500).json({ message: 'Failed to cancel requisition' });
  }
};

// Mark a requisition as "scheduled" when a schedule is created from it.
// Called by ot-schedule.controller after successful schedule creation.
export const markRequisitionScheduled = async (requisitionId: string): Promise<void> => {
  await prisma.otRequisition.update({
    where: { id: requisitionId },
    data: { status: 'scheduled' },
  });
};
