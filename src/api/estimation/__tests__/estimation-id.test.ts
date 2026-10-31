/**
 * Estimation ID numbering: "JMRH FY<financial year> - NNNN", where the running
 * number restarts at 0001 every 1 April (IST).
 */

const mockPrisma = {
  estimationDetails: { findFirst: jest.fn() },
};
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import { currentFiscalYear, nextEstimationId } from '../estimation.controller';

const at = (iso: string) => new Date(iso);

describe('currentFiscalYear', () => {
  it.each([
    ['2026-10-31T10:00:00+05:30', '2026/27'],
    ['2027-03-31T23:59:00+05:30', '2026/27'],
    ['2027-04-01T00:01:00+05:30', '2027/28'],
    ['2026-03-31T19:00:00Z', '2026/27'], // 1 Apr 00:30 IST
  ])('%s -> %s', (iso, fy) => expect(currentFiscalYear(at(iso))).toBe(fy));
});

describe('nextEstimationId', () => {
  beforeEach(() => mockPrisma.estimationDetails.findFirst.mockReset());

  it('starts the financial year at 0001', async () => {
    mockPrisma.estimationDetails.findFirst.mockResolvedValue(null);
    await expect(nextEstimationId(at('2026-11-01T10:00:00+05:30'))).resolves.toBe('JMRH FY2026/27 - 0001');
    expect(mockPrisma.estimationDetails.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { estimationId: { startsWith: 'JMRH FY2026/27 - ' } } }),
    );
  });

  it('continues from the last number in the same financial year', async () => {
    mockPrisma.estimationDetails.findFirst.mockResolvedValue({ estimationId: 'JMRH FY2026/27 - 0041' });
    await expect(nextEstimationId(at('2027-02-10T10:00:00+05:30'))).resolves.toBe('JMRH FY2026/27 - 0042');
  });

  it('goes past 9999 without breaking', async () => {
    mockPrisma.estimationDetails.findFirst.mockResolvedValue({ estimationId: 'JMRH FY2026/27 - 9999' });
    await expect(nextEstimationId(at('2027-02-10T10:00:00+05:30'))).resolves.toBe('JMRH FY2026/27 - 10000');
  });

  it('restarts on 1 April', async () => {
    mockPrisma.estimationDetails.findFirst.mockResolvedValue(null);
    await expect(nextEstimationId(at('2027-04-01T09:00:00+05:30'))).resolves.toBe('JMRH FY2027/28 - 0001');
  });
});
