import {
  syncWithHmis,
  HmisSyncOutcome,
  DEFAULT_HMIS_RETRY_POLICY,
} from '../hmis-sync-wrapper';
import { createHmisAuditLog } from '../hmis-audit';

// Mock the audit module so tests do not hit the DB.
jest.mock('../hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

const mockedCreateHmisAuditLog = createHmisAuditLog as jest.MockedFunction<
  typeof createHmisAuditLog
>;

beforeEach(() => {
  mockedCreateHmisAuditLog.mockReset();
  mockedCreateHmisAuditLog.mockResolvedValue({
    id: 42,
    direction: 'push',
    module: 'patient',
    action: 'create',
    payload: '{}',
    response: null,
    status: 'success',
    retryCount: 0,
    quarantinedAt: null,
    createdAt: new Date(),
  });
});

describe('syncWithHmis — happy path', () => {
  it('writes a success audit log and returns the operation result', async () => {
    const operation = jest.fn().mockResolvedValue({ hmisId: 'HMIS-001' });

    const outcome: HmisSyncOutcome<{ hmisId: string }> = await syncWithHmis({
      direction: 'push',
      module: 'patient',
      entityType: 'patient',
      action: 'create',
      payload: { prn: 1001, name: 'Alice' },
      operation,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result).toEqual({ hmisId: 'HMIS-001' });
    expect(outcome.attempts).toBe(1);
    expect(outcome.auditLogId).toBe(42);
    expect(operation).toHaveBeenCalledTimes(1);

    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('success');
    expect(logCall.direction).toBe('push');
    expect(logCall.module).toBe('patient');
    expect(logCall.action).toBe('create');
    expect(logCall.retryCount).toBe(0);
    expect(JSON.parse(logCall.payload)).toEqual({ prn: 1001, name: 'Alice' });
    const response = JSON.parse(logCall.response ?? '{}');
    expect(response.entityType).toBe('patient');
    expect(response.result).toEqual({ hmisId: 'HMIS-001' });
  });
});

describe('syncWithHmis — HMIS down (network error, no response)', () => {
  it('records a failed audit log with error detail and returns success=false', async () => {
    const netErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:80'), {
      code: 'ECONNREFUSED',
    });
    const operation = jest.fn().mockRejectedValue(netErr);

    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'admission',
      action: 'create',
      payload: { admissionNo: 'JMRH-IPD-0001' },
      operation,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(outcome.error?.message).toContain('ECONNREFUSED');
    expect(outcome.error?.code).toBe('ECONNREFUSED');
    expect(outcome.error?.status).toBeUndefined();

    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('failed');
    const response = JSON.parse(logCall.response ?? '{}');
    expect(response.error.code).toBe('ECONNREFUSED');
    expect(response.error.message).toContain('ECONNREFUSED');
  });
});

describe('syncWithHmis — HMIS returns 4xx', () => {
  it('captures status + response body in the audit log error detail', async () => {
    const axiosLike4xx = Object.assign(new Error('Request failed with status 400'), {
      response: {
        status: 400,
        data: { message: 'PRN is required' },
      },
    });
    const operation = jest.fn().mockRejectedValue(axiosLike4xx);

    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'patient',
      entityType: 'patient',
      action: 'create',
      payload: {},
      operation,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error?.status).toBe(400);
    expect(outcome.error?.detail).toEqual({ message: 'PRN is required' });

    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('failed');
    const response = JSON.parse(logCall.response ?? '{}');
    expect(response.error.status).toBe(400);
    expect(response.error.detail).toEqual({ message: 'PRN is required' });
  });
});

describe('syncWithHmis — HMIS returns 5xx', () => {
  it('captures 5xx status code and records a failed audit log', async () => {
    const axiosLike5xx = Object.assign(new Error('Request failed with status 503'), {
      response: {
        status: 503,
        data: '<html>Service Unavailable</html>',
      },
    });
    const operation = jest.fn().mockRejectedValue(axiosLike5xx);

    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'investigation',
      entityType: 'investigation-order',
      action: 'create',
      payload: { orderId: 7 },
      operation,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error?.status).toBe(503);

    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('failed');
    const response = JSON.parse(logCall.response ?? '{}');
    expect(response.error.status).toBe(503);
    expect(response.error.detail).toBe('<html>Service Unavailable</html>');
  });
});

describe('syncWithHmis — retry policy', () => {
  it('retries up to maxRetries then succeeds, writing a single success log', async () => {
    const err = Object.assign(new Error('transient'), {
      response: { status: 502, data: 'bad gateway' },
    });
    const operation = jest
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue({ hmisId: 'HMIS-002' });
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'admission',
      action: 'create',
      payload: { admissionNo: 'X' },
      operation,
      retry: { maxRetries: 2, initialDelayMs: 100, backoffMultiplier: 2 },
      sleepFn,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.attempts).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 100);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 200);

    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('success');
    expect(logCall.retryCount).toBe(2);
  });

  it('retries until maxRetries is exhausted then fails, writing a single failed log', async () => {
    const err = Object.assign(new Error('down'), {
      response: { status: 500, data: 'err' },
    });
    const operation = jest.fn().mockRejectedValue(err);
    const sleepFn = jest.fn().mockResolvedValue(undefined);

    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'patient',
      entityType: 'patient',
      action: 'create',
      payload: {},
      operation,
      retry: { maxRetries: 3, initialDelayMs: 50, backoffMultiplier: 2 },
      sleepFn,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.attempts).toBe(4);
    expect(operation).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 50);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 100);
    expect(sleepFn).toHaveBeenNthCalledWith(3, 200);

    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('failed');
    expect(logCall.retryCount).toBe(3);
  });
});

describe('syncWithHmis — swallowErrors=false', () => {
  it('rethrows a wrapped error after writing the failed audit log', async () => {
    const origErr = Object.assign(new Error('boom'), {
      response: { status: 500 },
    });
    const operation = jest.fn().mockRejectedValue(origErr);

    await expect(
      syncWithHmis({
        direction: 'push',
        module: 'patient',
        entityType: 'patient',
        action: 'create',
        payload: {},
        operation,
        swallowErrors: false,
      })
    ).rejects.toThrow(/HMIS sync failed for patient\.create/);

    expect(mockedCreateHmisAuditLog).toHaveBeenCalledTimes(1);
    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    expect(logCall.status).toBe('failed');
  });
});

describe('syncWithHmis — defaults', () => {
  it('defaults to zero retries (single attempt) to avoid compounding with hmis-client retries', async () => {
    expect(DEFAULT_HMIS_RETRY_POLICY.maxRetries).toBe(0);
  });

  it('treats payload that is not JSON-serializable via String() fallback', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const operation = jest.fn().mockResolvedValue('ok');
    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'patient',
      entityType: 'patient',
      action: 'create',
      payload: circular,
      operation,
    });

    expect(outcome.success).toBe(true);
    const logCall = mockedCreateHmisAuditLog.mock.calls[0][0];
    // Circular payload falls back to String(value) which is "[object Object]".
    expect(typeof logCall.payload).toBe('string');
    expect(logCall.payload).toBe('[object Object]');
  });
});
