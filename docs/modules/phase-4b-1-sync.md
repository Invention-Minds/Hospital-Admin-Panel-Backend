# Phase 4b.1 — Update Attribution Full Pass · Sync Check

**Date:** 2026-04-20 · **Sprint:** 4b · Phase 4b.1.

Completes NABH MRD.1 update-side coverage deferred from 4a Phase 1b. Every
update on the 7 clinical models now stamps both `updatedBy` (username) and
`updatedById` (typed integer id) from the JWT — never from request body.

---

## Schema bundle — 12 new columns

Migration: [`20260420170000_update_attribution_bundle/migration.sql`](../../prisma/migrations/20260420170000_update_attribution_bundle/migration.sql)

| Model | New column(s) |
|---|---|
| DamaRecord | `updatedBy` + `updatedById` |
| IpdDischarge | `updatedBy` + `updatedById` |
| IpdMedicationLog | `updatedBy` + `updatedById` |
| IpdPrescription | `updatedById` (had `updatedBy` pre-4b) |
| IpdProgressNote | `updatedBy` + `updatedById` |
| LamaRecord | `updatedBy` + `updatedById` |
| MlcCase | `updatedById` (had `updatedBy` pre-4b) |

All 12 columns are **nullable**, no default. MySQL 8.0 INSTANT algorithm;
zero row rewrite. Pre-existing rows stay NULL until first update — meaningful
"never touched since enforcement started" state, not a bug.

Verification (recorded at execution time):
- Row counts **unchanged** across all 7 tables (parity check).
- `_prisma_migrations` 161 → 162 (+1).
- `INFORMATION_SCHEMA.COLUMNS` confirms all 14 expected `updatedBy`/`updatedById`
  columns present with `varchar(191) NULL` / `int NULL`, no defaults.

## stripAuditFields helper — 4b.1's server-identity defence

Added to [`src/middleware/audit-guard.ts`](../../src/middleware/audit-guard.ts):

```ts
export const stripAuditFields = <T extends Record<string, unknown>>(body: T): T => {
  if (body == null || typeof body !== 'object') return body;
  const clean = { ...body };
  delete (clean as Record<string, unknown>).createdBy;
  delete (clean as Record<string, unknown>).createdById;
  delete (clean as Record<string, unknown>).createdAt;
  delete (clean as Record<string, unknown>).updatedBy;
  delete (clean as Record<string, unknown>).updatedById;
  return clean;
};
```

**Why:** three update handlers (`updateMlcCase`, `updateLamaRecord`,
`updateDamaRecord`) spread `req.body` into `prisma.xxx.update({ data })`. The
new `updatedBy`/`updatedById` columns would otherwise be writable from the
client body — a server-identity-impersonation loophole in the same risk class
as the 4a Phase 1d critical-values-ack bug.

**Usage pattern (single source of truth):**

```ts
const body = stripAuditFields({ ...req.body });
// ...domain-specific deletes + coercions...
const updated = await prisma.xxx.update({
  where: { id },
  data: {
    ...body,
    updatedBy: req.user!.username,
    updatedById: actorId,
  },
});
```

4b.2 (API-wide server-identity audit) will reuse this helper across any other
body-spread write endpoints it discovers. Do not duplicate the delete-list
inline — import the helper.

## Handler patches — 16 user-triggered update handlers

Every handler captures `actorId` from `getClinicalActor(req, res)` (or pre-
existing declaration) and stamps both `updatedBy: req.user!.username` +
`updatedById: actorId` on the `prisma.xxx.update({ data })` payload.

| # | Model | Handler | Stamping after 4b.1 | Notes |
|---|---|---|---|---|
| 1 | IpdPrescription | `modifyPrescription` | `updatedBy='alice', updatedById=42` | — |
| 2 | IpdPrescription | `discontinuePrescription` | same | — |
| 3 | IpdPrescription | `administerMedication` | same | also creates MAR log with `createdById` |
| 4 | IpdPrescription | `skipMedication` | same | also creates MAR log with `createdById` |
| 5 | MlcCase | `recordExamination` | same | — |
| 6 | MlcCase | `recordSampleCollection` | same | — |
| 7 | MlcCase | `submitReport` | same | — |
| 8 | MlcCase | `updateMlcCase` | same | **uses stripAuditFields** (body-spread guard) |
| 9 | MlcCase | `uploadMlcPhotos` | same | — |
| 10 | MlcCase | `uploadExaminerSignature` | same | — |
| 11 | MlcCase | `uploadSubmissionProof` | same | — |
| 12 | MlcCase | `closeMlcCase` | same | — |
| 13 | LamaRecord | `updateLamaRecord` | same | **uses stripAuditFields** (body-spread guard); previously stamped nothing |
| 14 | LamaRecord | `uploadSignatureHandler(lama, …)` | same | private helper serving 2 exports; previously stamped nothing |
| 15 | DamaRecord | `updateDamaRecord` | same | **uses stripAuditFields**; previously stamped nothing |
| 16 | DamaRecord | `uploadSignatureHandler(dama, …)` | same | same helper body as #14, serves 2 dama exports |

**Uniform guarantee after 4b.1:** every clinical update row on the 7 target
models carries `updatedBy` + `updatedById` stamped from JWT, or is a Category
B HMIS-id backfill (see below).

## HMIS-id backfill exemption (Q1 decision)

