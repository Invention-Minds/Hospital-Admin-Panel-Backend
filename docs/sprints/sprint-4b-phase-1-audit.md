# Sprint 4b · Phase 4b.1 — Update Attribution Full Pass · Step 0 Audit

**Date:** 2026-04-20 · **Status:** Audit complete — **awaiting user approval of handler inventory + migration name before execution.**

**NABH ref:** MRD.1 (audit trail completeness for record updates).

---

## 0.1 Column-addition inventory (final authoritative list)

Verified against [prisma/schema.prisma](../../prisma/schema.prisma) lines 1273–1607 (the 7 target models).

### `updatedAt` gap-fill check (from 4a Phase 1a)

All 7 models already carry `updatedAt DateTime? @updatedAt` or `updatedAt DateTime @updatedAt`. **No gap-fill needed in this bundle.**

| Model | `updatedAt` column | Source |
|---|---|---|
| IpdProgressNote | ✓ nullable | 4a Phase 1a |
| IpdDischarge | ✓ nullable | 4a Phase 1a |
| IpdPrescription | ✓ non-null (pre-4a) | schema |
| IpdMedicationLog | ✓ nullable | 4a Phase 1a |
| MlcCase | ✓ non-null (pre-4a) | schema |
| LamaRecord | ✓ nullable | 4a Phase 1a |
| DamaRecord | ✓ nullable | 4a Phase 1a |

### `updatedBy String?` — 5 models need addition

| Model | Current state | Action |
|---|---|---|
| IpdProgressNote | missing | ADD COLUMN |
| IpdDischarge | missing | ADD COLUMN |
| IpdMedicationLog | missing | ADD COLUMN |
| LamaRecord | missing | ADD COLUMN |
| DamaRecord | missing | ADD COLUMN |
| IpdPrescription | **already present** (schema line 1580) | skip |
| MlcCase | **already present** (schema line 1314) | skip |

### `updatedById Int?` — all 7 models need addition

| Model | Current state | Action |
|---|---|---|
| IpdProgressNote | missing | ADD COLUMN |
| IpdDischarge | missing | ADD COLUMN |
| IpdPrescription | missing | ADD COLUMN |
| IpdMedicationLog | missing | ADD COLUMN |
| MlcCase | missing | ADD COLUMN |
| LamaRecord | missing | ADD COLUMN |
| DamaRecord | missing | ADD COLUMN |

**Total new columns: 5 + 7 = 12** — matches plan.

### Bundle shape (12 `ALTER TABLE ADD COLUMN` statements)

```
ALTER TABLE `DamaRecord`       ADD COLUMN `updatedBy` VARCHAR(191) NULL,
                               ADD COLUMN `updatedById` INTEGER NULL;
ALTER TABLE `IpdDischarge`     ADD COLUMN `updatedBy` VARCHAR(191) NULL,
                               ADD COLUMN `updatedById` INTEGER NULL;
ALTER TABLE `IpdMedicationLog` ADD COLUMN `updatedBy` VARCHAR(191) NULL,
                               ADD COLUMN `updatedById` INTEGER NULL;
ALTER TABLE `IpdPrescription`  ADD COLUMN `updatedById` INTEGER NULL;
ALTER TABLE `IpdProgressNote`  ADD COLUMN `updatedBy` VARCHAR(191) NULL,
                               ADD COLUMN `updatedById` INTEGER NULL;
ALTER TABLE `LamaRecord`       ADD COLUMN `updatedBy` VARCHAR(191) NULL,
                               ADD COLUMN `updatedById` INTEGER NULL;
ALTER TABLE `MlcCase`          ADD COLUMN `updatedById` INTEGER NULL;
```

All nullable; INSTANT algorithm; existing rows stay NULL until first update.

---

## 0.2 Update-handler inventory

Walk of every site that calls `.update(...)` on one of the 7 target models. Split into two categories: user-triggered clinical updates (in scope for stamping) vs server-internal HMIS-id backfills (decision point Q1).

### Category A — user-triggered clinical update handlers (16 total)

