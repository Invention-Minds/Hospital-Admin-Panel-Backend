import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../../service/prisma-client';
import { auditLog, auditLogAs } from '../../service/app-audit';
import {
  PASSWORD_MAX_AGE_DAYS, SecurityError, maskEmail, normalizeEmail, passwordPolicyError, requiresMfa, sendEmailOtp, verifyEmailOtp,
} from '../../service/account-security.service';

// The signed-in user's own account (the app's Profile screen; usable by the
// web too): details, change email (code to the new address), change password
// (same rule as sign-in), and forgot-password by a code to the verified email.
// The existing /api/login endpoints are unchanged.

function fail(res: Response, error: unknown, label: string) {
  if (error instanceof SecurityError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(`[account] ${label} failed:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

const me = (req: Request) => (typeof req.user?.id === 'number' ? req.user.id : null);

/** Other phones signed in to this account (their refresh tokens) stop working. This phone's stays. */
async function signOutOtherPhones(userId: number, keepRefreshToken?: unknown) {
  await prisma.mobileRefreshToken.updateMany({
    where: { userId, revoked: false, ...(typeof keepRefreshToken === 'string' && keepRefreshToken ? { NOT: { token: keepRefreshToken } } : {}) },
    data: { revoked: true },
  });
}

/** GET /api/account/me */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = me(req);
    if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const u = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, fullName: true, role: true, adminType: true, subAdminType: true, employeeId: true, department: true,
        phoneNumber: true, designation: true, email: true, emailVerifiedAt: true, passwordChangedAt: true, totpEnabledAt: true,
      },
    });
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }
    const doctor = u.role === 'doctor'
      ? await prisma.doctor.findFirst({ where: { userId: id }, select: { name: true, phone_number: true, departmentName: true, qualification: true } })
      : null;
    const expiresAt = u.passwordChangedAt ? new Date(u.passwordChangedAt.getTime() + PASSWORD_MAX_AGE_DAYS * 86_400_000) : null;
    res.status(200).json({
      data: {
        id: u.id,
        name: doctor?.name ?? u.fullName ?? u.username,
        username: u.username,
        role: u.role,
        title: doctor?.qualification ?? u.designation ?? u.adminType ?? u.subAdminType ?? null,
        employeeId: u.employeeId,
        phone: doctor?.phone_number ?? u.phoneNumber,
        department: doctor?.departmentName ?? u.department,
        email: u.emailVerifiedAt ? u.email : null,
        mfa: { required: requiresMfa(u), enabled: !!u.totpEnabledAt },
        password: { changedAt: u.passwordChangedAt, expiresAt, maxAgeDays: PASSWORD_MAX_AGE_DAYS },
      },
    });
  } catch (error) {
    fail(res, error, 'getMe');
  }
};

/** POST /api/account/email/send { email } — a code to the NEW address. */
export const sendEmailChangeCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = me(req);
    if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const email = normalizeEmail(req.body?.email);
    if (!email) throw new SecurityError(400, 'Please enter a valid email address.');
    const taken = await prisma.user.findFirst({ where: { email, NOT: { id } }, select: { id: true } });
    if (taken) throw new SecurityError(409, 'This email is already linked to another account.');
    const { expiresAt } = await sendEmailOtp(id, 'verify_email', email);
    res.status(200).json({ data: { sentTo: maskEmail(email), expiresAt } });
  } catch (error) {
    fail(res, error, 'sendEmailChangeCode');
  }
};

/** POST /api/account/email/verify { otp } — the address the code went to becomes the account email. */
export const verifyEmailChange = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = me(req);
    if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const email = await verifyEmailOtp(id, 'verify_email', req.body?.otp);
    const taken = await prisma.user.findFirst({ where: { email, NOT: { id } }, select: { id: true } });
    if (taken) throw new SecurityError(409, 'This email is already linked to another account.');
    const before = await prisma.user.findUnique({ where: { id }, select: { email: true } });
    await prisma.user.update({ where: { id }, data: { email, emailVerifiedAt: new Date() } });
    await auditLog(req, { module: 'security', action: 'EMAIL_CHANGE', entityType: 'User', entityId: id, payload: { from: before?.email ? maskEmail(before.email) : null, to: maskEmail(email) } });
    res.status(200).json({ data: { email } });
  } catch (error) {
    fail(res, error, 'verifyEmailChange');
  }
};

/** POST /api/account/password { currentPassword, newPassword, refreshToken? } */
export const changeMyPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = me(req);
    if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { currentPassword, newPassword, refreshToken } = req.body ?? {};
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, password: true, username: true } });
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }
    if (typeof currentPassword !== 'string' || !bcrypt.compareSync(currentPassword, u.password)) {
      throw new SecurityError(400, 'Your current password is not right.');
    }
    const policy = passwordPolicyError(newPassword);
    if (policy) throw new SecurityError(400, policy);
    if (bcrypt.compareSync(newPassword, u.password)) throw new SecurityError(400, 'Your new password must be different from the current one.');
    await prisma.user.update({ where: { id }, data: { password: bcrypt.hashSync(newPassword, 10), passwordChangedAt: new Date(), updatedBy: u.username } });
    await signOutOtherPhones(id, refreshToken);
    await auditLog(req, { module: 'security', action: 'PASSWORD_CHANGE', entityType: 'User', entityId: id, payload: { via: 'account' } });
    res.status(200).json({ data: { changedAt: new Date() } });
  } catch (error) {
    fail(res, error, 'changeMyPassword');
  }
};

// ── Forgot password (signed out) ──────────────────────────────────────────

const RESET_TTL = '15m';
type ResetPayload = { id: number; purpose: 'password_reset' };

/** Same lookup as sign-in: 10/12-digit number → doctor/therapist phone, anything else → employee ID. */
async function findAccount(identifier: string): Promise<{ id: number; email: string | null; emailVerifiedAt: Date | null; isActive: boolean } | null> {
  let id = identifier.replace(/[\s+-]/g, '');
  let userId: number | null = null;
  if (/^\d+$/.test(id) && (id.length === 10 || (id.length === 12 && id.startsWith('91')))) {
    if (id.length === 10) id = `91${id}`;
    const doc = await prisma.doctor.findFirst({ where: { phone_number: id }, select: { userId: true } });
    const ther = doc?.userId ? null : await prisma.therapist.findFirst({ where: { phoneNumber: id.slice(2) }, select: { userId: true } });
    userId = doc?.userId ?? ther?.userId ?? null;
  } else {
    const u = await prisma.user.findUnique({ where: { employeeId: identifier.trim() }, select: { id: true } });
    userId = u?.id ?? null;
  }
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true, isActive: true } });
}

const GENERIC = 'If this account has a verified email, a 6-digit code is on its way to it. It may take a minute — check spam too.';

/**
 * POST /api/account/forgot/start { identifier } — always answers the same way
 * (whether or not the account exists or has an email), so the screen can't be
 * used to discover accounts. Returns a short-lived reset token for step 2.
 */
export const forgotStart = async (req: Request, res: Response): Promise<void> => {
  try {
    const identifier = String(req.body?.identifier ?? '').trim();
    if (!identifier) throw new SecurityError(400, 'Enter your phone number or employee ID.');
    const acct = await findAccount(identifier);
    const usable = acct && acct.isActive !== false && acct.email && acct.emailVerifiedAt;
    if (usable) {
      try {
        await sendEmailOtp(acct.id, 'reset_password', acct.email!);
      } catch (e) {
        // Throttled / mail down: still the generic answer, but log it.
        console.warn('[account] forgot-password code not sent:', (e as Error).message);
      }
    }
    void auditLogAs(req, { id: usable ? acct.id : null, username: null }, { module: 'security', action: 'PASSWORD_RESET_REQUEST', payload: { found: !!usable } });
    const token = jwt.sign({ id: usable ? acct.id : 0, purpose: 'password_reset' } satisfies ResetPayload, process.env.JWT_SECRET as string, { algorithm: 'HS256', expiresIn: RESET_TTL });
    res.status(200).json({ data: { message: GENERIC, token } });
  } catch (error) {
    fail(res, error, 'forgotStart');
  }
};

/** POST /api/account/forgot/finish { token, otp, newPassword } — then the person signs in as usual. */
export const forgotFinish = async (req: Request, res: Response): Promise<void> => {
  try {
    let p: ResetPayload;
    try {
      p = jwt.verify(String(req.body?.token ?? ''), process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as ResetPayload;
    } catch {
      throw new SecurityError(401, 'This reset has expired. Start again.');
    }
    if (p.purpose !== 'password_reset') throw new SecurityError(401, 'Invalid reset. Start again.');
    if (!p.id) throw new SecurityError(400, 'That code is not right. Check it, or ask IT to reset your password.');
    const policy = passwordPolicyError(req.body?.newPassword);
    if (policy) throw new SecurityError(400, policy);
    await verifyEmailOtp(p.id, 'reset_password', req.body?.otp);
    const u = await prisma.user.findUnique({ where: { id: p.id }, select: { id: true, username: true, password: true, isActive: true } });
    if (!u || u.isActive === false) throw new SecurityError(403, 'This account is inactive. Contact the administrator.');
    if (bcrypt.compareSync(req.body.newPassword, u.password)) throw new SecurityError(400, 'Your new password must be different from the old one.');
    await prisma.user.update({ where: { id: u.id }, data: { password: bcrypt.hashSync(req.body.newPassword, 10), passwordChangedAt: new Date(), updatedBy: u.username } });
    await signOutOtherPhones(u.id);
    void auditLogAs(req, { id: u.id, username: u.username }, { module: 'security', action: 'PASSWORD_RESET', entityType: 'User', entityId: u.id, payload: { via: 'email-code' } });
    res.status(200).json({ data: { reset: true } });
  } catch (error) {
    fail(res, error, 'forgotFinish');
  }
};
