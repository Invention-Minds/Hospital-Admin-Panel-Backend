/**
 * GET /api/patients/search — as-you-type PRN lookup for booking forms.
 *
 * Matches the typed digits anywhere in the PRN (as the old client-side filter
 * did), ranks exact > starts-with > contains, caps the result, and returns only
 * the fields the form fills in.
 */

import type { Request, Response } from 'express';

const patientDetailsMock = { findMany: jest.fn() };

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({ patientDetails: patientDetailsMock })),
}));
jest.mock('../patient-helper', () => ({
  generatePRN: jest.fn(),
  syncPatientToHmis: jest.fn(),
}));

import { PatientController } from '../patient.controller';

const PRNS = [5423, 1042, 42, 10420, 4210, 777, 142, 99042];
const fullRow = (prn: number) => ({
  prn,
  name: `Patient ${prn}`,
  mobileNo: `90000${prn}`,
  age: '30',
  gender: 'female',
  email: `p${prn}@x.in`,
});

beforeEach(() => {
  jest.clearAllMocks();
  // Emulates Prisma: prn-only scan, then `where prn in` with a narrow select.
  patientDetailsMock.findMany.mockImplementation(async (args: any) => {
    if (!args?.where) return PRNS.map((prn) => ({ prn }));
    const wanted: number[] = args.where.prn.in;
    // DB order is not the ranking order — the repository must re-sort.
    return PRNS.filter((p) => wanted.includes(p)).map((prn) => {
      const row: any = fullRow(prn);
      return Object.fromEntries(Object.keys(args.select).map((k) => [k, row[k]]));
    });
  });
});

const run = async (query: Record<string, string>) => {
  const controller = new PatientController();
  const res: any = {};
  res.status = jest.fn().mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn().mockImplementation((body: any) => { res.body = body; return res; });
  await controller.searchPatients({ query } as unknown as Request, res as Response);
  return res;
};

describe('PatientController.searchPatients', () => {
  it('matches the typed digits anywhere in the PRN, best matches first', async () => {
    const res = await run({ q: '42' });

    expect(res.statusCode).toBe(200);
    // exact 42 → starts-with 4210 → contains, shorter/lower first.
    expect(res.body.map((p: any) => p.prn)).toEqual([42, 4210, 142, 1042, 5423, 10420, 99042]);
  });

  it('returns only the fields the booking form uses', async () => {
    const res = await run({ q: '777' });

    expect(res.body).toEqual([
      { prn: 777, name: 'Patient 777', mobileNo: '90000777', age: '30', gender: 'female', email: 'p777@x.in' },
    ]);
    const detailQuery = patientDetailsMock.findMany.mock.calls[1][0];
    expect(Object.keys(detailQuery.select).sort()).toEqual(['age', 'email', 'gender', 'mobileNo', 'name', 'prn']);
  });

  it('reads only the prn column for the scan', async () => {
    await run({ q: '42' });

    expect(patientDetailsMock.findMany.mock.calls[0][0]).toEqual({ select: { prn: true } });
  });

  it('caps results at 20 by default and at 50 when a larger limit is asked for', async () => {
    const many = Array.from({ length: 80 }, (_, i) => 1000 + i);
    patientDetailsMock.findMany.mockImplementation(async (args: any) =>
      !args?.where ? many.map((prn) => ({ prn })) : args.where.prn.in.map((prn: number) => ({ prn })),
    );

    expect((await run({ q: '1' })).body).toHaveLength(20);
    expect((await run({ q: '1', limit: '500' })).body).toHaveLength(50);
    expect((await run({ q: '1', limit: '5' })).body).toHaveLength(5);
  });

  it('returns an empty list without touching the DB for a blank query', async () => {
    const res = await run({ q: '  ' });

    expect(res.body).toEqual([]);
    expect(patientDetailsMock.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when nothing matches, without a second query', async () => {
    const res = await run({ q: '31337' });

    expect(res.body).toEqual([]);
    expect(patientDetailsMock.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects non-numeric input', async () => {
    const res = await run({ q: 'ab12' });

    expect(res.statusCode).toBe(400);
    expect(patientDetailsMock.findMany).not.toHaveBeenCalled();
  });
});
