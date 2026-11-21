jest.mock('../prisma-client', () => ({ __esModule: true, default: {} }));

import { demoReviewerDoctorId, demoVisits, istDate, resetReviewerDemo } from '../demo-reset.service';

describe('demo reset guard', () => {
  it('is off unless DEMO_REVIEWER_DOCTOR_ID is a positive integer', () => {
    expect(demoReviewerDoctorId({})).toBeNull();
    expect(demoReviewerDoctorId({ DEMO_REVIEWER_DOCTOR_ID: '' })).toBeNull();
    expect(demoReviewerDoctorId({ DEMO_REVIEWER_DOCTOR_ID: 'abc' })).toBeNull();
    expect(demoReviewerDoctorId({ DEMO_REVIEWER_DOCTOR_ID: '0' })).toBeNull();
    expect(demoReviewerDoctorId({ DEMO_REVIEWER_DOCTOR_ID: '-4' })).toBeNull();
    expect(demoReviewerDoctorId({ DEMO_REVIEWER_DOCTOR_ID: ' 104 ' })).toBe(104);
  });

  it('refuses to run when the env is not set', async () => {
    const prev = process.env.DEMO_REVIEWER_DOCTOR_ID;
    delete process.env.DEMO_REVIEWER_DOCTOR_ID;
    await expect(resetReviewerDemo()).rejects.toThrow(/off/);
    if (prev !== undefined) process.env.DEMO_REVIEWER_DOCTOR_ID = prev;
  });
});

describe('istDate', () => {
  it('uses the India date, not UTC', () => {
    // 20 Nov 2026 19:00 UTC = 21 Nov 00:30 IST
    expect(istDate(new Date('2026-11-20T19:00:00Z'))).toBe('2026-11-21');
    expect(istDate(new Date('2026-11-20T18:00:00Z'))).toBe('2026-11-20');
  });
});

describe('demoVisits', () => {
  it('only uses the fake 91990000001x numbers and example.com emails', () => {
    const v = demoVisits();
    expect(v).toHaveLength(4);
    for (const x of v) {
      expect(x.phoneNumber).toMatch(/^91990000001[1-4]$/);
      expect(x.email).toMatch(/@example\.com$/);
    }
  });
});
