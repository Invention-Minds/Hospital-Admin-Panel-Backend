import type { HmisAuditLog } from '@prisma/client';
import { createHmisAuditLog } from './hmis-audit';

/**
 * Reusable HMIS push + audit wrapper.
 *
 * Contract: every outbound push and every retrievable pull runs through this
 * wrapper so that an HmisAuditLog row is written on success AND failure,
 * with full error detail on failure. Controllers should NOT call the raw
 * hmis-client functions directly; always go through syncWithHmis().
 */

export type HmisDirection = 'push' | 'pull';

export type HmisModule =
  | 'patient'
  | 'appointment'
  | 'opd'
  | 'investigation'
  | 'prescription'
  | 'pharmacy'
  | 'emergency'
  | 'mlc'
  | 'lama'
  | 'dama'
  | 'ipd'
  | 'ipd-pharmacy'
  | 'ipd-mar'
  | 'lab-result'
  | 'radiology-result'
  | 'bed-status'
  | 'discharge'
  | 'follow-up'         // Added in 4a Phase 1c — IPD discharge → Appointment auto-creation audit trail
  | 'bed-census'        // Added in 4a Phase 1e — daily bed census snapshot audit trail
  | 'payment'
  | 'webhook';

export type HmisAction = string;

export interface HmisRetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Wrapper defaults to no retry because hmis-client.ts already retries
 * internally (exponential backoff, 3 attempts). Callers that wrap a raw
 * HTTP call without client-side retry can pass `retry: { maxRetries: 3 }`.
 */
export const DEFAULT_HMIS_RETRY_POLICY: HmisRetryPolicy = {
  maxRetries: 0,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
};

export interface HmisSyncInput<TResult = unknown> {
  direction: HmisDirection;
  module: HmisModule;
  /** The entity type inside the module, e.g. 'admission', 'progress-note', 'prescription'. */
  entityType: string;
  action: HmisAction;
  /** Domain payload, logged as JSON for audit. Should be the Docminds-side object, not the HMIS-shape. */
  payload: unknown;
  /** The actual HMIS call. Should be idempotent if the retry policy is >0. */
  operation: () => Promise<TResult>;
  retry?: Partial<HmisRetryPolicy>;
  /** Default true: HMIS failures do not propagate. Set false to let callers decide how to handle. */
  swallowErrors?: boolean;
  /** Injectable for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface HmisSyncError {
  message: string;
  status?: number;
  code?: string;
  detail?: unknown;
}

export interface HmisSyncOutcome<TResult = unknown> {
  success: boolean;
  result?: TResult;
  auditLogId?: number;
  attempts: number;
  error?: HmisSyncError;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeError = (err: unknown): HmisSyncError => {
  if (err && typeof err === 'object') {
    const e = err as {
      message?: string;
      code?: string;
      response?: { status?: number; data?: unknown };
    };
    return {
      message: e.message ?? 'Unknown error',
      status: e.response?.status,
      code: e.code,
      detail: e.response?.data,
    };
  }
  return { message: String(err) };
};

export const syncWithHmis = async <TResult = unknown>(
  input: HmisSyncInput<TResult>
): Promise<HmisSyncOutcome<TResult>> => {
  const policy: HmisRetryPolicy = {
    ...DEFAULT_HMIS_RETRY_POLICY,
    ...(input.retry ?? {}),
  };
  const sleep = input.sleepFn ?? defaultSleep;
  const payloadJson = safeStringify(input.payload);
  const maxAttempts = policy.maxRetries + 1;

  let attempts = 0;
  let lastError: unknown;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const result = await input.operation();
      const log: HmisAuditLog | null = await createHmisAuditLog({
        direction: input.direction,
        module: input.module,
        action: input.action,
        payload: payloadJson,
        response: safeStringify({ entityType: input.entityType, result }),
        status: 'success',
        retryCount: attempts - 1,
      });
      return {
        success: true,
        result,
        auditLogId: log?.id,
        attempts,
      };
    } catch (err) {
      lastError = err;
      if (attempts < maxAttempts) {
        const delay =
          policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempts - 1);
        await sleep(delay);
      }
    }
  }

  const error = normalizeError(lastError);
  const log: HmisAuditLog | null = await createHmisAuditLog({
    direction: input.direction,
    module: input.module,
    action: input.action,
    payload: payloadJson,
    response: safeStringify({ entityType: input.entityType, error }),
    status: 'failed',
    retryCount: attempts - 1,
  });

  const outcome: HmisSyncOutcome<TResult> = {
    success: false,
    auditLogId: log?.id,
    attempts,
    error,
  };

  if (input.swallowErrors === false) {
    const wrapped = new Error(
      `HMIS sync failed for ${input.module}.${input.action}: ${error.message}`
    );
    (wrapped as Error & { cause?: unknown }).cause = lastError;
    throw wrapped;
  }

  return outcome;
};
