/**
 * Sprint 2.5 Part B regression tests.
 *
 * Covers three wiring fixes:
 *   Fix 1 — hmis-sync.queue coerces HMIS orderId into InvestigationResult.orderId (Int).
 *   Fix 2 — hmis-sync.queue broadcasts critical results via
 *           createAlertFromInvestigationResult (not the old private stub).
 *   Fix 3 — hmis-sync.controller.labResultReadyWebhook broadcasts only when
 *           criticalFlag === true.
 */

import type { Request, Response } from 'express';

// ---- Mocks (hoisted by jest) -----------------------------------------------

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(() => ({ stop: jest.fn() })),
    getTasks: jest.fn(() => new Map()),
  },
}));

// Sprint 4b.6 — hmis-sync.controller now uses the singleton (same as the queue).
// One merged mock covers both code paths; the previous dual-mock is gone.
jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    investigationOrder: { findMany: jest.fn() },
    investigationResult: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    appointment: { update: jest.fn() },
    prescription: { findUnique: jest.fn() },
    ipdBed: { update: jest.fn() },
    ipdAdmission: { update: jest.fn() },
    hmisAuditLog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
    patientDetails: { findFirst: jest.fn() },
  },
}));

jest.mock('../hmis-client', () => ({
  pollLabResults: jest.fn(),
  pollRadiologyResults: jest.fn(),
  pollBedAvailability: jest.fn(),
}));

jest.mock('../hmis-audit', () => ({
  createHmisAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../critical-value-sse', () => ({
  createAlertFromInvestigationResult: jest.fn().mockResolvedValue(undefined),
}));

// ---- Imports after mocks ---------------------------------------------------

import cron from 'node-cron';
import prisma from '../../../service/prisma-client';
import { pollLabResults } from '../hmis-client';
import { createAlertFromInvestigationResult } from '../critical-value-sse';
import { hmisSyncQueue } from '../hmis-sync.queue';
import * as controller from '../hmis-sync.controller';

const cronScheduleMock = (cron.schedule as unknown) as jest.Mock;
const pollLab = pollLabResults as jest.MockedFunction<typeof pollLabResults>;
const broadcast = createAlertFromInvestigationResult as jest.MockedFunction<
  typeof createAlertFromInvestigationResult
>;
const investigationOrderFindMany = prisma.investigationOrder
  .findMany as unknown as jest.Mock;
const investigationResultFindFirst = prisma.investigationResult
  .findFirst as unknown as jest.Mock;
const investigationResultCreate = prisma.investigationResult
  .create as unknown as jest.Mock;
const investigationResultUpdate = prisma.investigationResult
  .update as unknown as jest.Mock;

// Lab-poll job is the first cron.schedule call in initializePollingJobs().
let labPollTick: () => Promise<void>;

beforeAll(() => {
  hmisSyncQueue.initializePollingJobs();
  labPollTick = cronScheduleMock.mock
    .calls[0][1] as unknown as () => Promise<void>;
});

beforeEach(() => {
  jest.clearAllMocks();

  investigationOrderFindMany.mockResolvedValue([{ id: 1 }]); // 1 pending order
  investigationResultFindFirst.mockResolvedValue(null);

  // Return a realistic Prisma row so Fix 2 can prove we pass the persisted shape.
  investigationResultCreate.mockImplementation(async (args: any) => ({
    id: 1001,
    orderId: args.data.orderId,
    prn: args.data.prn,
    testName: args.data.testName,
    department: args.data.department,
    result: args.data.result ?? null,
    unit: args.data.unit ?? null,
    referenceRange: args.data.referenceRange ?? null,
    criticalFlag: Boolean(args.data.criticalFlag),
    reportUrl: args.data.reportUrl ?? null,
    reportedAt: args.data.reportedAt ?? new Date(),
    hmisResultId: null,
    status: 'final',
    createdAt: new Date(),
  }));
  investigationResultUpdate.mockImplementation(async (args: any) => ({
    id: args.where.id,
    orderId: 42,
    prn: '12345',
    testName: 'Glucose',
    department: 'lab',
    result: args.data.result ?? null,
    unit: args.data.unit ?? null,
    referenceRange: args.data.referenceRange ?? null,
    criticalFlag: Boolean(args.data.criticalFlag),
    reportUrl: args.data.reportUrl ?? null,
    reportedAt: args.data.reportedAt ?? new Date(),
    hmisResultId: null,
    status: 'final',
    createdAt: new Date(),
  }));
});

// ---- Fix 1 ---------------------------------------------------------------

