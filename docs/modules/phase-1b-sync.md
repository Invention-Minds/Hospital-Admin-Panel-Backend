# Phase 1b — MRD Audit Enforcement · Sync Check

**Date:** 2026-04-20 · **Sprint:** 4a · Phase 1b.

Backend-only. Documents what Phase 1b enforces, how the existing tests were NOT impacted, and the known attribution gap deferred to 4b.

---

## Enforcement surface

**25 clinical-write handlers** now run through the `requireClinicalActor` middleware + match `getClinicalActor` inline guard:

| Controller | Write handlers (count) | Prior auth coverage |
|---|---|---|
| `src/api/ipd/ipd.controller.ts` | `addProgressNote`, `createDischarge` (2) | 🚨 none (fixed this phase) |
| `src/api/ipd/ipd-prescription.controller.ts` | `continuePrescription`, `createNewPrescription`, `modifyPrescription`, `discontinuePrescription`, `administerMedication`, `skipMedication` (6) | 🚨 none (fixed this phase) |
| `src/api/mlc/mlc.controller.ts` | `registerMlcCase` + 8 update handlers (9) | ✓ `authenticateToken` |
| `src/api/lama-dama/lama-dama.controller.ts` | `createLamaRecord`, `createDamaRecord`, `updateLamaRecord`, `updateDamaRecord`, `uploadSignatureHandler` × 4 (8) | ✓ `authenticateToken` |

Plus an 8-route patch adding `authenticateToken` + `requireClinicalActor` to `ipd.routes.ts` + `ipd-prescription.routes.ts`, closing the pre-existing IPD auth gap.

## Enforcement contract

1. **Route middleware** `authenticateToken → requireClinicalActor` runs first; 401 if no JWT-carried numeric id.
2. **Handler inline guard** `getClinicalActor(req, res)` runs immediately inside the `try {}` block as belt-and-suspenders; also 401 if somehow the middleware chain was bypassed (future-proofing against routing regressions).
3. **Create handlers** (9 of 25): stamp both `createdBy: req.user!.username` and `createdById: actorId`. Existing `createdBy String?` stays populated for backward-compat.
4. **Update handlers** (16 of 25): existing `updatedBy` stamping normalized to `req.user!.username` on models that have the column. **See Known Gap §5** for the 5 models missing `updatedBy`.

## Route-level before/after

**IPD:** 0 authenticated routes → 8 authenticated routes (progress-note, discharge, prescriptions × 6, admission + transfer bonus).

**IPD-prescription:** 0 → 6 clinical-write routes.

**MLC:** 9 already-authenticated routes → same 9 now also `requireClinicalActor`-guarded.

**LAMA/DAMA:** 8 already-authenticated routes (create × 2 + update × 2 + signature × 4) → same 8 now also `requireClinicalActor`-guarded.

## Seed-script exception (documented)

`scripts/seed-sprint-3.ts` writes to `IpdProgressNote` and `IpdPrescription` directly via the Prisma client, not through any HTTP handler. It bypasses controller enforcement **by design** — seed scripts are a dev-only administrative tool operating with DB credentials directly. Not a gap. No policy action required.

Rows inserted by the seed carry `createdBy: 'seed-script'` and `createdById = NULL`. NABH audit queries can filter these out via `createdById IS NOT NULL` when isolating "real clinician actions" vs. "setup/dev seed data".

---

## §5 — Known Gaps at End of Phase 1b

Phase 1b enforces authentication for all clinical updates via the `requireClinicalActor` middleware. However, **username-level "who updated" attribution on `IpdProgressNote`, `IpdDischarge`, `IpdMedicationLog`, `LamaRecord`, `DamaRecord` is deferred to Sprint 4b**, which will add both `updatedBy String?` and `updatedById Int?` in a single migration.

Until 4b lands, these 5 models can prove "an authenticated user updated this record at this timestamp" — by the pairing of:
- `requireClinicalActor` (guarantees auth at write time),
- Phase 1a's `updatedAt DateTime? @updatedAt` gap-fill (captures when).

…but cannot identify that user by name or typed id on the record row itself. The **creator attribution** (`createdBy` + `createdById`) is fully enforced on **all 7 models** from Phase 1b onward.

**Impact for NABH audit:** an auditor asking "who updated `IpdDischarge` row X on date Y" gets `updatedAt = Y` from the record but must correlate with application logs or `HmisAuditLog` entries to get the username. Auditors asking "who created this record" get direct answers from `createdBy` + `createdById` starting from Phase 1b's deployment.

4b scope is tracked in [docs/sprints/sprint-4b-plan.md §1](../sprints/sprint-4b-plan.md).

---

## Interceptor verification — frontend unchanged

Angular's `AuthInterceptor` attaches the JWT to **every** outbound HTTP request unconditionally. IPD requests already carry the token today; they just hit routes that previously ignored it. Phase 1b backend-only scope closes the gap without any frontend interceptor patch.

403 responses (invalid token) still trigger the interceptor's auto-redirect to `/login`. 401 responses from `requireClinicalActor` (valid token but missing/invalid user id) are surfaced as normal HTTP errors to caller components — correct behavior since the session is still valid, just the write-level guard failed.

## HMIS audit log — unaffected

The HMIS push flow and `HmisAuditLog` writes are not modified. The wrapper (`syncWithHmis`) still writes success/failure audit rows on every push attempt. Phase 1b only governs the **local DB write**; the HMIS downstream path is unchanged.

## Existing test fixtures — no rewrites needed

All existing tests across MLC / LAMA-DAMA / IPD admission / IPD pharmacy already mock `req.user: { id: 1, username: 'reception-1' }` (or similar) on their `buildReq` helpers. The new `getClinicalActor` guard passes cleanly because those fixtures carry a positive integer id. **Zero pre-existing tests were modified.** Backend suite went from 87/87 → 93/93 (including 6 new middleware tests), then new handler tests added on top (see Phase 1b report).
