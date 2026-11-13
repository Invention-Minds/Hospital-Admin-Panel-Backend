jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    investigationResult: { findMany: jest.fn() },
    ipdAdmission: { findMany: jest.fn() },
    doctor: { findMany: jest.fn() },
    whatsappQueryMessage: { findMany: jest.fn() },
    whatsappQuery: { findMany: jest.fn() },
    ipdDischarge: { findMany: jest.fn() },
  },
}));
jest.mock('../../../service/mobile-push', () => ({
  isPushEnabled: () => true,
  pushOnce: jest.fn().mockResolvedValue(true),
  PUSH_COPY: jest.requireActual('../../../service/mobile-push').PUSH_COPY,
}));
jest.mock('../../quality/quality-mobile.controller', () => ({ qualityCapabilitiesFor: jest.fn() }));

import prisma from '../../../service/prisma-client';
import { pushOnce, PUSH_COPY } from '../../../service/mobile-push';
import { dispatchCriticalResults, dispatchDischargeDrafts, dispatchPatientQueries } from '../mobile-push.cron';

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const push = pushOnce as jest.Mock;
const since = new Date('2026-11-12T00:00:00Z');

beforeEach(() => jest.clearAllMocks());

describe('lock-screen copy', () => {
  it('never needs patient details', () => {
    for (const c of Object.values(PUSH_COPY)) expect(`${c.title} ${c.body}`).not.toMatch(/\$\{|PRN|name/i);
  });
});

describe('dispatchCriticalResults', () => {
  it('alerts the ordering doctor and the admitting doctor once each', async () => {
    db.investigationResult.findMany.mockResolvedValue([{ id: 9, orderId: 4, prn: '100', order: { doctorId: 1 } }]);
    db.ipdAdmission.findMany.mockResolvedValue([{ prn: '100', admittingDoctorId: 2 }, { prn: '100', admittingDoctorId: 1 }]);
    db.doctor.findMany.mockResolvedValue([{ id: 1, userId: 11 }, { id: 2, userId: 22 }]);
    await dispatchCriticalResults(since);
    expect(push.mock.calls.map((c) => c[0].userId).sort()).toEqual([11, 22]);
    expect(push.mock.calls[0][0]).toMatchObject({ kind: 'critical_result', entityId: '9', path: '/reports/4' });
  });
});

describe('dispatchPatientQueries', () => {
  it('sends one alert per waiting episode, none after the doctor replied', async () => {
    db.whatsappQueryMessage.findMany.mockResolvedValue([{ queryId: 1 }, { queryId: 2 }]);
    db.whatsappQuery.findMany.mockResolvedValue([
      { id: 1, doctorId: 5, messages: [{ id: 10, direction: 'IN' }, { id: 11, direction: 'OUT' }, { id: 12, direction: 'IN' }, { id: 13, direction: 'IN' }] },
      { id: 2, doctorId: 5, messages: [{ id: 20, direction: 'IN' }, { id: 21, direction: 'OUT' }] },
    ]);
    db.doctor.findMany.mockResolvedValue([{ id: 5, userId: 55 }]);
    await dispatchPatientQueries(since);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatchObject({ userId: 55, kind: 'patient_query', entityId: '1:12', path: '/queries/1' });
  });
});

describe('dispatchDischargeDrafts', () => {
  it('alerts the admitting doctor of a fresh draft', async () => {
    db.ipdDischarge.findMany.mockResolvedValue([{ id: 'd1', admissionId: 'a1', admission: { admittingDoctorId: 3 } }]);
    db.doctor.findMany.mockResolvedValue([{ id: 3, userId: 33 }]);
    await dispatchDischargeDrafts(since);
    expect(push.mock.calls[0][0]).toMatchObject({ userId: 33, kind: 'discharge_ready', path: '/rounds/a1/discharge' });
  });
});
