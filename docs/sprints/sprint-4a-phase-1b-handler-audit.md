# Sprint 4a · Phase 1b — Handler Audit

**Date:** 2026-04-20 · **Status:** Audit-only. Waiting on user approval before writing enforcement code.

Every write handler across the 7 MRD-target models (IpdProgressNote, IpdDischarge, IpdPrescription, IpdMedicationLog, MlcCase, LamaRecord, DamaRecord) inventoried + characterized.

---

## TL;DR — two critical findings

### 🚨 Finding 1 — IPD routes have ZERO authenticateToken middleware

All 8 IPD write handlers across [ipd.routes.ts](../../src/api/ipd/ipd.routes.ts) and [ipd-prescription.routes.ts](../../src/api/ipd/ipd-prescription.routes.ts) are **completely unauthenticated**. The controller code looks auth-aware — it reads `req.user?.username || 'system'` — but because no middleware ever attaches `req.user`, the fallback `'system'` is ALWAYS written in practice. There is no current NABH.MRD.1 audit trail for IPD writes; every row is attributed to a string literal `"system"` regardless of who actually wrote it.

This is a pre-existing security + compliance gap that the Phase 1b enforcement will close by wiring `authenticateToken` onto the IPD routes.

### 🚨 Finding 2 — One system-write path (seed script)

`scripts/seed-sprint-3.ts` writes directly via Prisma client (not HTTP) to `IpdProgressNote` (line 430) and `IpdPrescription` (line 472) with `createdBy: 'seed-script'`. This is developer tooling, not a runtime request path. **Enforcement will be at the controller-layer middleware** (where `req` is available) — seed scripts continue working untouched. No action needed unless we want to add identity stamping to the seed (propose: `createdById: 0` as a reserved SYSTEM user id, but this is optional and can wait).

---

## Complete write-path inventory (25 handlers)

**9 create handlers** (must stamp `createdBy` + `createdById`, reject unauth).
**16 update handlers** (must check auth + stamp `updatedBy`; no `createdBy` write since record pre-exists; `updatedById` is 4b scope per earlier decision).

### IPD — 8 handlers, 🚨 ALL unauthenticated

| # | Model | Controller | Handler | Method + route | Auth today | Writes `createdBy`? | Writes `createdById`? | Blocker? |
|---|---|---|---|---|---|---|---|---|
| 1 | `IpdProgressNote` | `ipd.controller.ts` | `addProgressNote` (L378) | POST `/api/ipd/admission/:admissionId/progress-note` | ❌ none | ✓ `req.user?.username \|\| 'system'` (always 'system' — fallback fires because `req.user` is undefined) | ❌ | 🚨 yes |
| 2 | `IpdDischarge` | `ipd.controller.ts` | `createDischarge` (L491) | POST `/api/ipd/admission/:admissionId/discharge` | ❌ none | ✓ `req.user?.username \|\| 'system'` | ❌ | 🚨 yes |
| 3 | `IpdPrescription` | `ipd-prescription.controller.ts` | `continuePrescription` (L176) | POST `/api/ipd/admission/:admissionId/continue` | ❌ none | ✓ `req.user?.username \|\| 'system'` | ❌ | 🚨 yes |
| 4 | `IpdPrescription` | `ipd-prescription.controller.ts` | `createNewPrescription` (L370) | POST `/api/ipd/admission/:admissionId/prescription` | ❌ none | ✓ `req.user?.username \|\| 'system'` | ❌ | 🚨 yes |
| 5 | `IpdPrescription` | `ipd-prescription.controller.ts` | `modifyPrescription` (L270) | PUT `/api/ipd/prescription/:prescriptionId/modify` | ❌ none | — (update; writes `updatedBy`) | ❌ | 🚨 yes |
| 6 | `IpdPrescription` | `ipd-prescription.controller.ts` | `discontinuePrescription` (L319) | PUT `/api/ipd/prescription/:prescriptionId/discontinue` | ❌ none | — (update; writes `updatedBy`) | ❌ | 🚨 yes |
| 7 | `IpdPrescription` + `IpdMedicationLog` | `ipd-prescription.controller.ts` | `administerMedication` (L491) | POST `/api/ipd/prescription/:prescriptionId/administer` | ❌ none | ✓ on MedLog via `administeredBy` (uses `req.user?.username \|\| 'nursing-staff'`); update writes `updatedBy` | ❌ | 🚨 yes |
| 8 | `IpdPrescription` + `IpdMedicationLog` | `ipd-prescription.controller.ts` | `skipMedication` (L641) | PUT `/api/ipd/prescription/:prescriptionId/skip` | ❌ none | ✓ on MedLog via `administeredBy` | ❌ | 🚨 yes |

