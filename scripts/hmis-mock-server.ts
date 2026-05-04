/* eslint-disable no-console */
/**
 * HMIS Mock Server — dev-only.
 *
 * Stands up an Express server on port 9999 that pretends to be the hospital's
 * HMIS API. Returns deterministic mock IDs for every push so the
 * Docminds-side `HmisAuditLog` rows show `status='success'` and the
 * `hmisXxxId` columns get backfilled — making manual UI testing realistic
 * before real HMIS credentials are available.
 *
 * Usage:
 *   1.  npm run mock:hmis
 *   2.  set HMIS_BASE_URL=http://localhost:9999/api in .env
 *   3.  npm run start:dev (the backend)
 *   4.  Drive the UI; watch this terminal for incoming requests + the DB
 *       for `HmisAuditLog` rows with status='success'.
 *
 * NOT USED BY TESTS. Tests have their own jest mocks for hmis-client.
 * NOT IMPORTABLE FROM src/. This file lives in scripts/ and is only
 * referenced by the npm script `mock:hmis`.
 *
 * Inventory of paths covered (matches src/api/hmis-sync/hmis-client.ts):
 *   POST /api/patients                                — pushPatient
 *   POST /api/emergency/register                      — pushEmergencyToHmis
 *   POST /api/opd/assessment                          — pushOpdAssessment
 *   POST /api/investigation/order                     — pushInvestigationOrder
 *   POST /api/pharmacy/prescription                   — pushPrescription
 *   POST /api/adt/admission                           — pushIpdAdmission
 *   POST /api/adt/transfer                            — pushIpdTransfer
 *   POST /api/adt/discharge                           — pushIPDDischarge
 *   POST /api/pharmacy/ipd-prescription               — pushIpdPrescription
 *   POST /api/pharmacy/ipd-prescription/discontinue   — pushIpdPrescriptionDiscontinue
 *   POST /api/pharmacy/medication-administered        — pushIpdMedicationAdmin
 *   POST /api/mlc/register                            — pushMlcCase
 *   PUT  /api/mlc/:id                                 — pushMlcUpdate
 *   POST /api/lama/register                           — pushLamaCase
 *   PUT  /api/lama/:id                                — pushLamaUpdate
 *   POST /api/dama/register                           — pushDamaCase
 *   PUT  /api/dama/:id                                — pushDamaUpdate
 *   GET  /api/laboratory/results                      — pollLabResults    → []
 *   GET  /api/radiology/results                       — pollRadiologyResults → []
 *   GET  /api/beds/availability                       — pollBedAvailability → []
 *   GET  /api/master/:type                            — getMasterData → []
 *
 * Catch-all: any other POST/PUT/PATCH under /api/* returns the same shape
 * so the mock degrades gracefully if a new push path is added before this
 * inventory is updated.
 */

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const PORT = 9999;
const app = express();
app.use(express.json({ limit: '5mb' }));

// ---- Logging middleware ---------------------------------------------------

let requestSeq = 0;

const summarizeBody = (body: unknown): string => {
  if (body == null || typeof body !== 'object') return '';
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length === 0) return '{}';
  // Show 3-4 short keys + a count of the rest.
  const preview = keys.slice(0, 4).map((k) => {
    const v = (body as Record<string, unknown>)[k];
    if (v == null) return `${k}=null`;
    if (typeof v === 'string') return `${k}=${v.length > 30 ? v.slice(0, 27) + '…' : v}`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${v}`;
    return `${k}=<${typeof v}>`;
  });
  const remaining = keys.length - 4;
  return `{ ${preview.join(', ')}${remaining > 0 ? ` +${remaining} more` : ''} }`;
};

app.use((req: Request, _res: Response, next: NextFunction) => {
  requestSeq += 1;
  const stamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const summary = req.method === 'GET' ? '' : summarizeBody(req.body);
  console.log(`[${stamp}] #${String(requestSeq).padStart(3, '0')} ${req.method.padEnd(5)} ${req.originalUrl}  ${summary}`);
  next();
});

// ---- Deterministic mock-id generator --------------------------------------

/**
 * Derives a stable mock id from path + body so re-running the same request
 * returns the same id. Useful when the same record is pushed twice (e.g.,
 * register + lifecycle update on the same MLC case).
 */
