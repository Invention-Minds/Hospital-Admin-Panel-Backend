import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog, auditLogSystem } from '../../service/app-audit';
import { markAppointmentPaid } from '../../service/payment-gate';

/**
 * Phase 2.5 — Revenue + payment endpoints (WF-1).
 *
 * Three responsibilities:
 *   1. Receive HMIS payment-confirmed webhook → flip appointment to paid.
 *   2. Manual mark-paid (cash counter) — same effect, different actor.
 *   3. Compute and serve the revenue rollup (department-wise / doctor-wise).
 */

interface PaymentWebhookBody {
  appointmentId: number | string;
  paidAmount?: number;
  paidAt?: string;
  receiptNo?: string;
  paymentSource?: string;
  paymentStatus?: 'paid' | 'partial' | 'waived';
}

/** POST /api/revenue/payment/webhook — called by HMIS when a payment lands. */
export const paymentWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as PaymentWebhookBody;
    const apptId = Number(body.appointmentId);
    if (!Number.isFinite(apptId)) {
      res.status(400).json({ error: 'appointmentId is required and must be numeric' });
      return;
    }

    const updated = await markAppointmentPaid(apptId, {
      paidAmount: typeof body.paidAmount === 'number' ? body.paidAmount : undefined,
      paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      receiptNo: body.receiptNo,
      paymentSource: body.paymentSource ?? 'hmis-webhook',
      paymentStatus: body.paymentStatus ?? 'paid',
    });

    await auditLog(req, {
      module: 'revenue',
      action: 'STATUS_CHANGE',
      entityType: 'Appointment',
      entityId: updated.id,
      payload: {
        receiptNo: updated.receiptNo,
        paidAmount: updated.paidAmount,
        source: 'hmis-webhook',
      },
      notes: 'Payment confirmed via HMIS webhook',
    });

    res.status(200).json({ ok: true, appointmentId: updated.id, paymentStatus: updated.paymentStatus });
  } catch (error) {
    console.error('[revenue] paymentWebhook failed:', error);
    res.status(500).json({ error: 'Failed to process payment webhook' });
  }
};

/** POST /api/revenue/payment/mark-paid — manual cash-counter mark-paid. */
export const markPaid = async (req: Request, res: Response): Promise<void> => {
  try {
    const apptId = Number(req.body.appointmentId);
    if (!Number.isFinite(apptId)) {
      res.status(400).json({ error: 'appointmentId is required' });
      return;
    }
    const updated = await markAppointmentPaid(apptId, {
      paidAmount: typeof req.body.paidAmount === 'number' ? req.body.paidAmount : undefined,
      receiptNo: req.body.receiptNo,
      paymentSource: req.body.paymentSource ?? 'cash',
      paymentStatus: req.body.paymentStatus ?? 'paid',
    });
    await auditLog(req, {
      module: 'revenue',
      action: 'STATUS_CHANGE',
      entityType: 'Appointment',
      entityId: updated.id,
      payload: { receiptNo: updated.receiptNo, paidAmount: updated.paidAmount, source: 'manual' },
      notes: 'Payment marked paid manually at cash counter',
    });
    res.status(200).json({ ok: true, appointment: updated });
  } catch (error) {
    console.error('[revenue] markPaid failed:', error);
    res.status(500).json({ error: 'Failed to mark appointment paid' });
  }
};

/**
 * GET /api/revenue?by=department|doctor&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Reads the pre-computed RevenueRollup table. If no rollup exists for a
 * given day yet, returns zeros — receptionists must wait for the nightly
 * job (or call the manual recompute endpoint).
 */
export const getRevenueReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const by = (req.query.by as string | undefined) ?? 'department';
    const from = (req.query.from as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string | undefined) ?? from;

    if (by !== 'department' && by !== 'doctor') {
      res.status(400).json({ error: "by must be 'department' or 'doctor'" });
      return;
    }

    const rollups = await prisma.revenueRollup.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }],
    });

    // Group on the requested dimension.
    const grouped = new Map<string, { label: string; count: number; amount: number }>();
    for (const r of rollups) {
      const key = by === 'department'
        ? `${r.departmentId ?? 'unknown'}:${r.departmentName ?? 'Unknown'}`
        : `${r.doctorId ?? 'unknown'}:${r.doctorName ?? 'Unknown'}`;
      const label = by === 'department' ? (r.departmentName ?? 'Unknown') : (r.doctorName ?? 'Unknown');
      const cur = grouped.get(key) ?? { label, count: 0, amount: 0 };
      cur.count += r.appointmentCount;
      cur.amount += r.totalAmount;
      grouped.set(key, cur);
    }

    const data = Array.from(grouped.values()).sort((a, b) => b.amount - a.amount);
    const totals = data.reduce(
      (acc, row) => ({ count: acc.count + row.count, amount: acc.amount + row.amount }),
      { count: 0, amount: 0 }
    );

    res.status(200).json({ by, from, to, rows: data, totals });
  } catch (error) {
    console.error('[revenue] report failed:', error);
    res.status(500).json({ error: 'Failed to compute revenue report' });
  }
};