### MLC — 9 handlers, all authenticated ✓

Routes: [mlc.routes.ts](../../src/api/mlc/mlc.routes.ts) — every route guarded by `authenticateToken`.

| # | Handler | Method + route | Writes `createdBy` | Writes `updatedBy` |
|---|---|---|---|---|
| 9 | `registerMlcCase` (L213) | POST `/api/mlc/register` | ✓ `req.user?.username \|\| 'system'` | — |
| 10 | `recordExamination` (L396) | PUT `/api/mlc/:id/examination` | — | ✓ |
| 11 | `recordSampleCollection` (L453) | PUT `/api/mlc/:id/samples` | — | ✓ |
| 12 | `submitReport` (L498) | PUT `/api/mlc/:id/report` | — | ✓ |
| 13 | `updateMlcCase` (L639) | PUT `/api/mlc/:id` | — | ✓ |
| 14 | `uploadMlcPhotos` (L674) | POST `/api/mlc/:id/upload-photos` | — | ✓ |
| 15 | `uploadExaminerSignature` (L720) | POST `/api/mlc/:id/upload-signature` | — | ✓ |
| 16 | `uploadSubmissionProof` (L756) | POST `/api/mlc/:id/upload-submission-proof` | — | ✓ |
| 17 | `closeMlcCase` (L839) | PUT `/api/mlc/:id/close` | — | ✓ |

### LAMA — 4 handlers, all authenticated ✓

Routes: [lama-dama.routes.ts](../../src/api/lama-dama/lama-dama.routes.ts) — every route guarded.

| # | Handler | Method + route | Writes `createdBy` | Writes `updatedBy` |
|---|---|---|---|---|
| 18 | `createLamaRecord` (L223) | POST `/api/lama-dama/lama` | ✓ `req.user?.username \|\| 'system'` | — |
| 19 | `updateLamaRecord` (L656) | PUT `/api/lama-dama/lama/:id` | — | ❌ (spreads `...body`; no explicit stamp) |
| 20 | `uploadLamaPatientSignature` (L834) | POST `/api/lama-dama/lama/:id/upload-patient-signature` | — | ❌ (generic helper does neither) |
| 21 | `uploadLamaWitnessSignature` (L836) | POST `/api/lama-dama/lama/:id/upload-witness-signature` | — | ❌ |

### DAMA — 4 handlers, all authenticated ✓ — mirror of LAMA

| # | Handler | Method + route | Writes `createdBy` | Writes `updatedBy` |
|---|---|---|---|---|
| 22 | `createDamaRecord` (L326) | POST `/api/lama-dama/dama` | ✓ `req.user?.username \|\| 'system'` | — |
| 23 | `updateDamaRecord` (L698) | PUT `/api/lama-dama/dama/:id` | — | ❌ (spreads `...body`) |
| 24 | `uploadDamaPatientSignature` (L838) | POST `/api/lama-dama/dama/:id/upload-patient-signature` | — | ❌ |
| 25 | `uploadDamaWitnessSignature` (L840) | POST `/api/lama-dama/dama/:id/upload-witness-signature` | — | ❌ |

### Non-handler helper writes (NOT rejection targets — inherit parent auth)

- `persistHmisMlcIdIfMissing` (mlc.controller.ts:164) — backfill-only; writes `hmisMlcId`. Called from inside registerMlc/recordExamination/recordSampleCollection/submitReport. No auth context of its own.
- `persistHmisLamaIdIfMissing` / `persistHmisDamaIdIfMissing` (lama-dama.controller.ts:167 / :185) — same pattern.
- `hmisDischargeId` backfill inside `createDischarge` (ipd.controller.ts:593) — inside parent handler scope.

These 4 helpers do not need independent auth checks — they execute only after the parent handler has already validated `req.user`.

---

## Current-state summary

| | Count |
|---|---|
| Handlers that already go through `authenticateToken` (MLC + LAMA/DAMA) | **17** |
| Handlers with NO auth middleware at all (all IPD) | **8** 🚨 |
| **Total write handlers** | **25** |
| Of those, create handlers (stamp `createdBy` + new `createdById`) | **9** |
| Of those, update handlers (stamp `updatedBy`; `updatedById` is 4b scope) | **16** |
| Handlers already writing `createdBy` on create (if auth were working) | 5 of 9 — the IPD ones fall to 'system' always; MLC/LAMA/DAMA register propagate the real username when auth is applied |
| Handlers already writing `updatedBy` on update | 12 of 16 (MLC 8/9, IPD 4/7 update-only ones) |
| Handlers NOT writing `updatedBy` on update | 4 — `updateLamaRecord`, `updateDamaRecord`, `uploadSignatureHandler` (serves 4 signature endpoints as 1 helper) |