describe('Fix 1 — lab polling coerces orderId into InvestigationResult.orderId (Int)', () => {
  it('accepts numeric orderId and stores it as Int', async () => {
    pollLab.mockResolvedValue([
      {
        orderId: 42,
        prn: '12345',
        testName: 'Glucose',
        result: '150',
        criticalFlag: false,
      },
    ]);

    await labPollTick();

    expect(investigationResultFindFirst).toHaveBeenCalledWith({
      where: { orderId: 42 },
    });
    expect(investigationResultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 42 }),
      })
    );
    // orderId is a number — not a string
    const createArgs = investigationResultCreate.mock.calls[0][0];
    expect(typeof createArgs.data.orderId).toBe('number');
  });

  it('coerces numeric string "42" to Int 42', async () => {
    pollLab.mockResolvedValue([
      {
        orderId: '42',
        prn: '12345',
        testName: 'Glucose',
        result: '150',
        criticalFlag: false,
      },
    ]);

    await labPollTick();

    expect(investigationResultFindFirst).toHaveBeenCalledWith({
      where: { orderId: 42 },
    });
    expect(investigationResultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 42 }),
      })
    );
  });

  it('skips non-numeric orderId with a warning and does not write', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    pollLab.mockResolvedValue([
      {
        orderId: undefined,
        prn: '12345',
        testName: 'Glucose',
        result: '150',
        criticalFlag: false,
      },
    ]);

    await labPollTick();

    expect(investigationResultFindFirst).not.toHaveBeenCalled();
    expect(investigationResultCreate).not.toHaveBeenCalled();
    expect(investigationResultUpdate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('skipping result with non-numeric orderId')
    );

    warn.mockRestore();
  });
});

// ---- Fix 2 ---------------------------------------------------------------

describe('Fix 2 — lab polling broadcasts critical results via SSE helper', () => {
  it('calls createAlertFromInvestigationResult with the persisted row when criticalFlag=true', async () => {
    pollLab.mockResolvedValue([
      {
        orderId: 7,
        prn: '12345',
        testName: 'Potassium',
        result: '7.2',
        unit: 'mmol/L',
        referenceRange: '3.5-5.0',
        criticalFlag: true,
        reportUrl: 'http://example.com/report.pdf',
      },
    ]);

    await labPollTick();

    expect(broadcast).toHaveBeenCalledTimes(1);
    const arg = broadcast.mock.calls[0][0] as any;
    // Proof that we pass the full persisted row, including DB id.
    expect(arg.id).toBe(1001);
    expect(arg.orderId).toBe(7);
    expect(arg.prn).toBe('12345');
    expect(arg.testName).toBe('Potassium');
    expect(arg.criticalFlag).toBe(true);
    expect(arg.department).toBe('lab');
  });

  it('does NOT broadcast when the result is not critical', async () => {
    pollLab.mockResolvedValue([
      {
        orderId: 8,
        prn: '12345',
        testName: 'Glucose',
        result: '120',
        criticalFlag: false,
      },
    ]);

    await labPollTick();

    expect(broadcast).not.toHaveBeenCalled();
  });
});

// ---- Fix 3 ---------------------------------------------------------------

describe('Fix 3 — labResultReadyWebhook broadcasts only when criticalFlag=true', () => {
  // Sprint 4b.6 — controller now uses the singleton, same instance as the queue.
  const controllerPrisma = prisma as unknown as {
    investigationResult: { upsert: jest.Mock };
  };

  const makeReqRes = (body: Record<string, unknown>) => {
    const req = { body } as unknown as Request;
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    return { req, res, status, json };
  };

  beforeEach(() => {
    controllerPrisma.investigationResult.upsert.mockImplementation(
      async (args: any) => ({
        id: 2001,
        orderId: args.create.orderId,
        prn: args.create.prn,
        testName: args.create.testName,
        department: args.create.department,
        result: args.create.result ?? null,
        unit: args.create.unit ?? null,
        referenceRange: args.create.referenceRange ?? null,
        criticalFlag: Boolean(args.create.criticalFlag),
        reportUrl: args.create.reportUrl ?? null,
        reportedAt: args.create.reportedAt ?? new Date(),
        hmisResultId: null,
        status: 'final',
        createdAt: new Date(),
      })
    );
  });

  it('broadcasts when criticalFlag=true and passes the persisted row (id included)', async () => {
    const { req, res } = makeReqRes({
      prn: '12345',
      orderId: 42,
      testName: 'Potassium',
      result: '7.2',
      unit: 'mmol/L',
      referenceRange: '3.5-5.0',
      criticalFlag: true,
      reportUrl: 'http://example.com/report.pdf',
    });

    await controller.labResultReadyWebhook(req, res);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toMatchObject({
      id: 2001,
      orderId: 42,
      prn: '12345',
      testName: 'Potassium',
      criticalFlag: true,
      department: 'lab',
    });
  });

  it('does NOT broadcast when criticalFlag=false', async () => {
    const { req, res } = makeReqRes({
      prn: '12345',
      orderId: 42,
      testName: 'Glucose',
      result: '110',
      unit: 'mg/dL',
      referenceRange: '70-110',
      criticalFlag: false,
    });

    await controller.labResultReadyWebhook(req, res);

    expect(broadcast).not.toHaveBeenCalled();
  });
});
