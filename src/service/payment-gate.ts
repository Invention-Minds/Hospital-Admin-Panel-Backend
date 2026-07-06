import type { Request } from 'express';
import prisma from './prisma-client';
import { auditLog } from './app-audit';

/**
 * Phase 2.5 — Payment-confirmation gate (NABH MOM.4 / WF-1).
 *
 * Before saving a prescription or placing an investigation order, the
 * appointment must be paid. The doctor can override with a written reason
 * (e.g. emergency or staff exemption); every override is audited.
 *
 * Returns `{ ok: true }` when the gate passes (paid, waived, or valid override).
 * Returns `{ ok: false, reason }` when the action should be rejected.
 *
 * Callers do something like:
 *
 *   const gate = await checkPaymentGate(req, { appointmentId, action: 'prescription' });
 *   if (!gate.ok) {
 *     res.status(402).json({ error: gate.reason });
 *     return;
 *   }
 */

interface GateInput {
  appointmentId?: number | string;
  action: 'prescription' | 'investigation';
}

interface GateResult {
  ok: boolean;
  reason?: string;
  paymentStatus?: string;
}

const ALLOWED_STATUSES = new Set(['paid', 'waived']);

export async function checkPaymentGate(
  req: Request,
  input: GateInput
): Promise<GateResult> {
  const overrideReason = (req.body?.paymentOverrideReason as string | undefined)?.trim();
  const apptId = input.appointmentId != null ? Number(input.appointmentId) : NaN;

  // No appointmentId on the body → cannot check. Allow but log so
  // we can find these gaps in the audit later.
  if (!Number.isFinite(apptId)) {
    await auditLog(req, {
      module: input.action,
      action: 'OVERRIDE',
      entityType: 'PaymentGate',
      payload: { reason: 'no-appointmentId', action: input.action },
      notes: 'Payment gate skipped — no appointmentId on request',
    });
    return { ok: true };
  }

  const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
  if (!appt) {
    return { ok: false, reason: 'Appointment not found for payment check' };
  }

  if (ALLOWED_STATUSES.has((appt.paymentStatus ?? 'unpaid').toLowerCase())) {
    return { ok: true, paymentStatus: appt.paymentStatus ?? undefined };
  }

  // Override path — require an explicit non-empty reason.
  if (overrideReason && overrideReason.length >= 5) {
    await auditLog(req, {
      module: input.action,
      action: 'OVERRIDE',
      entityType: 'Appointment',
      entityId: apptId,
      payload: { paymentStatus: appt.paymentStatus, action: input.action },
      notes: `Payment gate overridden: ${overrideReason}`,
    });
    return { ok: true, paymentStatus: appt.paymentStatus ?? undefined };
  }

  return {
    ok: false,
    reason:
      'Payment not confirmed for this appointment. Provide a paymentOverrideReason (min 5 chars) to proceed.',
    paymentStatus: appt.paymentStatus ?? 'unpaid',
  };
}

/**
 * Convenience wrapper used by HMIS webhooks: marks the appointment paid.
 * Only fields with non-null inputs are written so partial webhook payloads
 * don't blank out previously stored data.
 */
export async function markAppointmentPaid(
  appointmentId: number,
  data: {
    paidAmount?: number;
    paidAt?: Date;
    receiptNo?: string;
    paymentSource?: string;
    paymentStatus?: 'paid' | 'partial' | 'waived';
  }
) {
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      paymentStatus: data.paymentStatus ?? 'paid',
      ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
      paidAt: data.paidAt ?? new Date(),
      ...(data.receiptNo !== undefined && { receiptNo: data.receiptNo }),
      ...(data.paymentSource !== undefined && { paymentSource: data.paymentSource }),
    },
  });
}