---

## Proposed enforcement plan (for your approval)

For each of the 25 handlers:

1. **Route-level:** add `authenticateToken` to all 8 IPD routes in `ipd.routes.ts` + `ipd-prescription.routes.ts`. (MLC + LAMA/DAMA already have it.)

2. **Handler-level strictness (shared helper or inlined):** at the top of each clinical-write handler, reject with HTTP 401:
   ```ts
   const actorId = req.user?.id;
   if (typeof actorId !== 'number' || actorId <= 0) {
     res.status(401).json({ error: 'Authentication required for clinical writes' });
     return;
   }
   ```
   Proposal: extract into a small helper `requireClinicalActor(req, res): number | null` at `src/middleware/audit-guard.ts` so the 25 call sites stay tight. Returns `null` after sending the 401; handler uses `if (!actorId) return;` pattern.

3. **Create handlers (9) — coexistence stamping:**
   ```ts
   // In data: {...}
   createdBy:    req.user!.username,
   createdById:  actorId,
   ```
   User's explicit rule: write BOTH. Do not drop or nullify the existing `createdBy String?` column. Formal deprecation is 4c scope.

4. **Update handlers (16) — match existing pattern where already present, add `updatedBy` where missing:**
   ```ts
   // In data: {...}
   updatedBy: req.user!.username,
   // (no updatedById yet — 4b scope)
   ```
   For the 4 handlers not currently writing `updatedBy` (`updateLamaRecord`, `updateDamaRecord`, `uploadSignatureHandler`×1), ADD it this sprint since we're already touching them.

5. **Seed script (`scripts/seed-sprint-3.ts`):** leave unchanged. Enforcement is controller-layer; seed hits Prisma directly. `createdBy: 'seed-script'` stays as-is; `createdById` remains null. If you want seeds to include a reserved system user id, that's a separate tiny follow-up.

### Expected test count

- Per handler × 2 tests (happy path + 401 rejection) = **25 × 2 = 50 tests**.

That is more than the 24–30 the plan anticipated. Options:
- **(a)** Do all 50. Thorough; ~12 new backend unit tests per controller file.
- **(b)** Do 2 tests per CREATE handler (9 × 2 = 18) + 1 test per update handler asserting the 401 only (16 × 1 = 16) = **34 tests**. Skip happy-path update coverage since update handlers mostly spread `...body` anyway.
- **(c)** Do 2 tests per handler but consolidate the 4 L/D signature uploads into 1 parameterized test each (reduces 4 × 2 to 1 × 2) — saves 6 tests. Net ~44.

**My lean: (b) — 34 tests.** Hits the user's stated policy (every handler rejects unauth) on every path, and does deep happy-path assertion only on the 9 creates where new `createdById` stamping is the payload we care about for NABH audit queries. 4b can deepen update-happy-path coverage alongside `updatedById`.

---

## Questions for your approval

1. **Finding 1 — add `authenticateToken` to all 8 IPD routes?** I see no reason not to; confirming this is the intended fix rather than something bigger (e.g., a new role-gated middleware). Otherwise we can't satisfy the strictness policy.

2. **Finding 2 — seed script.** Leave it alone (controller-layer enforcement, seed untouched) or add `createdById: 0` as a reserved SYSTEM user convention (plus ensure a `User` row with `id = 0` exists — or use a non-zero sentinel)? **My lean: leave alone this sprint.** If we pick up a SYSTEM user convention later, it's a one-liner to add.

3. **Helper for the 401 guard:** extract `requireClinicalActor` to `src/middleware/audit-guard.ts` or inline at each call site? **My lean: extract.** DRY + consistent error shape across 25 handlers.

4. **Test count — option (a), (b), or (c)?** My lean: (b), ~34 tests.

5. **`updatedBy` on the 4 handlers that don't currently write it** (`updateLamaRecord`, `updateDamaRecord`, `uploadSignatureHandler`) — add now or defer to 4b? **My lean: add now** since we're inside these handlers anyway; skipping means a needless second pass later.

---

## What executes on approval

Phase 1b plan (approval unlocks execution):

1. Write `src/middleware/audit-guard.ts` with `requireClinicalActor`.
2. Wire `authenticateToken` onto all 8 IPD routes.
3. Patch 9 create handlers: call guard + stamp `createdBy` + `createdById`.
4. Patch 16 update handlers: call guard + stamp `updatedBy` where missing.
5. Write ~34 tests (Option b).
6. Run isolated subset + full suites.
7. Report.

Estimated diff scope: ~4 controller files + 2 route files + 1 new middleware file + test additions.

No execution until approved. Waiting.
