/**
 * Discharge clearance — who may clear / reject which department.
 */

const prismaMock = { user: { findUnique: jest.fn() } };
jest.mock('../prisma-client', () => ({ __esModule: true, default: prismaMock }));
// discharge-clearance pulls in the diet lifecycle; only its types are used here.
jest.mock('../discharge-clearance', () => ({ DISCHARGE_DEPARTMENTS: ['OT', 'BILLING', 'NURSING', 'PHARMACY', 'LAB_RAD', 'DIET', 'MLC'] }));

import { canClearDepartment, clearableDepartments, ownDepartments } from '../discharge-clearance-roles';

const as = (role: string, subAdminType: string | null = null) => prismaMock.user.findUnique.mockResolvedValue({ role, subAdminType });
const ALL = ['OT', 'BILLING', 'NURSING', 'PHARMACY', 'LAB_RAD', 'DIET', 'MLC'] as const;

beforeEach(() => jest.clearAllMocks());

describe('canClearDepartment', () => {
  it('lets a nurse clear Nursing only', async () => {
    as('sub_admin', 'Nurse');
    expect(await canClearDepartment(1, 'NURSING')).toBe(true);
    expect(await canClearDepartment(1, 'BILLING')).toBe(false);
    expect(await canClearDepartment(1, 'DIET')).toBe(false);
  });

  it('lets dietitians and canteen clear Diet only', async () => {
    as('sub_admin', 'Dietician');
    expect(await canClearDepartment(1, 'DIET')).toBe(true);
    expect(await canClearDepartment(1, 'NURSING')).toBe(false);
    as('sub_admin', 'Canteen Staff');
    expect(await canClearDepartment(1, 'DIET')).toBe(true);
    expect(await canClearDepartment(1, 'PHARMACY')).toBe(false);
  });

  it('lets coordinators (super admin, managers, Discharge Coordinator) clear everything', async () => {
    for (const [role, sub] of [['super_admin', null], ['admin', null], ['sub_admin', 'Discharge Coordinator']] as const) {
      as(role, sub);
      for (const d of ALL) expect(await canClearDepartment(1, d)).toBe(true);
    }
  });

  it('refuses doctors, unknown users and anonymous calls', async () => {
    as('doctor');
    expect(await canClearDepartment(1, 'NURSING')).toBe(false);
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await canClearDepartment(1, 'NURSING')).toBe(false);
    expect(await canClearDepartment(undefined, 'NURSING')).toBe(false);
  });
});

describe('ownDepartments / clearableDepartments', () => {
  it('gives the app work list only the own job departments', async () => {
    as('sub_admin', 'Nurse');
    expect(await ownDepartments(1)).toEqual(['NURSING']);
    as('admin');
    expect(await ownDepartments(1)).toEqual([]); // coordinators use the web board
  });

  it('gives the board every department for a coordinator, own ones otherwise', async () => {
    as('sub_admin', 'Discharge Coordinator');
    expect(await clearableDepartments(1, ALL)).toEqual([...ALL]);
    as('sub_admin', 'OT Coordinator');
    expect(await clearableDepartments(1, ALL)).toEqual(['OT']);
  });
});
