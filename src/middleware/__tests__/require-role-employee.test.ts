/**
 * requireRole `employeeIds` — used for the Doctor Availability Before / After
 * (extend OPD hours) endpoint: admin, super_admin and four named employees.
 */

import type { Request, Response, NextFunction } from 'express';

const findUnique = jest.fn();
jest.mock('../../service/prisma-client', () => ({ __esModule: true, default: { user: { findUnique } } }));

import { requireRole } from '../require-role';
import { EXTRA_SLOT_EDITORS } from '../../api/extraslots/extra-slot-editors';

const guard = requireRole({ roles: ['admin'], employeeIds: EXTRA_SLOT_EDITORS });

const run = async (user: Record<string, unknown> | null) => {
  findUnique.mockResolvedValue(user);
  const res: any = {};
  res.status = jest.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn().mockReturnValue(res);
  const next = jest.fn() as unknown as NextFunction;
  await guard({ user: { id: 7 } } as unknown as Request, res as Response, next);
  return { allowed: (next as jest.Mock).mock.calls.length === 1, status: res.statusCode };
};

describe('Before / After extension permission', () => {
  it('has exactly the agreed employees', () => {
    expect(EXTRA_SLOT_EDITORS).toEqual(['JMRH370', 'JMRH124', 'JMRH356', 'JMRH575', 'JMRH519']);
  });

  it.each(['JMRH370', 'JMRH124', 'JMRH356', 'JMRH575', 'JMRH519'])('allows %s even as a Tele Caller sub-admin', async (employeeId) => {
    expect(await run({ role: 'sub_admin', subAdminType: 'Tele Caller', adminType: null, employeeId })).toEqual({ allowed: true, status: undefined });
  });

  it('allows admin and super_admin', async () => {
    expect((await run({ role: 'admin', subAdminType: null, adminType: null, employeeId: 'X1' })).allowed).toBe(true);
    expect((await run({ role: 'super_admin', subAdminType: null, adminType: null, employeeId: 'admin01' })).allowed).toBe(true);
  });

  it('blocks other Tele Callers and JMRH178 with 403', async () => {
    expect(await run({ role: 'sub_admin', subAdminType: 'Tele Caller', adminType: null, employeeId: 'JMRH999' })).toEqual({ allowed: false, status: 403 });
    expect(await run({ role: 'sub_admin', subAdminType: 'Front Desk', adminType: null, employeeId: 'JMRH178' })).toEqual({ allowed: false, status: 403 });
  });

  it('blocks a user with no employee ID', async () => {
    expect((await run({ role: 'sub_admin', subAdminType: 'Tele Caller', adminType: null, employeeId: null })).status).toBe(403);
  });
});
