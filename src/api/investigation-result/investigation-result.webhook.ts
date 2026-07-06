import type { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../service/prisma-client';
import { auditLogSystem } from '../../service/app-audit';

// Phase 9.11 Phase B — Third-party result ingest webhook.
//
// Vendors push results to:
//   POST /api/investigation-results/webhook/:provider
//   X-Webhook-Token: <provider-shared-secret>
//
// Payload contract (vendor-agnostic; vendor adapters can normalise to this
// shape before posting):
//   {
//     "results": [
//       {
//         "providerResultId": "ABC-12345",            // dedup key
//         "prn":              "PRN0042",
//         "orderId":          1234,                    // our orderId — vendor must echo back
//         "testName":         "Hemoglobin",
//         "department":       "lab" | "radiology",
//         "result":           "8.2",
//         "unit":             "g/dL",
//         "referenceRange":   "13.0-17.5",
//         "findings":         null,
//         "impression":       null,
//         "reportUrl":        "https://cdn.lab.test/reports/abc.pdf",
//         "reportedAt":       "2026-05-15T10:00:00Z",
//         "status":           "final"
//       }
//     ]
//   }
//
// Idempotent: upsert keyed on (webhookProvider, hmisResultId). Re-delivery
// updates instead of duplicating. Failed rows don't abort the batch — each
// is logged and returned in the response's `failures` array.

const VALID_DEPARTMENTS = ['lab', 'radiology'] as const;
const VALID_STATUS = ['pending', 'partial', 'final'] as const;

interface WebhookResultPayload {
  providerResultId: string;
  prn: string;
  orderId: number;
  testName: string;
  department: string;
  result?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  findings?: string | null;
  impression?: string | null;
  reportUrl?: string | null;
  reportedAt?: string | null;
  status: string;
}

interface WebhookBody {
  results?: WebhookResultPayload[];
}

// Provider tokens live in environment as a JSON map, e.g.:
//   LAB_WEBHOOK_TOKENS='{"manorama-lab":"abcd1234…","kims-rad":"efgh5678…"}'
// We do NOT log the raw token; only "provider has a valid token" / "no match".
const loadProviderTokens = (): Record<string, string> => {
  const raw = process.env.LAB_WEBHOOK_TOKENS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed;
  } catch (e) {
    console.warn('[investigation-result/webhook] LAB_WEBHOOK_TOKENS is not valid JSON, ignoring');
    return {};
  }
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

// Phase 9.11 Phase B — Auto-critical detection from numeric reference range.
//
// Looks at refRange strings like "13.0-17.5", "13.0 - 17.5", "<10", ">200",
// "<=100", ">=5". If the result is numeric and falls outside, flips
// criticalFlag=true. Conservative: only fires when we can parse both the
// result and the range cleanly. Anything ambiguous → leave the vendor's
// criticalFlag (if any) untouched.
export const isOutsideRange = (resultStr: string | null | undefined, rangeStr: string | null | undefined): boolean => {
  if (!resultStr || !rangeStr) return false;
  const n = Number(String(resultStr).replace(/[^\d.\-]/g, ''));
  if (!Number.isFinite(n)) return false;
  const r = rangeStr.trim();

  // "min-max" or "min - max"
  const between = r.match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/);
  if (between) {
    const lo = Number(between[1]); const hi = Number(between[2]);
    return n < lo || n > hi;
  }
  // "<x" / "<=x"
  const lt = r.match(/^<=?\s*(-?\d+(?:\.\d+)?)$/);
  if (lt) {
    const lim = Number(lt[1]);
    return r.includes('<=') ? n > lim : n >= lim;
  }
  // ">x" / ">=x"
  const gt = r.match(/^>=?\s*(-?\d+(?:\.\d+)?)$/);
  if (gt) {
    const lim = Number(gt[1]);
    return r.includes('>=') ? n < lim : n <= lim;
  }
  return false;
};

// ─── Notification helper (mirrors the controller's local version) ──────

// Phase 6 / Concern #3 — same FK + status + enrichment fixes as controller.
const notifyDoctor = async (params: {
  doctorId: number;
  resultId: number;
  testName: string;
  isCritical: boolean;
  prn: string;
  provider: string;
  patientName?: string | null;
  value?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  resultStatus?: string;
}): Promise<void> => {
  try {
    // Only fire on final results.
    if (params.resultStatus && params.resultStatus !== 'final') return;

    const doctor = await prisma.doctor.findUnique({
      where: { id: params.doctorId },
      select: { userId: true, name: true },
    });
    if (!doctor) {
      console.warn('[investigation-result/webhook] notify skipped — Doctor not found id=' + params.doctorId);
      return;
    }
    if (!doctor.userId) {
      console.warn('[investigation-result/webhook] Doctor.userId NULL for ' + (doctor.name ?? params.doctorId) + ' — bell will be role-only');
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
        message: actionVerb + ' · ' + patientPart + valuePart + ' (via ' + params.provider + ')',
        status: 'unread',
        entityType: 'InvestigationResult',
        entityId: params.resultId,
        isCritical: params.isCritical,
        targetRole: 'doctor',
        userId: doctor.userId ?? undefined,
      },
    });
  } catch (e) {
    console.warn('[investigation-result/webhook] notification failed:', (e as Error).message);
  }
};

async function lookupPatientName(prn: string): Promise<string | null> {
  try {
    const n = Number(prn);
    if (!Number.isFinite(n)) return null;
    const p = await prisma.patientDetails.findUnique({ where: { prn: n }, select: { name: true } });
    return p?.name ?? null;
  } catch { return null; }
}

// ─── Handler ───────────────────────────────────────────────────────────