/**
 * POST /api/revenue/recompute?date=YYYY-MM-DD
 * Manual recompute trigger (also called by the nightly cron). Deletes existing
 * rollup rows for the date and rebuilds from raw appointment data.
 */
export const recomputeRollup = async (req: Request, res: Response): Promise<void> => {
  try {
    const date = (req.query.date as string | undefined) ?? (req.body?.date as string | undefined);
    if (!date) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
      return;
    }
    const result = await runRollup(date, 'manual');
    res.status(200).json({ ok: true, date, ...result });
  } catch (error) {
    console.error('[revenue] recompute failed:', error);
    res.status(500).json({ error: 'Failed to recompute rollup' });
  }
};

// ─── Internal: rollup compute ─────────────────────────────────────────────

interface RollupResult {
  rowsWritten: number;
  totalAmount: number;
  appointmentCount: number;
}

/**
 * Aggregate paid OPD appointments for a date and persist into RevenueRollup.
 * Idempotent: deletes existing rows for the date first, then rewrites.
 *
 * Today this only covers OPD consultation revenue (Appointment.paidAmount).
 * As Phase 7 ships OT, Phase 4 ships IPD billing, etc., this rollup grows
 * to include them — same RevenueRollup table, different `serviceType` value.
 */
export async function runRollup(date: string, source: 'cron' | 'manual'): Promise<RollupResult> {
  // Wipe stale rows for this date.
  await prisma.revenueRollup.deleteMany({ where: { date } });

  // Pull paid appointments for the date.
  const appts = await prisma.appointment.findMany({
    where: {
      date,
      paymentStatus: { in: ['paid', 'partial'] },
    },
    select: {
      doctorId: true,
      doctorName: true,
      department: true,
      paidAmount: true,
    },
  });

  // Resolve department names → ids in one pass.
  const deptNames = Array.from(new Set(appts.map((a) => a.department).filter(Boolean) as string[]));
  const depts = deptNames.length
    ? await prisma.department.findMany({ where: { name: { in: deptNames } } })
    : [];
  const deptIdByName = new Map(depts.map((d) => [d.name, d.id]));

  // Group by (doctorId, departmentName).
  const groups = new Map<string, { departmentId: number | null; departmentName: string | null; doctorId: number | null; doctorName: string | null; count: number; amount: number }>();
  for (const a of appts) {
    const key = `${a.doctorId ?? 'x'}|${a.department ?? 'x'}`;
    const cur = groups.get(key) ?? {
      departmentId: deptIdByName.get(a.department ?? '') ?? null,
      departmentName: a.department ?? null,
      doctorId: a.doctorId ?? null,
      doctorName: a.doctorName ?? null,
      count: 0,
      amount: 0,
    };
    cur.count += 1;
    cur.amount += a.paidAmount ?? 0;
    groups.set(key, cur);
  }

  // Persist.
  let rowsWritten = 0;
  for (const g of groups.values()) {
    await prisma.revenueRollup.create({
      data: {
        date,
        departmentId: g.departmentId,
        departmentName: g.departmentName,
        doctorId: g.doctorId,
        doctorName: g.doctorName,
        serviceType: 'opd-consultation',
        appointmentCount: g.count,
        totalAmount: g.amount,
      },
    });
    rowsWritten += 1;
  }

  await auditLogSystem({
    module: 'revenue',
    action: 'CREATE',
    entityType: 'RevenueRollup',
    payload: { date, rowsWritten, source },
    source: source === 'cron' ? 'revenue-cron' : 'manual-recompute',
  });

  const totals = Array.from(groups.values()).reduce(
    (acc, g) => ({ amount: acc.amount + g.amount, count: acc.count + g.count }),
    { amount: 0, count: 0 }
  );
  return { rowsWritten, totalAmount: totals.amount, appointmentCount: totals.count };
}
