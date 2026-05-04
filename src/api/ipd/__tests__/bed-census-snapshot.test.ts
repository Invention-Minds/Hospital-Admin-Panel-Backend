/**
 * Sprint 4a Phase 1e — Bed census snapshot tests (8).
 *
 * Covers:
 *  Generator:
 *   1. Happy path — aggregates ward+bed state into N rows, writes success audit.
 *   2. Bed-type buckets — case-insensitive ICU/HDU counting.
 *   3. Idempotency — existing row on same day returns duplicate-blocked + audit action='snapshot_dup_blocked'.
 *   4. No wards — zero-row success (with 'no-wards-defined' note).
 *   5. Infra failure — catches thrown error, writes failed audit, returns 'failed'.
 *   6. Manual invocation — generateDailySnapshot('manual', 1) stamps createdById.
 *  Route handler:
 *   7. Invalid date format → 400.
 *   8. 404 when no snapshot exists for the requested date.
 */

import type { Request, Response } from 'express';

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    ipdWard: { findMany: jest.fn() },
    bedCensusSnapshot: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
  },
}));

jest.mock('../../hmis-sync/hmis-audit', () => ({
  createHmisAuditLog: jest.fn(),
}));

import prisma from '../../../service/prisma-client';
import { createHmisAuditLog } from '../../hmis-sync/hmis-audit';
import { generateDailySnapshot } from '../bed-census-snapshot';
import { getBedCensusSnapshot } from '../ward-management.controller';

const mockedPrisma = prisma as unknown as {
  ipdWard: { findMany: jest.Mock };
  bedCensusSnapshot: { findMany: jest.Mock; createMany: jest.Mock };
};
const mockedAudit = createHmisAuditLog as jest.MockedFunction<typeof createHmisAuditLog>;

