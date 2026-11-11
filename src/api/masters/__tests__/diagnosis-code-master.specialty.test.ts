/**
 * Diagnosis Codes master — specialty tag (e.g. ophthalmology codes shown in the
 * eye prescription diagnosis search).
 */
import type { Request, Response } from 'express';

const mockPrisma = {
  diagnosisCodeMaster: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
};
jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: mockPrisma }));

import { createDiagnosisMaster, listDiagnosisMaster, updateDiagnosisMaster } from '../diagnosis-code-master.controller';

function res() {
  const r: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  r.status = jest.fn((code: number) => { r.statusCode = code; return r as Response; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r as Response; });
  return r;
}
const req = (parts: Partial<Request>) => ({ query: {}, params: {}, body: {}, user: { id: 1, username: 'mrd' }, ...parts }) as unknown as Request;

beforeEach(() => jest.clearAllMocks());

describe('list', () => {
  it('filters to one specialty', async () => {
    mockPrisma.diagnosisCodeMaster.findMany.mockResolvedValue([]);
    await listDiagnosisMaster(req({ query: { category: 'icd', specialty: 'ophthalmology' } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.findMany.mock.calls[0][0].where).toMatchObject({ category: 'icd', specialty: 'ophthalmology' });
  });

  it('"general" means untagged codes', async () => {
    mockPrisma.diagnosisCodeMaster.findMany.mockResolvedValue([]);
    await listDiagnosisMaster(req({ query: { specialty: 'general' } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.findMany.mock.calls[0][0].where).toMatchObject({ specialty: null });
  });

  it('no specialty filter → all codes, as IPD / OT use it', async () => {
    mockPrisma.diagnosisCodeMaster.findMany.mockResolvedValue([]);
    await listDiagnosisMaster(req({ query: { category: 'icd' } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.findMany.mock.calls[0][0].where).not.toHaveProperty('specialty');
  });

  it('rejects an unknown specialty', async () => {
    const r = res();
    await listDiagnosisMaster(req({ query: { specialty: 'cardio' } }), r as Response);
    expect(r.statusCode).toBe(400);
    expect(mockPrisma.diagnosisCodeMaster.findMany).not.toHaveBeenCalled();
  });
});

describe('create / update', () => {
  it('saves the specialty on create', async () => {
    mockPrisma.diagnosisCodeMaster.create.mockResolvedValue({ id: 1 });
    await createDiagnosisMaster(req({ body: { category: 'icd', code: 'H36.0', description: 'Diabetic retinopathy', specialty: 'ophthalmology' } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.create.mock.calls[0][0].data).toMatchObject({ code: 'H36.0', specialty: 'ophthalmology' });
  });

  it('create without specialty → general', async () => {
    mockPrisma.diagnosisCodeMaster.create.mockResolvedValue({ id: 1 });
    await createDiagnosisMaster(req({ body: { category: 'icd', code: 'I10', description: 'Essential hypertension' } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.create.mock.calls[0][0].data.specialty).toBeNull();
  });

  it('rejects an unknown specialty on create', async () => {
    const r = res();
    await createDiagnosisMaster(req({ body: { category: 'icd', code: 'X', description: 'x', specialty: 'cardio' } }), r as Response);
    expect(r.statusCode).toBe(400);
    expect(mockPrisma.diagnosisCodeMaster.create).not.toHaveBeenCalled();
  });

  it('update can clear the tag back to general, and leaves it alone when not sent', async () => {
    mockPrisma.diagnosisCodeMaster.update.mockResolvedValue({ id: 5 });
    await updateDiagnosisMaster(req({ params: { id: '5' }, body: { specialty: null } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.update.mock.calls[0][0].data).toEqual({ specialty: null });

    await updateDiagnosisMaster(req({ params: { id: '5' }, body: { description: 'New text' } }), res() as Response);
    expect(mockPrisma.diagnosisCodeMaster.update.mock.calls[1][0].data).not.toHaveProperty('specialty');
  });
});