| # | Model | Handler | File | Line | Currently stamps `updatedBy` | Currently stamps `updatedById` | Notes |
|---|---|---|---|---|---|---|---|
| 1 | IpdPrescription | `modifyPrescription` | [ipd-prescription.controller.ts](../../src/api/ipd/ipd-prescription.controller.ts):275 | 286 | ✓ `req.user!.username` | ✗ | `actorId` in scope (L280) |
| 2 | IpdPrescription | `discontinuePrescription` | ipd-prescription.controller.ts:327 | 338 | ✓ | ✗ | `actorId` in scope |
| 3 | IpdPrescription | `administerMedication` | ipd-prescription.controller.ts:506 | 528 | ✓ | ✗ | also creates IpdMedicationLog (already stamps `createdById`) |
| 4 | IpdPrescription | `skipMedication` | ipd-prescription.controller.ts:660 | 679 | ✓ | ✗ | also creates IpdMedicationLog |
| 5 | MlcCase | `recordExamination` | [mlc.controller.ts](../../src/api/mlc/mlc.controller.ts):401 | 417 | ✓ | ✗ | calls `persistHmisMlcIdIfMissing` after (see Cat B) |
| 6 | MlcCase | `recordSampleCollection` | mlc.controller.ts:460 | 470 | ✓ | ✗ | calls `persistHmisMlcIdIfMissing` after |
| 7 | MlcCase | `submitReport` | mlc.controller.ts:507 | 524 | ✓ | ✗ | — |
| 8 | MlcCase | `updateMlcCase` | mlc.controller.ts:650 | 669 | ✓ | ✗ | **body-spread pattern** — see Q4 |
| 9 | MlcCase | `uploadMlcPhotos` | mlc.controller.ts:687 | 713 | ✓ | ✗ | — |
| 10 | MlcCase | `uploadExaminerSignature` | mlc.controller.ts:735 | 752 | ✓ | ✗ | — |
| 11 | MlcCase | `uploadSubmissionProof` | mlc.controller.ts:773 | 790 | ✓ | ✗ | — |
| 12 | MlcCase | `closeMlcCase` | mlc.controller.ts:858 | 868 | ✓ | ✗ | — |
| 13 | LamaRecord | `updateLamaRecord` | [lama-dama.controller.ts](../../src/api/lama-dama/lama-dama.controller.ts):665 | 680 | ✗ **NOT stamping** | ✗ | `data: body` — body-spread. Q4 applies. |
| 14 | LamaRecord | `uploadSignatureHandler('lama', ...)` | lama-dama.controller.ts:809 | 830 | ✗ **NOT stamping** | ✗ | shared private helper — 2 lama exports delegate |
| 15 | DamaRecord | `updateDamaRecord` | lama-dama.controller.ts:709 | 724 | ✗ **NOT stamping** | ✗ | `data: body` — body-spread. Q4 applies. |
| 16 | DamaRecord | `uploadSignatureHandler('dama', ...)` | lama-dama.controller.ts:809 (shared) | 834 | ✗ **NOT stamping** | ✗ | 2 dama exports delegate |

