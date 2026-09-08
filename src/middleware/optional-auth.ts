import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Best-effort authentication for routes that must stay public.
 *
 * `authenticateToken` (middleware.ts) rejects anything without a valid token.
 * Some routes can't do that — POST /appointments accepts anonymous bookings
 * from the public website — but when the caller IS a logged-in staff member
 * the admin panel still sends `Authorization: Bearer <token>` (see the
 * frontend auth.interceptor), and we want that identity for the audit trail
 * rather than recording every front-desk booking as "unknown".
 *
 * So: decode the token when one is present and valid, attach `req.user`, and
 * otherwise continue untouched. This NEVER rejects a request and NEVER gates
 * on maintenance mode — behaviour for anonymous callers is unchanged.
 *
 * Do not use this to protect anything. Handlers that need a guaranteed
 * identity must keep using `authenticateToken`.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    next();
    return;
  }

  jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }, (err: any, user: any) => {
    // An invalid/expired token is treated exactly like no token at all —
    // the request proceeds anonymously instead of failing.
    if (!err && user) {
      req.user = user;
    }
    next();
  });
};
