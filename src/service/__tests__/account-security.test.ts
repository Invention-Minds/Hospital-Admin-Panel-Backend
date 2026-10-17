import { authenticator } from 'otplib';
import { User } from '@prisma/client';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.MFA_ENC_KEY = 'test-mfa-key';

const update = jest.fn();
const findUnique = jest.fn();
jest.mock('../prisma-client', () => ({
  __esModule: true,
  default: { user: { update: (...a: unknown[]) => update(...a), findUnique: (...a: unknown[]) => findUnique(...a) } },
}));
jest.mock('../mailer.service', () => ({ sendOtpEmail: jest.fn().mockResolvedValue(true) }));

import {
  createCaptcha, getMfaSetup, isPasswordExpired, isValidDownloadGrant, nextLoginStep, normalizeEmail,
  passwordPolicyError, readChallenge, readDownloadTicket, signChallenge, signDownloadGrant, signDownloadTicket,
  verifyCaptcha, verifyMfaCode,
} from '../account-security.service';

const DAY = 24 * 60 * 60 * 1000;
const baseUser = (over: Partial<User> = {}): User => ({
  id: 1, username: 'u', password: 'x', role: 'sub_admin', isActive: true,
  email: 'a@b.com', emailVerifiedAt: new Date(), passwordChangedAt: new Date(),
  totpSecret: null, totpEnabledAt: null,
  ...over,
} as User);

describe('account-security policy', () => {
  it('expires passwords older than 90 days or never set', () => {
    expect(isPasswordExpired({ passwordChangedAt: null })).toBe(true);
    expect(isPasswordExpired({ passwordChangedAt: new Date(Date.now() - 91 * DAY) })).toBe(true);
    expect(isPasswordExpired({ passwordChangedAt: new Date(Date.now() - 89 * DAY) })).toBe(false);
  });

  it('orders login steps: MFA (admins only) → email → password', () => {
    expect(nextLoginStep(baseUser({ role: 'admin' }), false)).toBe('mfa_setup');
    expect(nextLoginStep(baseUser({ role: 'super_admin', totpEnabledAt: new Date() }), false)).toBe('mfa');
    expect(nextLoginStep(baseUser({ role: 'admin', emailVerifiedAt: null }), true)).toBe('email');
    expect(nextLoginStep(baseUser({ role: 'doctor', passwordChangedAt: null }), false)).toBe('password');
    expect(nextLoginStep(baseUser({ role: 'doctor' }), false)).toBeNull();
  });

  it('validates passwords and emails', () => {
    expect(passwordPolicyError('short1')).not.toBeNull();
    expect(passwordPolicyError('allletters')).not.toBeNull();
    expect(passwordPolicyError('abcd1234')).toBeNull();
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeEmail('nope')).toBeNull();
  });
});

describe('tokens', () => {
  it('download grant is bound to its user', () => {
    const { grant } = signDownloadGrant(7);
    expect(isValidDownloadGrant(grant, 7)).toBe(true);
    expect(isValidDownloadGrant(grant, 8)).toBe(false);
    expect(isValidDownloadGrant(signChallenge(7, false), 7)).toBe(false);
  });

  it('challenge token round-trips and rejects inactive users', async () => {
    findUnique.mockResolvedValueOnce(baseUser({ id: 3 }));
    const { user, mfaPassed } = await readChallenge(signChallenge(3, true));
    expect(user.id).toBe(3);
    expect(mfaPassed).toBe(true);

    findUnique.mockResolvedValueOnce(baseUser({ id: 3, isActive: false }));
    await expect(readChallenge(signChallenge(3, true))).rejects.toMatchObject({ status: 403 });
    await expect(readChallenge('garbage')).rejects.toMatchObject({ status: 401 });
  });
});

describe('download ticket + captcha', () => {
  it('ticket is bound to its user and log row', () => {
    const t = signDownloadTicket(7, 'log-1');
    expect(readDownloadTicket(t, 7)).toBe('log-1');
    expect(readDownloadTicket(t, 8)).toBeNull();
    expect(readDownloadTicket(signDownloadGrant(7).grant, 7)).toBeNull();
  });

  it('download grant lasts 60 minutes', () => {
    const { expiresAt } = signDownloadGrant(7);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000);
  });

  it('picture captcha renders a PNG grid, rejects wrong selections and is single use', async () => {
    const c = await createCaptcha(5);
    expect(c.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(c.grid).toBe(3);
    expect(c.prompt).toMatch(/^Select every tile that contains a /);
    expect(() => verifyCaptcha(c.captchaId, [], 5)).toThrow(/Incorrect/); // nothing selected
    expect(() => verifyCaptcha(c.captchaId, [0], 5)).toThrow(/expired/); // consumed by the first try
    const other = await createCaptcha(5);
    expect(() => verifyCaptcha(other.captchaId, [0], 6)).toThrow(/expired/); // other user's captcha
    const bad = await createCaptcha(5);
    expect(() => verifyCaptcha(bad.captchaId, [9], 5)).toThrow(/Incorrect/); // out of range
  });
});

describe('Google Authenticator', () => {
  it('stores an encrypted secret and enables MFA on the first valid code', async () => {
    update.mockReset();
    const setup = await getMfaSetup(baseUser({ role: 'admin' }));
    expect(setup.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const stored = update.mock.calls[0][0].data.totpSecret as string;
    expect(stored).not.toContain(setup.manualKey); // encrypted at rest

    const user = baseUser({ role: 'admin', totpSecret: stored });
    await expect(verifyMfaCode(user, '000000')).rejects.toMatchObject({ status: expect.any(Number) });
    await verifyMfaCode(user, authenticator.generate(setup.manualKey));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { totpEnabledAt: expect.any(Date) } }));
  });
});