Observations:
- **12 of 16** already stamp `updatedBy` via `req.user!.username` after the 4a Phase 1b sweep. Those need only `updatedById: actorId` added.
- **4 of 16** currently stamp neither — all LAMA/DAMA update-side. Need both columns stamped.
- All 16 already pass through `getClinicalActor(req, res)` → guaranteed authenticated `req.user.id` + `req.user.username` in scope.
- `uploadSignatureHandler` (handlers #14 + #16) is a single private helper servicing **4 exported routes** (`uploadLamaPatientSignature`, `uploadLamaWitnessSignature`, `uploadDamaPatientSignature`, `uploadDamaWitnessSignature`). One edit fixes all 4 endpoints. **Counted as 2 handler rows in the table** because it updates 2 distinct models, but the edit surface is 1 helper body.

### Category B — server-internal HMIS-id post-write updates (7 sites)

Machine-generated cross-reference backfills; no clinical content mutation. Still fire `@updatedAt` automatically.

| # | Model | Location | Context |
|---|---|---|---|
| B1 | IpdDischarge | [ipd.controller.ts:624](../../src/api/ipd/ipd.controller.ts#L624) | HMIS-id backfill inside `createDischarge` |
| B2 | MlcCase | [mlc.controller.ts:175](../../src/api/mlc/mlc.controller.ts#L175) | `persistHmisMlcIdIfMissing` helper body; called from `recordExamination`, `recordSampleCollection`, `submitReport`, etc. |
| B3 | MlcCase | mlc.controller.ts:293 | HMIS-id backfill inline inside `createMlcCase` |
| B4 | LamaRecord | [lama-dama.controller.ts:178](../../src/api/lama-dama/lama-dama.controller.ts#L178) | `persistHmisLamaIdIfMissing` helper body; called from `updateLamaRecord` |
| B5 | LamaRecord | lama-dama.controller.ts:310 | HMIS-id backfill inline inside `createLamaRecord` |
| B6 | DamaRecord | lama-dama.controller.ts:196 | `persistHmisDamaIdIfMissing` helper body; called from `updateDamaRecord` |
| B7 | DamaRecord | lama-dama.controller.ts:416 | HMIS-id backfill inline inside `createDamaRecord` |

See **Q1** for the decision on stamping vs exempting.

### Category C — models with zero existing update handlers

| Model | Why no handlers | Implication |
|---|---|---|
| IpdProgressNote | Append-only journal model; clinicians add new SOAP notes rather than modifying old ones. | Columns still added per plan (future handlers may come). **No handler patches in 4b.1.** |
| IpdMedicationLog | Append-only MAR log; each administration/skip event is a new row via `administerMedication` / `skipMedication`. | Same as above. **No handler patches in 4b.1.** |

### Transactions spanning multiple target models

None in the current codebase. `administerMedication` and `skipMedication` write IpdPrescription (update) + IpdMedicationLog (create), but via two sequential `await prisma…` calls, **not** inside a `prisma.$transaction`. No atomicity concern for 4b.1.

### Middleware verification (requireClinicalActor coverage)

All 16 user-triggered handlers funnel through either `requireClinicalActor` middleware (IPD + MLC + LAMA/DAMA routes per 4a Phase 1b) or the in-handler `getClinicalActor(req, res)` gate. **Confirmed: no zero-auth update handler on the 7 target models.**

---

## 0.3 Coexistence policy for existing columns

Two models already carry `updatedBy String?` in schema today:

- **IpdPrescription** — column present since pre-4a. 4 update handlers already stamp it via `req.user!.username`. 4b.1 adds only `updatedById Int?` column + one-line `updatedById: actorId` stamp on each handler.
- **MlcCase** — column present since pre-4a. 8 update handlers already stamp it. Same treatment.

The other 5 models get both columns new. Every handler stamps `updatedBy` (username) **and** `updatedById` (typed id) — Phase 1b convention:

```ts
data: {
  // ...existing fields
  updatedBy: req.user!.username,
  updatedById: actorId,
}
```

**Coexistence guarantee after 4b.1:** every update path on any of the 7 target models writes both `updatedBy` and `updatedById`. No column is removed or deprecated this phase. Pre-existing NULL rows (never updated since enforcement started) remain NULL — that's a meaningful "never touched" state, not a bug.

---

## 0.4 Migration name + timestamp

**Proposed:** `prisma/migrations/20260420170000_update_attribution_bundle/migration.sql`

- Timestamp `20260420170000` — after 4a Phase 1e (`20260420150000_bed_census_snapshot`), follows the 4a naming convention (`snake_case_what_it_does_bundle`).
- Single migration file, 7 ALTER TABLE statements (one per model; Prisma groups multiple ADD COLUMN into one statement per table).
- Hand-written; `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script` will byte-match. **No `--shadow-database-url`.**

---

## 0.5 Test plan (~18–20 tests)

Test files + count distribution:

| File | New tests | What they cover |
|---|---|---|
| `src/api/ipd/__tests__/ipd-pharmacy.test.ts` (extend) | 4 | Happy-path stamping for `modifyPrescription`, `discontinuePrescription`, `administerMedication`, `skipMedication` — each asserts `updatedBy='alice'` + `updatedById=42`. |
| `src/api/mlc/__tests__/mlc-updates.test.ts` (**new file**) | 8 | Happy-path stamping for all 8 MLC update handlers. |
| `src/api/lama-dama/__tests__/lama-dama-updates.test.ts` (**new file**) | 4 | `updateLamaRecord` + `updateDamaRecord` stamping; `uploadSignatureHandler` stamping for LAMA + DAMA (one test per model). |
| Edge cases (mixed across the above) | 3 | (a) Update a pre-migration record (existing `updatedBy`/`updatedById` are NULL) → both stamped; (b) Two rapid updates → second stamp wins; (c) LAMA body-spread does NOT leak client-supplied `updatedBy`/`updatedById` (ties to Q4 — if Q4 says "also strip body", this test asserts it). |

**Total: 19 new tests.** Fits the "~20" plan target.

Out of scope (covered by 4a Phase 1b already, not re-tested):
- 401 rejection when auth missing — `requireClinicalActor` middleware tests still pass.
- Create-path stamping — already covered by 4a handler tests.

---

## 0.6 Risk flags and decision points

### Q1 — HMIS-id post-write attribution (7 sites in Category B)

The HMIS-id backfills at B1–B7 are system-internal (no clinical content change). They still fire `@updatedAt` automatically because Prisma's `@updatedAt` decorator triggers on any row update.

**Option A (stamp):** every update row carries attribution. The actor is the user who triggered the create/update that kicked off the HMIS push chain (in scope as `req.user` at each site for inline writes; threaded as `actorId` param for helpers B2/B4/B6).

**Option B (exempt):** HMIS-id backfills are system actions. Leave `updatedBy`/`updatedById` NULL (they'll bump `updatedAt` via `@updatedAt` but no attribution). NABH MRD.1 is satisfied by the preceding user write's stamp on the same row; the subsequent hmisXxxId-only update is a cross-reference, not a modification.

**Option C (hybrid):** Stamp Cat B sites only when `req.user` is directly in scope (B1, B3, B5, B7 — the inline creates' post-writes). Leave helpers (B2, B4, B6) exempt because threading `actorId` through `persistHmisXxxIdIfMissing` requires signature churn for zero clinical-audit value.

**Recommendation: Option B.** HMIS-id backfills are bookkeeping, not clinical changes. The row was already attributed by the immediately preceding user-triggered write. Stamping B1–B7 would obscure audit queries (`WHERE updatedBy IS NOT NULL` would return machine bookkeeping mixed with clinical updates). Simpler to implement, zero churn to helper signatures.

### Q2 — LAMA/DAMA upload-signature handlers (#14, #16): behavior change

Handlers #14 and #16 currently **do not stamp any attribution at all**. Adding `updatedBy` + `updatedById` is a new write where none existed. Risk: zero — the fields are additive nullable columns. Confirm that the existing test suite (`lama-dama-upload.test.ts` if any) tolerates the new fields in the `update.data` assertion.

### Q3 — IpdProgressNote + IpdMedicationLog: columns without handlers

Adding `updatedBy` + `updatedById` columns to these two models per plan, even though no update handler currently exists. Rationale from the sprint-4b-plan.md: "all 7 models carry both on every update" — the columns stand ready for when an update flow is added. No handler patches, no tests for these two in 4b.1.

**Confirm OK.**

### Q4 — LAMA/DAMA body-spread pattern (handlers #8, #13, #15)

`updateLamaRecord`, `updateDamaRecord`, and `updateMlcCase` currently use `data: { ...body, updatedBy: req.user!.username }` (or for LAMA/DAMA, `data: body` with no explicit stamping). Because `updatedBy`/`updatedById` columns will exist after this migration, a client could POST `{..., updatedBy: 'admin', updatedById: 1}` and it would be persisted verbatim.

**This is a server-identity-impersonation loophole** — same risk class as the 4a Phase 1d critical-values ack bug. It's structurally a **4b.2 scope** item, but the columns we're adding in 4b.1 are the exact targets.

**Recommendation: close it in 4b.1, not punt to 4b.2.** Add `delete body.updatedBy; delete body.updatedById;` (and `createdBy`/`createdById`/`createdAt` while we're at it) before the spread, then append the server-derived stamps. Zero extra complexity; avoids shipping a half-measure where the columns exist but are client-writable for 1 phase.

### Q5 — `uploadSignatureHandler` signature (helper at lama-dama.controller.ts:809)

Private helper takes `(type, field, req, res)`. Since `req` is already passed, `req.user` is in scope — the stamp can be added inline in the helper body without a signature change:

```ts
if (getClinicalActor(req, res) === null) return;
const actorId = req.user!.id;
// ...
data: { [field]: url, updatedBy: req.user!.username, updatedById: actorId },
```

No refactor beyond the one-line stamp. **No risk flag.**

### Q6 — Test file creation (new) vs extending existing

- **Extend** `ipd-pharmacy.test.ts` — existing IpdPrescription mocks already cover modify/discontinue/administer/skip; adding 4 stamping assertions is cheap.
- **Create** `mlc-updates.test.ts` — existing `mlc.test.ts` covers create paths; a separate update-focused file keeps the test count honest.
- **Create** `lama-dama-updates.test.ts` — same rationale.

**Alternative:** extend existing `mlc.test.ts` and `lama-dama.test.ts` instead of creating new files. User preference?

### Q7 — Existing happy-path tests: expected-shape regression

Existing tests that assert `expect(mockedPrisma.xxx.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ … }) }))` already use `objectContaining`. New `updatedBy`/`updatedById` fields won't break them. But a handful of tests assert `.toHaveBeenCalledWith({ where, data: { exact-shape } })` without `objectContaining` — those would need updates. Rough grep target below.

| Test file | Likely rework | Reason |
|---|---|---|
| `ipd-pharmacy.test.ts` | 2–3 lines (objectContaining already mostly used) | Low |
| `mlc.test.ts` (if touching update assertions) | TBD — audit during execution | Low |
| `lama-dama.test.ts` | TBD | Low |

Rework surface appears **small** (≤ a dozen line tweaks). Flagged for attention during execution, not a blocker.

---

## Decision matrix — items needing user approval before execution

| # | Question | Recommended |
|---|---|---|
| Q1 | HMIS-id backfills — stamp (A), exempt (B), or hybrid (C)? | **B — exempt** |
| Q2 | LAMA/DAMA upload-signature stamping is a behavior change — proceed? | **Yes** |
| Q3 | Add columns to IpdProgressNote + IpdMedicationLog with zero handler patches? | **Yes, per plan** |
| Q4 | Close LAMA/DAMA/MLC body-spread identity leak in 4b.1 (instead of 4b.2)? | **Yes — close in 4b.1** |
| Q5 | `uploadSignatureHandler` — inline stamp, no signature change? | **Yes** |
| Q6 | Create new `-updates.test.ts` files, or extend existing? | **Create new files** |
| Q7 | Accept that a few tests may need exact-shape assertion updates? | **Yes, small surface** |

---

## Proposed 4b.1 execution order (after approval)

1. Write `prisma/migrations/20260420170000_update_attribution_bundle/migration.sql` (hand-written).
2. Update `prisma/schema.prisma` — append the 12 columns across the 7 models.
3. `prisma migrate diff --script` → byte-match; `prisma migrate deploy` → apply.
4. `prisma generate` → refresh client types.
5. Patch 12 handlers (add `updatedById: actorId`): 4 in ipd-prescription.controller.ts + 8 in mlc.controller.ts.
6. Patch 3 handlers (close body-spread + add both stamps per Q4): `updateLamaRecord`, `updateDamaRecord`, `updateMlcCase`.
7. Patch `uploadSignatureHandler` body (serves #14, #16) — add both stamps.
8. Write 19 new tests across 3 files.
9. Run full backend suite (target 141 + 19 = 160 tests green).
10. Write `docs/modules/phase-4b-1-sync.md`.
11. Report in standard format → wait for approval before 4b.6 Step 0.

**Stopping here.** Awaiting user response on Q1–Q7 + approval of the 16-handler inventory + migration name `20260420170000_update_attribution_bundle`.