const mockIdFor = (req: Request): string => {
  const moduleHint = (() => {
    // /api/mlc/register → MLC, /api/adt/admission → ADT, /api/pharmacy/ipd-prescription → PHARMACY, etc.
    const segments = req.path.split('/').filter(Boolean);
    return (segments[1] || segments[0] || 'unknown').toUpperCase().replace(/-/g, '_');
  })();
  const hash = crypto
    .createHash('sha1')
    .update(`${req.method}:${req.path}:${JSON.stringify(req.body ?? {})}`)
    .digest('hex')
    .slice(0, 8);
  return `MOCK-${moduleHint}-${hash}`;
};

// ---- Push response helpers ------------------------------------------------

const okPushResponse = (req: Request, _res: Response): Record<string, unknown> => {
  const id = mockIdFor(req);
  return {
    id,
    success: true,
    receivedAt: new Date().toISOString(),
    echoedPath: req.path,
  };
};

// ---- Push endpoints -------------------------------------------------------

// Auth header is read but not validated — log so we can confirm the backend
// is sending what we expect.
app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
  const auth = req.headers['authorization'];
  if (req.method !== 'GET' && !auth) {
    console.warn(`   ⚠ no Authorization header on ${req.method} ${req.path}`);
  }
  next();
});

// All push paths share the same response shape; the catch-all router below
// covers them. Listing them as explicit routes is documentation, not logic.
const PUSH_PATHS_POST = [
  '/api/patients',
  '/api/emergency/register',
  '/api/opd/assessment',
  '/api/investigation/order',
  '/api/pharmacy/prescription',
  '/api/adt/admission',
  '/api/adt/transfer',
  '/api/adt/discharge',
  '/api/pharmacy/ipd-prescription',
  '/api/pharmacy/ipd-prescription/discontinue',
  '/api/pharmacy/medication-administered',
  '/api/mlc/register',
  '/api/lama/register',
  '/api/dama/register',
];

for (const path of PUSH_PATHS_POST) {
  app.post(path, (req: Request, res: Response): void => {
    res.status(200).json(okPushResponse(req, res));
  });
}

// PUT routes for lifecycle updates with a path param.
app.put('/api/mlc/:hmisMlcId', (req: Request, res: Response): void => {
  res.status(200).json(okPushResponse(req, res));
});
app.put('/api/lama/:hmisLamaId', (req: Request, res: Response): void => {
  res.status(200).json(okPushResponse(req, res));
});
app.put('/api/dama/:hmisDamaId', (req: Request, res: Response): void => {
  res.status(200).json(okPushResponse(req, res));
});

// ---- Pull endpoints (kept quiet — return empty arrays / minimal payloads) -

app.get('/api/laboratory/results', (_req: Request, res: Response): void => {
  res.status(200).json({ results: [], total: 0 });
});

app.get('/api/radiology/results', (_req: Request, res: Response): void => {
  res.status(200).json({ results: [], total: 0 });
});

app.get('/api/beds/availability', (_req: Request, res: Response): void => {
  res.status(200).json({ wards: [], total: 0 });
});

app.get('/api/master/:type', (req: Request, res: Response): void => {
  res.status(200).json({ type: req.params.type, items: [] });
});

// ---- Health ---------------------------------------------------------------

app.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), totalRequests: requestSeq });
});

// ---- Catch-all (falls through here for any unknown POST/PUT/PATCH) --------

app.all('/api/*', (req: Request, res: Response): void => {
  if (req.method === 'GET') {
    res.status(200).json({ message: 'mock-default-get', path: req.path, items: [] });
    return;
  }
  res.status(200).json(okPushResponse(req, res));
});

// ---- Boot -----------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  HMIS mock server up on http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Set in your .env to point Docminds at this mock:');
  console.log(`    HMIS_BASE_URL=http://localhost:${PORT}/api`);
  console.log('    HMIS_API_KEY=test-key');
  console.log('');
  console.log('  Health probe:');
  console.log(`    curl http://localhost:${PORT}/health`);
  console.log('');
  console.log('  Watching for inbound requests…');
  console.log('');
});

const shutdown = (signal: string): void => {
  console.log(`\n[hmis-mock] ${signal} received — shutting down (handled ${requestSeq} requests)`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
