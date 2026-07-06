import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { runComplaintSlaSweep } from './complaint-sla.cron';
import { findPossibleDuplicateComplaints } from '../../service/incident-complaint-link';

// Phase 9.25 / Phase 4 — Complaint workflow.
//
// Complaints can arrive from a low-NPS survey (created by feedback.controller)
// or be raised manually by Front Desk / Patient Experience. Status workflow:
// open → acknowledged → resolved (or escalated).

const VALID_STATUSES = ['open', 'acknowledged', 'resolved', 'escalated'] as const;
const VALID_SEVERITIES = ['low', 'medium', 'high'] as const;
const VALID_CHANNELS = ['sms', 'whatsapp', 'kiosk', 'phone', 'in-person', 'survey-auto'] as const;

async function nextCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `COMP-${year}-`;
  const last = await prisma.complaint.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const lastSeq = last ? parseInt(last.code.split('-').pop() || '0', 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

function slaHoursFor(severity: 'low' | 'medium' | 'high'): number {
  return severity === 'high' ? 24 : severity === 'medium' ? 72 : 168;
}

interface CreateBody {
  patientPrn?: string | null;
  patientName?: string | null;
  channel?: string;
  description?: string;
  severity?: string;
  // Phase 6 / Concern #4 — encounter FKs for dedup matching.
  appointmentId?: number | null;
  admissionId?: string | null;
  emergencyId?: number | null;
  // Operator override — proceed even when possibleDuplicates were surfaced.
  proceedDespiteDuplicate?: boolean;
}

export const createComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateBody;
    if (!body.description || body.description.trim().length < 3) { res.status(400).json({ message: 'description is required' }); return; }
    if (!body.severity || !VALID_SEVERITIES.includes(body.severity as typeof VALID_SEVERITIES[number])) {
      res.status(400).json({ message: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
      return;
    }
    if (!body.channel || !VALID_CHANNELS.includes(body.channel as typeof VALID_CHANNELS[number])) {
      res.status(400).json({ message: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
      return;
    }
    // Phase 6 / Option A — surface possible duplicates (same encounter or PRN,
    // last 30d, still open). Doesn't block — operator can resubmit with
    // proceedDespiteDuplicate=true to bypass.
    if (!body.proceedDespiteDuplicate) {
      const dupes = await findPossibleDuplicateComplaints({
        patientPrn: body.patientPrn ?? null,
        admissionId: body.admissionId ?? null,
        appointmentId: body.appointmentId ?? null,
        emergencyId: body.emergencyId ?? null,
      });
      if (dupes.length > 0) {
        res.status(409).json({
          message: 'Possible duplicate complaint(s) found for this patient/encounter.',
          possibleDuplicates: dupes,
          hint: 'Resubmit with proceedDespiteDuplicate=true to create anyway.',
        });
        return;
      }
    }

    const code = await nextCode();
    const slaDueAt = new Date(Date.now() + slaHoursFor(body.severity as 'low' | 'medium' | 'high') * 60 * 60 * 1000);
    const row = await prisma.complaint.create({
      data: {
        code,
        patientPrn: body.patientPrn ?? null,
        patientName: body.patientName ?? null,
        channel: body.channel,
        source: 'manual',
        description: body.description.trim(),
        severity: body.severity,
        slaDueAt,
        appointmentId: body.appointmentId ?? null,
        admissionId: body.admissionId ?? null,
        emergencyId: body.emergencyId ?? null,
      },
    });
    await auditLog(req, { module: 'complaint', action: 'CREATE', entityType: 'Complaint', entityId: row.id, payload: { code } });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[complaint] create failed:', error);
    res.status(500).json({ message: 'Failed to raise complaint' });
  }
};

export const listComplaints = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, severity, source, patientPrn } = req.query as Record<string, string | undefined>;
    const rows = await prisma.complaint.findMany({
      where: {
        ...(status && { status }),
        ...(severity && { severity }),
        ...(source && { source }),
        ...(patientPrn && { patientPrn }),
      },
      orderBy: { raisedAt: 'desc' },
      take: 500,
    });
    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[complaint] list failed:', error);
    res.status(500).json({ message: 'Failed to load complaints' });
  }
};

export const getComplaint = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: { feedbackSurvey: true },
    });
    if (!row) { res.status(404).json({ message: 'Complaint not found' }); return; }

    // Phase 6 / Option A — resolve related incidents so the UI can render chips.
    let relatedIncidents: Array<{ id: string; code: string; category: string; severity: string; status: string }> = [];
    if (row.relatedIncidentIds) {
      try {
        const ids = JSON.parse(row.relatedIncidentIds);
        if (Array.isArray(ids) && ids.length > 0) {
          relatedIncidents = await prisma.incident.findMany({
            where: { id: { in: ids.filter((s): s is string => typeof s === 'string') } },
            select: { id: true, code: true, category: true, severity: true, status: true },
          });
        }
      } catch { /* ignore bad JSON */ }
    }

    res.status(200).json({ data: { ...row, relatedIncidents } });
  } catch (error) {
    console.error('[complaint] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch complaint' });
  }
};

