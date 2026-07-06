import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.14 — Insulin Infusion Chart controller.
//
// Per-admission time-series: blood glucose + insulin infusion order, with
// doctor + nurse name (always) and an optional e-signature per row.
// Routes under /api/ipd/admission/:admissionId/insulin-chart.

interface InsulinBody {
  recordedAt?: string;
  bloodGlucoseMgDl?: number | null;
  insulinOrder?: string | null;
  doctorName?: string | null;
  doctorSignatureId?: string | null;
  nurseName?: string | null;
  nurseSignatureId?: string | null;
  remarks?: string | null;
}

// Phase 9.18 — accepted glucose-monitoring cadence codes. Glucose-specific
// (QID / pre-meal are standard for sliding-scale insulin), distinct from the
// vitals cadence set.
export const VALID_GLUCOSE_FREQUENCIES = [
  'continuous', '1h', '2h', '4h', '6h', '8h', 'qid', 'bd', 'premeal',
];

interface FrequencyBody {
  glucoseMonitoringFrequency?: string | null;
}

export const listInsulinReadings = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const [rows, admission] = await Promise.all([
      prisma.ipdInsulinInfusion.findMany({
        where: { admissionId },
        orderBy: { recordedAt: 'asc' },
      }),
      prisma.ipdAdmission.findUnique({
        where: { id: admissionId },
        select: {
          glucoseMonitoringFrequency: true,
          glucoseMonitoringSetBy: true,
          glucoseMonitoringSetAt: true,
        },
      }),
    ]);
    res.status(200).json({
      data: rows,
      order: {
        glucoseMonitoringFrequency: admission?.glucoseMonitoringFrequency ?? null,
        glucoseMonitoringSetBy: admission?.glucoseMonitoringSetBy ?? null,
        glucoseMonitoringSetAt: admission?.glucoseMonitoringSetAt ?? null,
      },
    });
  } catch (error) {
    console.error('[insulin-infusion] list failed:', error);
    res.status(500).json({ message: 'Failed to load insulin chart' });
  }
};

// ─── Doctor-ordered glucose monitoring cadence (lives on IpdAdmission) ──

export const setGlucoseFrequency = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId }, select: { id: true } });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    const freq = (req.body as FrequencyBody).glucoseMonitoringFrequency;
    if (freq !== null && freq !== undefined && !VALID_GLUCOSE_FREQUENCIES.includes(freq)) {
      res.status(400).json({ message: `glucoseMonitoringFrequency must be one of: ${VALID_GLUCOSE_FREQUENCIES.join(', ')}` });
      return;
    }

    const row = await prisma.ipdAdmission.update({
      where: { id: admissionId },
      data: {
        glucoseMonitoringFrequency: freq ?? null,
        glucoseMonitoringSetBy: req.user?.username ?? null,
        glucoseMonitoringSetAt: new Date(),
      },
      select: {
        glucoseMonitoringFrequency: true,
        glucoseMonitoringSetBy: true,
        glucoseMonitoringSetAt: true,
      },
    });
    await auditLog(req, {
      module: 'ipd-insulin', action: 'UPDATE', entityType: 'IpdAdmission',
      entityId: admissionId, payload: { glucoseMonitoringFrequency: row.glucoseMonitoringFrequency },
    });
    res.status(200).json({ order: row });
  } catch (error) {
    console.error('[insulin-infusion] setGlucoseFrequency failed:', error);
    res.status(500).json({ message: 'Failed to set glucose monitoring order' });
  }
};

export const createInsulinReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const admissionId = req.params.admissionId;
    const admission = await prisma.ipdAdmission.findUnique({ where: { id: admissionId }, select: { id: true } });
    if (!admission) { res.status(404).json({ message: 'Admission not found' }); return; }

    const body = req.body as InsulinBody;
    const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      res.status(400).json({ message: 'recordedAt must be a valid timestamp' });
      return;
    }

    const row = await prisma.ipdInsulinInfusion.create({
      data: {
        admissionId,
        recordedAt,
        bloodGlucoseMgDl: typeof body.bloodGlucoseMgDl === 'number' ? body.bloodGlucoseMgDl : null,
        insulinOrder: body.insulinOrder?.trim() || null,
        doctorName: body.doctorName?.trim() || null,
        doctorSignatureId: body.doctorSignatureId || null,
        nurseName: body.nurseName?.trim() || null,
        nurseSignatureId: body.nurseSignatureId || null,
        remarks: body.remarks?.trim() || null,
        recordedBy: req.user?.username ?? null,
        recordedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'ipd-insulin', action: 'CREATE', entityType: 'IpdInsulinInfusion',
      entityId: row.id, payload: { admissionId, glucose: row.bloodGlucoseMgDl },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[insulin-infusion] create failed:', error);
    res.status(500).json({ message: 'Failed to record insulin reading' });
  }
};

export const updateInsulinReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.ipdInsulinInfusion.findUnique({ where: { id }, select: { id: true } });
    if (!existing) { res.status(404).json({ message: 'Reading not found' }); return; }

    const body = req.body as InsulinBody;
    const row = await prisma.ipdInsulinInfusion.update({
      where: { id },
      data: {
        ...(body.recordedAt !== undefined && { recordedAt: new Date(body.recordedAt) }),
        ...(body.bloodGlucoseMgDl !== undefined && { bloodGlucoseMgDl: body.bloodGlucoseMgDl }),
        ...(body.insulinOrder !== undefined && { insulinOrder: body.insulinOrder?.trim() || null }),
        ...(body.doctorName !== undefined && { doctorName: body.doctorName?.trim() || null }),
        ...(body.doctorSignatureId !== undefined && { doctorSignatureId: body.doctorSignatureId || null }),
        ...(body.nurseName !== undefined && { nurseName: body.nurseName?.trim() || null }),
        ...(body.nurseSignatureId !== undefined && { nurseSignatureId: body.nurseSignatureId || null }),
        ...(body.remarks !== undefined && { remarks: body.remarks?.trim() || null }),
      },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[insulin-infusion] update failed:', error);
    res.status(500).json({ message: 'Failed to update reading' });
  }
};

export const deleteInsulinReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    await prisma.ipdInsulinInfusion.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    console.error('[insulin-infusion] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete reading' });
  }
};
