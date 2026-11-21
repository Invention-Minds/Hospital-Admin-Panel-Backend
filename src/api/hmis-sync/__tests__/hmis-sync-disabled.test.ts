/**
 * HMIS sync switched off (HMIS_SYNC_ENABLED not 'true'): no HMIS call is made,
 * one 'skipped' audit row is written, and callers get success:false.
 */
const createHmisAuditLog = jest.fn().mockResolvedValue({ id: 77 });
jest.mock('../hmis-audit', () => ({ createHmisAuditLog }));

describe('syncWithHmis — switched off', () => {
  let syncWithHmis: typeof import('../hmis-sync-wrapper').syncWithHmis;

  beforeAll(() => {
    const prev = process.env.HMIS_SYNC_ENABLED;
    delete process.env.HMIS_SYNC_ENABLED;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      syncWithHmis = require('../hmis-sync-wrapper').syncWithHmis;
    });
    process.env.HMIS_SYNC_ENABLED = prev;
  });

  it('skips the HMIS call and records a skipped audit row', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'H1' });
    const outcome = await syncWithHmis({
      direction: 'push',
      module: 'ipd',
      entityType: 'admission',
      action: 'create',
      payload: { admissionId: 'A1' },
      operation,
      swallowErrors: false,
    });

    expect(operation).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ success: false, attempts: 0, auditLogId: 77 });
    expect(outcome.error?.code).toBe('HMIS_SYNC_DISABLED');
    expect(createHmisAuditLog).toHaveBeenCalledTimes(1);
    expect(createHmisAuditLog.mock.calls[0][0]).toMatchObject({ status: 'skipped', module: 'ipd', action: 'create' });
  });
});