interface StatusBody {
  status?: string;
  assignedTo?: string | null;
  assignedToId?: number | null;
  resolutionNotes?: string | null;
}

export const updateComplaintStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.complaint.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) { res.status(404).json({ message: 'Complaint not found' }); return; }

    const body = req.body as StatusBody;
    if (!body.status || !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      status: body.status,
      ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
      ...(body.assignedToId !== undefined && { assignedToId: body.assignedToId }),
      ...(body.resolutionNotes !== undefined && { resolutionNotes: body.resolutionNotes }),
    };
    if (body.status === 'resolved') {
      data['resolvedAt'] = now;
      data['resolvedBy'] = req.user?.username ?? null;
      data['resolvedById'] = typeof req.user?.id === 'number' ? req.user.id : null;
    }

    const row = await prisma.complaint.update({ where: { id }, data });
    await auditLog(req, { module: 'complaint', action: 'STATUS_CHANGE', entityType: 'Complaint', entityId: id, payload: { from: existing.status, to: body.status } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[complaint] updateStatus failed:', error);
    res.status(500).json({ message: 'Failed to update complaint status' });
  }
};

// Phase 6h — bulk status transition for the grievance officer inbox.

interface BulkStatusBody {
  ids?: string[];
  status?: string;
  resolutionNotes?: string | null;
}

export const bulkUpdateStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as BulkStatusBody;
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      res.status(400).json({ message: "'ids' must be a non-empty array" });
      return;
    }
    if (body.ids.length > 200) {
      res.status(400).json({ message: 'Bulk update capped at 200 ids per call' });
      return;
    }
    if (!body.status || !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const ids = body.ids.filter((s): s is string => typeof s === 'string' && s.length > 0);

    const now = new Date();
    const data: Record<string, unknown> = { status: body.status };
    if (body.resolutionNotes !== undefined) data['resolutionNotes'] = body.resolutionNotes;
    if (body.status === 'resolved') {
      data['resolvedAt'] = now;
      data['resolvedBy'] = req.user?.username ?? null;
      data['resolvedById'] = typeof req.user?.id === 'number' ? req.user.id : null;
    }
    // Don't re-touch escalation timestamp; the SLA cron owns that.

    // Skip rows already at the target status — they're no-ops.
    const result = await prisma.complaint.updateMany({
      where: { id: { in: ids }, NOT: { status: body.status } },
      data,
    });

    await auditLog(req, {
      module: 'complaint', action: 'BULK_STATUS', entityType: 'Complaint',
      entityId: 'bulk',
      payload: { requested: ids.length, updated: result.count, to: body.status },
    });

    res.status(200).json({ data: { requested: ids.length, updated: result.count, skipped: ids.length - result.count } });
  } catch (error) {
    console.error('[complaint] bulk status failed:', error);
    res.status(500).json({ message: 'Failed bulk status update' });
  }
};

export const complaintStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const byStatus = await prisma.complaint.groupBy({ by: ['status'], _count: { _all: true } });
    const bySeverity = await prisma.complaint.groupBy({
      by: ['severity'],
      _count: { _all: true },
      where: { status: { in: ['open', 'acknowledged', 'escalated'] } },
    });
    // SLA breaches — past dueAt and not resolved.
    const breached = await prisma.complaint.count({
      where: { slaDueAt: { lt: new Date() }, status: { not: 'resolved' } },
    });
    res.status(200).json({
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      activeBySeverity: Object.fromEntries(bySeverity.map((g) => [g.severity, g._count._all])),
      slaBreached: breached,
    });
  } catch (error) {
    console.error('[complaint] stats failed:', error);
    res.status(500).json({ message: 'Failed to load stats' });
  }
};

// Phase 6a — manual trigger for the SLA breach sweep (ad-hoc / after a
// policy change). Reuses the cron runner.

export const triggerSlaSweep = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await runComplaintSlaSweep();
    await auditLog(req, {
      module: 'complaint', action: 'SLA_SWEEP', entityType: 'Complaint',
      entityId: 'bulk',
      payload: { checked: report.checked, escalated: report.escalated, failed: report.failed },
    });
    res.status(200).json({ data: report });
  } catch (error) {
    console.error('[complaint] sla-sweep failed:', error);
    res.status(500).json({ message: 'SLA sweep failed' });
  }
};

// Reusable complaint creation for non-HTTP callers (e.g. the WhatsApp bot).
// Mirrors createComplaint's persistence without the request/duplicate layer.
export async function createComplaintRecord(input: {
  description: string;
  severity?: 'low' | 'medium' | 'high';
  channel?: string;
  patientPrn?: string | null;
  patientName?: string | null;
}) {
  const severity = input.severity ?? 'medium';
  const code = await nextCode();
  const slaDueAt = new Date(Date.now() + slaHoursFor(severity) * 60 * 60 * 1000);
  return prisma.complaint.create({
    data: {
      code,
      patientPrn: input.patientPrn ?? null,
      patientName: input.patientName ?? null,
      channel: input.channel ?? 'whatsapp',
      source: 'manual',
      description: input.description.trim(),
      severity,
      slaDueAt,
    },
  });
}
