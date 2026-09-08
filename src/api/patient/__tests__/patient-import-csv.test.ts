/**
 * Bulk CSV patient import.
 *
 * Covers the hand-rolled RFC 4180 parser (quotes, embedded commas/newlines,
 * BOM, CRLF) and the skip-existing-PRN rule: a PRN already in PatientDetails
 * is left untouched, only new rows are inserted.
 */

import type { Request, Response } from 'express';

const patientDetailsMock = {
  findMany: jest.fn(),
  createMany: jest.fn(),
  create: jest.fn(),
};

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: { patientDetails: patientDetailsMock },
}));

const generatePRNMock = jest.fn();
jest.mock('../patient-helper', () => ({
  generatePRN: () => generatePRNMock(),
  syncPatientToHmis: jest.fn(),
}));

jest.mock('../../../service/app-audit', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
}));

import { importPatientsCsv } from '../patient-import.controller';

const buildRes = () => {
  const res: Partial<Response> & { statusCode?: number; body?: any } = {};
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((payload: any) => {
    res.body = payload;
    return res;
  });
  return res as Response & { statusCode?: number; body?: any };
};

const buildReq = (csv: string, originalname = 'patients.csv'): Request =>
  ({
    file: { buffer: Buffer.from(csv, 'utf8'), originalname },
    user: { id: 7, username: 'reception1' },
    headers: {},
  } as unknown as Request);

const run = async (csv: string, originalname?: string) => {
  const res = buildRes();
  await importPatientsCsv(buildReq(csv, originalname), res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  patientDetailsMock.findMany.mockResolvedValue([]);
  patientDetailsMock.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  }));
  patientDetailsMock.create.mockResolvedValue({ id: 1 });
  generatePRNMock.mockResolvedValue(9000);
});

describe('importPatientsCsv', () => {
  it('inserts new rows and skips PRNs that already exist', async () => {
    patientDetailsMock.findMany.mockResolvedValue([{ prn: 1001 }]);

    const res = await run(['prn,name,mobileNo', '1001,Old Patient,9000000001', '1002,New Patient,9000000002'].join('\n'));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 2, created: 1, skipped: 1, failed: 0 });
    expect(res.body.skippedPrns).toEqual([1001]);

    const inserted = patientDetailsMock.createMany.mock.calls[0][0].data;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ prn: 1002, name: 'New Patient', mobileNo: '9000000002' });
  });

  it('never updates an existing patient', async () => {
    patientDetailsMock.findMany.mockResolvedValue([{ prn: 1001 }]);

    await run(['prn,name', '1001,Renamed Patient'].join('\n'));

    expect(patientDetailsMock.createMany).not.toHaveBeenCalled();
    expect(patientDetailsMock.create).not.toHaveBeenCalled();
  });

  it('parses quoted fields with commas, newlines and doubled quotes', async () => {
    const csv =
      'prn,name,address,diagnosis\r\n' +
      '1002,"Kumar, R.","12 Main St\nBengaluru","said ""stable"" on review"\r\n';

    const res = await run(csv);

    expect(res.statusCode).toBe(200);
    const inserted = patientDetailsMock.createMany.mock.calls[0][0].data;
    expect(inserted[0]).toMatchObject({
      name: 'Kumar, R.',
      address: '12 Main St\nBengaluru',
      diagnosis: 'said "stable" on review',
    });
  });

  it('strips a UTF-8 BOM from the first header', async () => {
    const res = await run('﻿prn,name\n1002,Asha\n');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ created: 1, failed: 0 });
    expect(patientDetailsMock.createMany.mock.calls[0][0].data[0]).toMatchObject({ prn: 1002, name: 'Asha' });
  });

  it('allocates PRNs for rows with a blank prn, avoiding PRNs used in the file', async () => {
    generatePRNMock.mockResolvedValue(9000);

    const res = await run(['prn,name', '9000,Explicit', ',Blank One', ',Blank Two'].join('\n'));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ created: 3, skipped: 0, failed: 0 });
    const prns = patientDetailsMock.createMany.mock.calls[0][0].data.map((r: any) => r.prn);
    expect(prns).toEqual([9000, 9001, 9002]);
  });

  it('skips a PRN repeated within the same file', async () => {
    const res = await run(['prn,name', '1002,First', '1002,Second'].join('\n'));

    expect(res.body).toMatchObject({ created: 1, skipped: 1 });
    expect(res.body.skippedPrns).toEqual([1002]);
  });

  it('reports unknown and DB-managed columns instead of writing them', async () => {
    const res = await run(['prn,name,createdBy,id,favouriteColour', '1002,Asha,hacker,55,blue'].join('\n'));

    expect(res.body.ignoredColumns).toEqual(expect.arrayContaining(['createdBy', 'id', 'favouriteColour']));
    const inserted = patientDetailsMock.createMany.mock.calls[0][0].data[0];
    expect(inserted.id).toBeUndefined();
    // createdBy comes from the token, never the file.
    expect(inserted.createdBy).toBe('reception1');
    expect(inserted.createdById).toBe(7);
  });

  it('coerces booleans and defaults source to "import"', async () => {
    const res = await run(['prn,name,foreignNational,verified', '1002,Asha,yes,false'].join('\n'));

    expect(res.body.failed).toBe(0);
    expect(patientDetailsMock.createMany.mock.calls[0][0].data[0]).toMatchObject({
      foreignNational: true,
      verified: false,
      source: 'import',
    });
  });

  it('fails a row with a bad prn or a missing name, without failing the file', async () => {
    const res = await run(['prn,name', 'ABC,Bad Prn', '1002,', '1003,Good'].join('\n'));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ created: 1, failed: 2 });
    expect(res.body.errors).toEqual([
      { row: 2, prn: null, reason: expect.stringContaining('prn must be a positive whole number') },
      { row: 3, prn: null, reason: 'name is required' },
    ]);
  });

  it('falls back to per-row inserts to pinpoint a failing row', async () => {
    patientDetailsMock.createMany.mockRejectedValue(new Error('chunk blew up'));
    patientDetailsMock.create
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error('Unique constraint failed on prn'));

    const res = await run(['prn,name', '1002,Ok Row', '1003,Bad Row'].join('\n'));

    expect(res.body).toMatchObject({ created: 1, failed: 1 });
    expect(res.body.errors[0]).toMatchObject({ row: 3, prn: 1003 });
  });

  it('rejects a file with no name column', async () => {
    const res = await run(['prn,mobileNo', '1002,9000000002'].join('\n'));

    expect(res.statusCode).toBe(400);
    expect(patientDetailsMock.createMany).not.toHaveBeenCalled();
  });

  it('rejects an xlsx upload with a clear message', async () => {
    const res = await run('prn,name\n1002,Asha', 'patients.xlsx');

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('save the sheet as CSV');
  });

  it('rejects a header-only file', async () => {
    const res = await run('prn,name\n\n');

    expect(res.statusCode).toBe(400);
  });
});
