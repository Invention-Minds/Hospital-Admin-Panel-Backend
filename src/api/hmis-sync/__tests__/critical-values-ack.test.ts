/**
 * Sprint 4a Phase 1d — critical-values ack endpoint tests.
 *
 * Covers:
 *   1. POST ack without auth → 401 (authenticateToken rejects).
 *   2. POST ack with auth → acknowledgedBy derived from JWT; any body-
 *      supplied acknowledgedBy is IGNORED (impersonation loophole closed).
 */

import type { Request, Response, NextFunction } from 'express';

// Mock authenticateToken — per-test control over whether it populates req.user
// and/or short-circuits with 401. Same pattern as Phase 1b audit-guard tests.
const mockAuth = jest.fn<void, [Request, Response, NextFunction]>();
jest.mock('../../../middleware/middleware', () => ({
  authenticateToken: (req: Request, res: Response, next: NextFunction) =>
    mockAuth(req, res, next),
}));

// Mock acknowledgeAlertById — don't touch the in-memory Map from the real module.
const mockAck = jest.fn<boolean, [string, string]>();
jest.mock('../critical-value-sse', () => ({
  subscribeToCriticalValues: jest.fn(),
  getActiveUsers: jest.fn(() => []),
  broadcastCriticalValueAlert: jest.fn(),
  getAlertBuffer: jest.fn(() => []),
  getAlertAcknowledgments: jest.fn(() => new Map()),
  acknowledgeAlertById: (id: string, user: string) => mockAck(id, user),
}));

import router from '../critical-values.routes';

// ---- Supertest-free router driver: build req/res, locate + run the route ----

type RouteHandler = (req: Request, res: Response, next: NextFunction) => void;

/**
 * Dig into the express Router's internal `stack` to find the route + middleware
 * chain registered for a POST path. Returns the sequence of handlers
 * (middlewares + terminal handler) that will run for that route.
 */
function getRouteHandlers(path: string, method: 'post' | 'get'): RouteHandler[] {
  const layers = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ method: string; handle: RouteHandler }> } }> }).stack;
  for (const layer of layers) {
    if (layer.route?.path === path) {
      return layer.route.stack
        .filter((s) => s.method === method)
        .map((s) => s.handle);
    }
  }
  throw new Error(`No ${method.toUpperCase()} route for ${path}`);
}

async function runHandlers(
  handlers: RouteHandler[],
  req: Request,
  res: Response
): Promise<void> {
  for (const handler of handlers) {
    let nextCalled = false;
    await new Promise<void>((resolve) => {
      const next = (_err?: unknown) => {
        nextCalled = true;
        resolve();
      };
      // If the handler returns a promise or is sync + calls next synchronously,
      // we resolve via next; otherwise we rely on res.status being called.
      const maybePromise = handler(req, res, next as NextFunction) as unknown;
      const isThenable =
        maybePromise != null &&
        typeof (maybePromise as { then?: unknown }).then === 'function';
      if (isThenable) {
        (maybePromise as Promise<unknown>).then(() => {
          if (!nextCalled) resolve();
        });
      } else if (!nextCalled) {
        resolve();
      }
    });
    // If a handler sent a response without calling next, stop the chain.
    if ((res.status as jest.Mock).mock.calls.length > 0 && !nextCalled) return;
  }
}

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({
    params: { alertId: 'alert-A' },
    body: {},
    headers: {},
    ...overrides,
  }) as unknown as Request;

const buildRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.sendStatus = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /alerts/:alertId/acknowledge — Phase 1d auth', () => {
  it('returns 401 when authenticateToken rejects (no token)', async () => {
    // Middleware short-circuits: sends 401, does NOT call next.
    mockAuth.mockImplementationOnce((_req, res, _next) => {
      (res as Response).sendStatus(401);
    });

    const handlers = getRouteHandlers('/alerts/:alertId/acknowledge', 'post');
    const req = buildReq({ body: { acknowledgedBy: 'attacker-impersonating' } });
    const res = buildRes();

    await runHandlers(handlers, req, res);

    expect((res.sendStatus as jest.Mock)).toHaveBeenCalledWith(401);
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('acknowledges with JWT-derived username, IGNORING any body-supplied acknowledgedBy', async () => {
    // Middleware populates req.user from valid JWT.
    mockAuth.mockImplementationOnce((req, _res, next) => {
      (req as Request & { user: { id: number; username: string } }).user = {
        id: 42,
        username: 'alice',
      };
      (next as NextFunction)();
    });
    mockAck.mockReturnValueOnce(true);

    const handlers = getRouteHandlers('/alerts/:alertId/acknowledge', 'post');
    const req = buildReq({
      params: { alertId: 'alert-B' },
      // Attacker tries to impersonate "admin" via the body.
      body: { acknowledgedBy: 'admin' },
    });
    const res = buildRes();

    await runHandlers(handlers, req, res);

    // Server derived identity from req.user.username, not from req.body.acknowledgedBy.
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledWith('alert-B', 'alice'); // <-- NOT 'admin'
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.data.acknowledgedBy).toBe('alice');
  });
});
