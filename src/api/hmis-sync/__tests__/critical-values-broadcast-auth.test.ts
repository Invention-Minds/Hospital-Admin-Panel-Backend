/**
 * Sprint 4b.2 — /critical-values/broadcast now requires authenticateToken.
 * Previously unauthenticated; anyone could fire fake critical-value alerts.
 *
 * We verify the middleware chain by introspecting the Express router stack
 * (matches the 4a Phase 1d pattern of asserting middleware presence without
 * spinning up supertest).
 */

jest.mock('../critical-value-sse', () => ({
  subscribeToCriticalValues: jest.fn(),
  getActiveUsers: jest.fn(() => []),
  broadcastCriticalValueAlert: jest.fn().mockResolvedValue(undefined),
  getAlertBuffer: jest.fn(() => []),
  getAlertAcknowledgments: jest.fn(() => new Map()),
  acknowledgeAlertById: jest.fn(),
}));

jest.mock('../../../service/prisma-client', () => ({
  __esModule: true,
  default: {
    maintenance: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

import criticalValuesRouter from '../critical-values.routes';
import { authenticateToken } from '../../../middleware/middleware';

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name: string; handle: Function }>;
  };
};

describe('Sprint 4b.2 — /broadcast route requires authenticateToken', () => {
  it('POST /broadcast middleware stack includes authenticateToken', () => {
    const layers = (criticalValuesRouter as unknown as { stack: Layer[] }).stack;
    const broadcastLayer = layers.find(
      (l) => l.route?.path === '/broadcast' && l.route.methods.post === true
    );

    expect(broadcastLayer).toBeDefined();
    expect(broadcastLayer!.route!.stack.length).toBeGreaterThan(1); // handler + auth middleware

    const handleNames = broadcastLayer!.route!.stack.map((s) => s.handle);
    expect(handleNames).toContain(authenticateToken);
  });

  it('POST /stream (existing public route) does NOT have authenticateToken', () => {
    // Sanity check: we didn't accidentally lock down /stream (SSE connect),
    // which historically has its own userId-from-query handshake.
    const layers = (criticalValuesRouter as unknown as { stack: Layer[] }).stack;
    const streamLayer = layers.find(
      (l) => l.route?.path === '/stream' && l.route.methods.get === true
    );
    expect(streamLayer).toBeDefined();
    const handles = streamLayer!.route!.stack.map((s) => s.handle);
    expect(handles).not.toContain(authenticateToken);
  });
});
