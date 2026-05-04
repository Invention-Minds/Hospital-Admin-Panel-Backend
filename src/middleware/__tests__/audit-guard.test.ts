/**
 * Sprint 4a Phase 1b — audit-guard middleware tests.
 *
 * Covers the 401-on-no-actor contract + the happy-path pass-through.
 */

import type { Request, Response, NextFunction } from 'express';
import { requireClinicalActor, getClinicalActor, stripAuditFields } from '../audit-guard';

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const buildNext = (): jest.Mock & NextFunction => jest.fn() as jest.Mock & NextFunction;

describe('requireClinicalActor (middleware)', () => {
  it('passes through to next() when req.user.id is a positive integer', () => {
    const req = { user: { id: 42, username: 'alice' } } as Partial<Request> as Request;
    const res = buildRes();
    const next = buildNext();

    requireClinicalActor(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 with the contract body when req.user is missing', () => {
    const req = {} as Request;
    const res = buildRes();
    const next = buildNext();

    requireClinicalActor(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: 'Authentication required for clinical writes',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when req.user.id is non-numeric (string)', () => {
    const req = { user: { id: '42' } } as unknown as Request;
    const res = buildRes();
    const next = buildNext();

    requireClinicalActor(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when req.user.id is zero or negative', () => {
    const reqZero = { user: { id: 0 } } as Partial<Request> as Request;
    const reqNeg = { user: { id: -5 } } as Partial<Request> as Request;
    const resZ = buildRes();
    const resN = buildRes();

    requireClinicalActor(reqZero, resZ, buildNext());
    requireClinicalActor(reqNeg, resN, buildNext());

    expect((resZ.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((resN.status as jest.Mock)).toHaveBeenCalledWith(401);
  });
});

describe('getClinicalActor (inline variant)', () => {
  it('returns the numeric id when valid', () => {
    const req = { user: { id: 7, username: 'bob' } } as Partial<Request> as Request;
    const res = buildRes();

    const actorId = getClinicalActor(req, res);

    expect(actorId).toBe(7);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns null and sends 401 when req.user.id is missing', () => {
    const req = { user: { username: 'orphan' } } as unknown as Request;
    const res = buildRes();

    const actorId = getClinicalActor(req, res);

    expect(actorId).toBeNull();
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: 'Authentication required for clinical writes',
    });
  });
});

describe('stripAuditFields (Sprint 4b.1 helper)', () => {
  it('removes all 5 audit-attribution fields and preserves everything else', () => {
    const input = {
      createdBy: 'attacker',
      createdById: 999,
      createdAt: new Date('2020-01-01'),
      updatedBy: 'attacker',
      updatedById: 999,
      // Non-audit fields must survive.
      examinerName: 'Dr. B',
      injuries: 'abrasion',
      photoUrls: ['a.png', 'b.png'],
      status: 'documented',
      nested: { keep: true },
    };

    const clean = stripAuditFields(input);

    expect(clean).toEqual({
      examinerName: 'Dr. B',
      injuries: 'abrasion',
      photoUrls: ['a.png', 'b.png'],
      status: 'documented',
      nested: { keep: true },
    });
    expect(clean).not.toHaveProperty('createdBy');
    expect(clean).not.toHaveProperty('createdById');
    expect(clean).not.toHaveProperty('createdAt');
    expect(clean).not.toHaveProperty('updatedBy');
    expect(clean).not.toHaveProperty('updatedById');
    // Non-mutating: original input untouched.
    expect(input.createdBy).toBe('attacker');
  });
});