7 server-internal `.update()` call sites write machine-generated cross-
reference ids (`hmisMlcId`, `hmisLamaId`, `hmisDamaId`, `hmisDischargeId`)
after an HMIS push succeeds. These are **exempt** from `updatedBy` /
`updatedById` stamping:

| Site | Model | Location |
|---|---|---|
| B1 | IpdDischarge | `createDischarge` inline, after discharge_created push |
| B2 | MlcCase | `persistHmisMlcIdIfMissing` helper body |
| B3 | MlcCase | `createMlcCase` inline, after mlc_registered push |
| B4 | LamaRecord | `persistHmisLamaIdIfMissing` helper body |
| B5 | LamaRecord | `createLamaRecord` inline, after lama_created push |
| B6 | DamaRecord | `persistHmisDamaIdIfMissing` helper body |
| B7 | DamaRecord | `createDamaRecord` inline, after dama_created push |

**Rationale:** HMIS-id writes are bookkeeping, not clinical modifications.
The row was already attributed by the immediately preceding user-triggered
write. Stamping Cat B sites would pollute audit queries that use
`updatedBy IS NOT NULL` as the filter for "human touched this since create".

**Operational consequence — read this carefully:** `updatedAt` WILL bump on
Cat B writes (Prisma's `@updatedAt` decorator fires on any update). Therefore:

- ✅ **DO** use `updatedBy IS NOT NULL` to filter for human-triggered updates
  in NABH audit queries.
- ❌ **DO NOT** use `updatedAt > createdAt` or `updatedAt IS NOT NULL` to
  mean "a human modified this" — that test will flag machine-bookkeeping
  updates too.

HMIS-id backfill evidence lives in `HmisAuditLog` rows (module='mlc'|'lama'|
'dama'|'discharge', action='*_registered'|'*_created'|etc.), not in the
attribution columns on the clinical tables.

## Test coverage — 20 new tests

| File | New tests | What they cover |
|---|---|---|
| [`ipd-pharmacy.test.ts`](../../src/api/ipd/__tests__/ipd-pharmacy.test.ts) (extended) | 4 | Happy-path stamping for modify/discontinue/administer/skip — all stamp `updatedBy='alice'` + `updatedById=42` from JWT. |
| [`mlc-updates.test.ts`](../../src/api/mlc/__tests__/mlc-updates.test.ts) (new) | 10 | 8 happy-path (one per MLC update handler); E1 = body-spread leak closed on `updateMlcCase`; E2 = HMIS-id backfill in `recordExamination` writes only `hmisMlcId`, not attribution. |
| [`lama-dama-updates.test.ts`](../../src/api/lama-dama/__tests__/lama-dama-updates.test.ts) (new) | 5 | 4 happy-path (updateLama, updateDama, uploadLamaSig, uploadDamaSig); E3 = rapid updates from two different users each stamp their own JWT identity. |
| [`audit-guard.test.ts`](../../src/middleware/__tests__/audit-guard.test.ts) (extended) | 1 | `stripAuditFields` unit: removes all 5 audit-attribution fields, preserves everything else, non-mutating. |

**Total: 20 new tests.** Full backend suite: **161/161 green** (141 pre-4b.1 + 20 new, zero regressions).

### E1 leak-close evidence (quoted from mlc-updates.test.ts)

```ts
const req = buildReq({
  body: {
    injuries: 'laceration',
    updatedBy: 'attacker',     // ← client-supplied impersonation attempt
    updatedById: 999,
    createdBy: 'attacker',
    createdById: 999,
  },
});
await updateMlcCase(req, buildRes());
// Assertion:
const args = mlcCaseMock.update.mock.calls[0][0];
expect(args.data.updatedBy).toBe('alice');     // ← JWT wins
expect(args.data.updatedById).toBe(42);
expect(args.data.updatedBy).not.toBe('attacker');
expect(args.data.createdBy).toBeUndefined();   // ← createdBy stripped entirely
```

### E2 HMIS-id exemption evidence

```ts
// recordExamination fires TWO updates: user-triggered + HMIS-id backfill.
expect(mlcCaseMock.update).toHaveBeenCalledTimes(2);
const userUpdateArgs = mlcCaseMock.update.mock.calls[0][0];
const backfillArgs   = mlcCaseMock.update.mock.calls[1][0];

expect(userUpdateArgs.data.updatedBy).toBe('alice');     // ← user write stamped
expect(backfillArgs.data.hmisMlcId).toBe('HMIS-MLC-1');  // ← backfill writes id only
expect(backfillArgs.data.updatedBy).toBeUndefined();     // ← exempt
expect(backfillArgs.data.updatedById).toBeUndefined();
```

## Known gaps after 4b.1

1. **IpdProgressNote + IpdMedicationLog carry columns without handlers.**
   Both models are append-only (no `.update()` call sites today). Columns
   are in place for future update flows; no tests targeting these two models
   because there's nothing to test yet.
2. **4b.2 (API-wide server-identity audit)** will sweep the remaining write
   endpoints outside the 7 clinical models for the same body-spread pattern.
   The `stripAuditFields` helper is the tool of choice for every hit.
3. **Cat B HMIS-id helpers (B2/B4/B6)** still have a single-arg signature
   `(record, outcomeResult)` — threading `actorId` is not needed today per
   the Q1 exemption, but if future changes propagate user context through
   the HMIS post-write chain, reopen this decision.