const mkWard = (id: string, overrides: Partial<{
  wardName: string; wardCode: string; department: string; totalBeds: number;
  beds: Array<{ status: string; bedType: string }>;
}> = {}) => ({
  id,
  wardName: overrides.wardName ?? `Ward ${id}`,
  wardCode: overrides.wardCode ?? id.toUpperCase(),
  department: overrides.department ?? 'General Medicine',
  totalBeds: overrides.totalBeds ?? 10,
  beds: overrides.beds ?? [
    { status: 'occupied', bedType: 'general' },
    { status: 'available', bedType: 'general' },
    { status: 'maintenance', bedType: 'ICU' },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.bedCensusSnapshot.findMany.mockResolvedValue([]);
  mockedPrisma.bedCensusSnapshot.createMany.mockResolvedValue({ count: 0 });
  mockedPrisma.ipdWard.findMany.mockResolvedValue([]);
  mockedAudit.mockResolvedValue({
    id: 1, direction: 'push', module: 'bed-census', action: 'noop',
    payload: '{}', response: null, status: 'success', retryCount: 0, createdAt: new Date(),
  });
});

describe('generateDailySnapshot', () => {
  it('happy path — one row per ward, correct aggregates, success audit emitted', async () => {
    const wardA = mkWard('w1', {
      beds: [
        { status: 'occupied', bedType: 'general' },
        { status: 'occupied', bedType: 'general' },
        { status: 'available', bedType: 'ICU' },
        { status: 'maintenance', bedType: 'HDU' },
        { status: 'reserved', bedType: 'isolation' },
      ],
    });
    mockedPrisma.ipdWard.findMany.mockResolvedValueOnce([wardA]);
    // First call is the idempotency check → empty. Second call is post-create id fetch.
    mockedPrisma.bedCensusSnapshot.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 101 }]);
    mockedPrisma.bedCensusSnapshot.createMany.mockResolvedValueOnce({ count: 1 });

    const result = await generateDailySnapshot('cron');

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.wardCount).toBe(1);
    expect(result.rowIds).toEqual([101]);

    const createArgs = mockedPrisma.bedCensusSnapshot.createMany.mock.calls[0][0];
    expect(createArgs.data).toHaveLength(1);
    expect(createArgs.data[0]).toEqual(expect.objectContaining({
      wardId: 'w1',
      wardName: 'Ward w1',
      wardCode: 'W1',
      totalBeds: 10,
      occupiedBeds: 2,
      availableBeds: 1,
      maintenanceBeds: 1,
      reservedBeds: 1,
      generalBeds: 2,
      icuBeds: 1,
      hduBeds: 1,
      isolationBeds: 1,
      snapshotReason: 'cron',
      createdById: null,
    }));

    const successAudit = mockedAudit.mock.calls.find(
      (c) => c[0].action === 'snapshot_generated' && c[0].status === 'success'
    );
    expect(successAudit).toBeDefined();
    expect(successAudit![0].module).toBe('bed-census');
  });

  it('bed-type buckets — case-insensitive ICU/HDU counting', async () => {
    const ward = mkWard('w2', {
      beds: [
        { status: 'occupied', bedType: 'icu' },  // lowercase
        { status: 'occupied', bedType: 'ICU' },  // uppercase
        { status: 'occupied', bedType: 'hdu' },
        { status: 'occupied', bedType: 'HDU' },
      ],
    });
    mockedPrisma.ipdWard.findMany.mockResolvedValueOnce([ward]);
    mockedPrisma.bedCensusSnapshot.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1 }]);

    await generateDailySnapshot('cron');

    const row = mockedPrisma.bedCensusSnapshot.createMany.mock.calls[0][0].data[0];
    expect(row.icuBeds).toBe(2);
    expect(row.hduBeds).toBe(2);
  });

  it('duplicate-blocked — existing rows for today short-circuit with snapshot_dup_blocked audit', async () => {
    mockedPrisma.bedCensusSnapshot.findMany.mockResolvedValueOnce([
      { wardId: 'w1' },
      { wardId: 'w2' },
    ]);

    const result = await generateDailySnapshot('manual', 99);

    expect(result.status).toBe('duplicate-blocked');
    if (result.status !== 'duplicate-blocked') return;
    expect(result.conflictingWardIds).toEqual(['w1', 'w2']);
    expect(mockedPrisma.bedCensusSnapshot.createMany).not.toHaveBeenCalled();

    const dupAudit = mockedAudit.mock.calls[0][0];
    expect(dupAudit.action).toBe('snapshot_dup_blocked');
    expect(dupAudit.status).toBe('failed');
    expect(dupAudit.module).toBe('bed-census');
    const payload = JSON.parse(dupAudit.payload);
    expect(payload.conflictingWardCount).toBe(2);
    expect(payload.reason).toBe('manual');
  });

  it('no wards defined — writes zero-row success with no-wards-defined note', async () => {
    mockedPrisma.ipdWard.findMany.mockResolvedValueOnce([]);
    mockedPrisma.bedCensusSnapshot.findMany.mockResolvedValueOnce([]);

    const result = await generateDailySnapshot('cron');

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.wardCount).toBe(0);
    expect(result.rowIds).toEqual([]);
    expect(mockedPrisma.bedCensusSnapshot.createMany).not.toHaveBeenCalled();

    const audit = mockedAudit.mock.calls[0][0];
    expect(audit.action).toBe('snapshot_generated');
    expect(audit.status).toBe('success');
    expect(JSON.parse(audit.payload).note).toBe('no-wards-defined');
  });

  it('infra failure — catches throw, writes failed audit, returns failed', async () => {
    mockedPrisma.bedCensusSnapshot.findMany.mockRejectedValueOnce(new Error('connection reset'));

    const result = await generateDailySnapshot('cron');

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('connection reset');
    expect(mockedPrisma.bedCensusSnapshot.createMany).not.toHaveBeenCalled();

    const audit = mockedAudit.mock.calls[0][0];
    expect(audit.action).toBe('snapshot_failed');
    expect(audit.status).toBe('failed');
  });

  it('manual invocation — stamps createdById on every row', async () => {
    const ward = mkWard('w3', { beds: [{ status: 'occupied', bedType: 'general' }] });
    mockedPrisma.ipdWard.findMany.mockResolvedValueOnce([ward]);
    mockedPrisma.bedCensusSnapshot.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7 }]);

    const result = await generateDailySnapshot('manual', 42);

    expect(result.status).toBe('success');
    const row = mockedPrisma.bedCensusSnapshot.createMany.mock.calls[0][0].data[0];
    expect(row.createdById).toBe(42);
    expect(row.snapshotReason).toBe('manual');
  });
});

// --- Route handler ---------------------------------------------------------

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('getBedCensusSnapshot (route handler)', () => {
  it('400 when date query param is missing or malformed', async () => {
    const res = buildRes();
    await getBedCensusSnapshot({ query: {} } as Request, res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);

    const res2 = buildRes();
    await getBedCensusSnapshot({ query: { date: '2026/04/20' } } as unknown as Request, res2);
    expect((res2.status as jest.Mock)).toHaveBeenCalledWith(400);
  });

  it('404 when no snapshot rows exist for the requested date', async () => {
    mockedPrisma.bedCensusSnapshot.findMany.mockResolvedValueOnce([]);
    const res = buildRes();
    await getBedCensusSnapshot(
      { query: { date: '2026-04-15' } } as unknown as Request,
      res
    );
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(404);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.rows).toEqual([]);
  });
});