export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  const provider = req.params.provider?.trim();
  if (!provider) { res.status(400).json({ message: 'Missing provider' }); return; }

  // Token check
  const tokens = loadProviderTokens();
  const expected = tokens[provider];
  if (!expected) { res.status(401).json({ message: 'Unknown provider' }); return; }
  const supplied = (req.headers['x-webhook-token'] as string | undefined) ?? '';
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    res.status(401).json({ message: 'Invalid webhook token' });
    return;
  }

  const body = (req.body ?? {}) as WebhookBody;
  if (!Array.isArray(body.results) || body.results.length === 0) {
    res.status(400).json({ message: 'results[] must be a non-empty array' });
    return;
  }

  const created: number[] = [];
  const updated: number[] = [];
  const failures: Array<{ providerResultId: string; reason: string }> = [];

  for (const r of body.results) {
    try {
      if (!r.providerResultId) { failures.push({ providerResultId: r.providerResultId ?? '?', reason: 'providerResultId required' }); continue; }
      if (!r.prn) { failures.push({ providerResultId: r.providerResultId, reason: 'prn required' }); continue; }
      if (!Number.isFinite(r.orderId)) { failures.push({ providerResultId: r.providerResultId, reason: 'orderId required' }); continue; }
      if (!r.testName) { failures.push({ providerResultId: r.providerResultId, reason: 'testName required' }); continue; }
      if (!VALID_DEPARTMENTS.includes(r.department as typeof VALID_DEPARTMENTS[number])) {
        failures.push({ providerResultId: r.providerResultId, reason: `department must be lab|radiology` }); continue;
      }
      if (!VALID_STATUS.includes(r.status as typeof VALID_STATUS[number])) {
        failures.push({ providerResultId: r.providerResultId, reason: `status must be pending|partial|final` }); continue;
      }

      // Order must exist and belong to the same PRN (light integrity check).
      const order = await prisma.investigationOrder.findUnique({
        where: { id: r.orderId },
        select: { id: true, prn: true, doctorId: true },
      });
      if (!order) { failures.push({ providerResultId: r.providerResultId, reason: 'orderId not found' }); continue; }
      if (order.prn !== r.prn) { failures.push({ providerResultId: r.providerResultId, reason: 'PRN does not match order' }); continue; }

      // Auto-critical detection: only fires for lab + parseable range.
      const autoCritical =
        r.department === 'lab' && isOutsideRange(r.result ?? null, r.referenceRange ?? null);

      const reportedAt = r.reportedAt ? new Date(r.reportedAt) : new Date();

      // Upsert keyed on (webhookProvider, providerResultId) → hmisResultId stores providerResultId.
      const existing = await prisma.investigationResult.findFirst({
        where: { webhookProvider: provider, hmisResultId: r.providerResultId },
        select: { id: true, status: true, criticalFlag: true },
      });

      if (existing) {
        await prisma.investigationResult.update({
          where: { id: existing.id },
          data: {
            testName: r.testName,
            department: r.department,
            result: r.result ?? null,
            unit: r.unit ?? null,
            referenceRange: r.referenceRange ?? null,
            findings: r.findings ?? null,
            impression: r.impression ?? null,
            criticalFlag: autoCritical,
            reportUrl: r.reportUrl ?? null,
            reportedAt,
            status: r.status,
          },
        });
        updated.push(existing.id);

        // Phase 6 / Concern #3 — fire on meaningful transitions:
        //   pending/partial → final, OR criticalFlag false → true on a final result.
        const becameFinal = existing.status !== 'final' && r.status === 'final';
        const becameCritical = !existing.criticalFlag && autoCritical && r.status === 'final';
        if (becameFinal || becameCritical) {
          const patientName = await lookupPatientName(r.prn);
          await notifyDoctor({
            doctorId: order.doctorId, resultId: existing.id,
            testName: r.testName, isCritical: autoCritical, prn: r.prn, provider,
            patientName, value: r.result ?? null, unit: r.unit ?? null,
            referenceRange: r.referenceRange ?? null, resultStatus: r.status,
          });
        }
      } else {
        const row = await prisma.investigationResult.create({
          data: {
            orderId: r.orderId,
            prn: r.prn,
            testName: r.testName,
            department: r.department,
            result: r.result ?? null,
            unit: r.unit ?? null,
            referenceRange: r.referenceRange ?? null,
            findings: r.findings ?? null,
            impression: r.impression ?? null,
            criticalFlag: autoCritical,
            reportUrl: r.reportUrl ?? null,
            reportedAt,
            status: r.status,
            webhookProvider: provider,
            hmisResultId: r.providerResultId,
            uploadedBy: provider, // mark provenance
            uploadedAt: new Date(),
          },
        });
        created.push(row.id);
        const patientName = await lookupPatientName(row.prn);
        await notifyDoctor({
          doctorId: order.doctorId,
          resultId: row.id,
          testName: row.testName,
          isCritical: row.criticalFlag,
          prn: row.prn,
          provider,
          patientName,
          value: r.result ?? null,
          unit: r.unit ?? null,
          referenceRange: r.referenceRange ?? null,
          resultStatus: row.status,
        });
      }
    } catch (err) {
      failures.push({
        providerResultId: r.providerResultId ?? '?',
        reason: (err as Error).message,
      });
    }
  }

  await auditLogSystem({
    module: 'lab-radiology',
    action: 'WEBHOOK_INGEST',
    entityType: 'InvestigationResult',
    payload: {
      provider,
      counts: { created: created.length, updated: updated.length, failures: failures.length },
    },
    source: provider,
  });

  res.status(200).json({
    ok: failures.length === 0,
    counts: { created: created.length, updated: updated.length, failures: failures.length },
    failures,
  });
};
