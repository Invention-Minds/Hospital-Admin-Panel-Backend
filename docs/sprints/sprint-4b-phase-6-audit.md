# Sprint 4b · Phase 4b.6 — Prisma Client Consolidation · Step 0 Audit

**Date:** 2026-04-21 · **Status:** Audit complete — **scope-expansion finding requires user decision before execution.**

---

## Headline finding (read first)

> **The "2-5 files" estimate is wrong by an order of magnitude.** A full grep of `src/` finds **40 rogue `new PrismaClient()` instantiations across 39 files** (one file has 2 instances — `doctor.repository.ts` at module scope AND as a class field).
>
> The Sprint 3f flag was correct *about the 4 files whose tests had to mock `@prisma/client`* (emergency, opd, mlc, lama-dama). But the underlying pattern — "old controllers instantiate their own client" — is pervasive across the pre-singleton code.
>
> User must choose scope before execution: narrow (4 files, Sprint-3f-flagged), medium (~8 files, 4a-era + shared infra), or full (all 39).

---

## 0.1 Canonical singleton verification

[`src/service/prisma-client.ts`](../../src/service/prisma-client.ts) — 6 lines, single source of truth:

```ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export default prisma;
```

- **Zero options.** No log level, no datasource override, no middleware hooks.
- **Import path:** `default` export from `src/service/prisma-client`.
- **21 files currently import the singleton** — concentrated in newer/4a-era code (ipd/, hmis-sync/, ipd-prescription, follow-up-automation, bed-census-snapshot, critical-value-sse, ward-management, conversion/, prescription, investigation).

Every rogue instance uses `new PrismaClient()` with **identical** default config (verified via `grep "new PrismaClient\([^)]+\)"` — 0 matches, i.e. nobody passes args). Every rogue is functionally a duplicate of the singleton.

## 0.2 Rogue instantiation inventory

**39 production files** × **40 instances** (doctor.repository has 2).

### By cluster (my proposed groupings for scope decision)

#### Cluster A — 4 files flagged by Sprint 3f (test-mock-problematic)

Tests in these controllers had to mock BOTH `@prisma/client` AND `../../service/prisma-client` because the controller uses its own client but imported helpers use the singleton. Consolidating these 4 removes the dual-mock complexity immediately.

| # | File | Instance location |
|---|---|---|
| A1 | [src/api/emergency/emergency.controller.ts:8](../../src/api/emergency/emergency.controller.ts#L8) | module-level `const prisma` |
| A2 | [src/api/opd/opd.controller.ts:5](../../src/api/opd/opd.controller.ts#L5) | module-level `const prisma` |
| A3 | [src/api/mlc/mlc.controller.ts:10](../../src/api/mlc/mlc.controller.ts#L10) | module-level `const prisma` |
| A4 | [src/api/lama-dama/lama-dama.controller.ts:15](../../src/api/lama-dama/lama-dama.controller.ts#L15) | module-level `const prisma` |

#### Cluster B — 4a-era shared infra (touched recently; simplification buys future work)

| # | File | Instance location | Why group here |
|---|---|---|---|
| B1 | [src/api/hmis-sync/hmis-audit.ts:3](../../src/api/hmis-sync/hmis-audit.ts#L3) | module-level | Widely imported; every controller writes audit rows through it. Dual-client audit writes split the pool unnecessarily. |
| B2 | [src/api/hmis-sync/hmis-sync.controller.ts:6](../../src/api/hmis-sync/hmis-sync.controller.ts#L6) | module-level | Already tangled with Phase 1d/1e work; simpler tests going into 4b.3/4b.4. |
| B3 | [src/middleware/middleware.ts:5](../../src/middleware/middleware.ts#L5) | module-level | `authenticateToken` reads `prisma.maintenance.findFirst()` on every request. No lifecycle complexity. |

#### Cluster C — everything else (older, rarely touched by recent sprints)

33 files:

| Area | Files | Instance count |
|---|---|---|
| ad, channel, callback | 3 | 3 |
| appointments (controller/repo/resolver) | 3 | 3 |
| doctor (controller/repo/resolver) | 3 | 4 (repo has 2) |
| doctor-notes, history-notes | 2 | 2 |
| extraslots, mhc-checkin, radiology-queue | 3 | 3 |
| department (controller/resolver/respository) | 3 | 3 |
| estimation.controller | 1 | 1 |
| er.controller | 1 | 1 |
| login (controller/repo/resolver) | 3 | 3 |
| whatsapp.controller | 1 | 1 |
| therapy.controller | 1 | 1 |
| patient (controller/repo/helper) | 3 | 3 |
| services (controller/repo/scheduler) | 3 | 3 |
| service-radiology (controller/repo) | 2 | 2 |
| **Cluster C total** | **33** | **33** |

Files in this cluster have:
- No involvement in 4a/4b scope (not touched since pre-sprint-3).
- No new tests written for them in recent sprints.
- Many use the repository/resolver pattern (5+ repos, 4+ resolvers) — converting these touches class constructors.

### Overall totals

| Category | Files | Instances |
|---|---|---|
| Singleton (the one and only) | 1 | 1 |
| Cluster A (test-problematic) | 4 | 4 |
| Cluster B (4a-era shared infra) | 3 | 3 |
| Cluster C (older, uninvolved) | 33 | 33 (doctor.repo = 2 counted as 2) |
| **Total rogue** | **39 (40 instances)** | **40** |

## 0.3 Justification audit — no rogue has one

Every rogue is `const prisma = new PrismaClient()` with **zero** arguments.

| Possible justification | Found? |
|---|---|
| Custom log level (`{ log: [...] }`) | **None.** |
| Datasource override (`{ datasources: {...} }`) | **None.** |
| `$use` middleware extension | **None.** |
| `$extends` model/query extension | **None.** |
| Explicit `$connect()` / `$disconnect()` lifecycle | **None.** |
| Per-request client pattern (e.g. request-scoped) | **None.** (all module-scope) |

**Conclusion:** no rogue has a technical justification. Every single one is pure duplication, a pre-singleton legacy. Consolidation is behaviour-preserving for 100% of the 40 instances.

## 0.4 Test infrastructure impact

8 test files currently mock `@prisma/client` to intercept rogue `new PrismaClient()` calls:

| Test file | Targets | Dual-mock? |
|---|---|---|
| [`emergency/__tests__/emergency-convert.test.ts`](../../src/api/emergency/__tests__/emergency-convert.test.ts) | emergency.controller + conversion/emergency-to-ipd (singleton) | **Yes** — mocks both |
| [`mlc/__tests__/mlc.test.ts`](../../src/api/mlc/__tests__/mlc.test.ts) | mlc.controller | Singleton-free |
| [`mlc/__tests__/mlc-mrd-audit.test.ts`](../../src/api/mlc/__tests__/mlc-mrd-audit.test.ts) | mlc.controller | Singleton-free |
| [`mlc/__tests__/mlc-updates.test.ts`](../../src/api/mlc/__tests__/mlc-updates.test.ts) (new in 4b.1) | mlc.controller | Singleton-free |
| [`lama-dama/__tests__/lama-dama.test.ts`](../../src/api/lama-dama/__tests__/lama-dama.test.ts) | lama-dama.controller | Singleton-free |
| [`lama-dama/__tests__/lama-dama-mrd-audit.test.ts`](../../src/api/lama-dama/__tests__/lama-dama-mrd-audit.test.ts) | lama-dama.controller | Singleton-free |
| [`lama-dama/__tests__/lama-dama-updates.test.ts`](../../src/api/lama-dama/__tests__/lama-dama-updates.test.ts) (new in 4b.1) | lama-dama.controller | Singleton-free |
| [`hmis-sync/__tests__/hmis-sync-sse-wiring.test.ts`](../../src/api/hmis-sync/__tests__/hmis-sync-sse-wiring.test.ts) | hmis-sync.controller (rogue) + prisma-client (singleton) | **Yes** — explicit dual-mock comment in file |

Plus `opd-admit.test.ts` — no `@prisma/client` mock (uses singleton only; does NOT test opd.controller directly — tests a higher-level admit flow). Consolidating `opd.controller` still requires updating opd-admit.test.ts IF opd.controller paths are reached, which they aren't currently.

**Post-consolidation cleanup per test file:**
- 8 dual-aware test files → drop `jest.mock('@prisma/client', ...)` blocks.
- Mock data merges into the singleton mock.
- Mock objects themselves (e.g. `mlcCaseMock`) don't change — just the wiring.
- **Effort estimate:** ~10-15 line deletion per test file for the rogue-mock block. No assertion changes.

## 0.5 `$transaction` spanning analysis

Grep for `$transaction` across the entire `src/` tree:

| File | `prisma` is... | Transaction scope |
|---|---|---|
| [`ipd.controller.ts:757`](../../src/api/ipd/ipd.controller.ts#L757) | **singleton** | `transferIpdAdmission` — all writes inside one interactive tx via `tx` parameter |
| [`services/services.controller.ts:182`](../../src/api/services/services.controller.ts#L182) | **rogue** (cluster C) | service update — all writes inside one interactive tx via `prisma` callback-shadowed param |
| [`service-radiology/service-radiology.controller.ts:254`](../../src/api/service-radiology/service-radiology.controller.ts#L254) | **rogue** (cluster C) | same pattern as services |

**All three transactions are single-file, single-client.** No transaction currently spans multiple controller files. **No silent cross-client transaction bug exists in the codebase today.**

Consolidation will not introduce a transaction bug, but it does mean the two rogue transactions (services + service-radiology) will commit against the shared singleton pool after consolidation. Behaviour-identical; just pool sharing.

## 0.6 Replacement pattern (mechanical)

For every rogue file, replace the two lines:

```ts
import { PrismaClient } from '@prisma/client';
// ...
const prisma = new PrismaClient();
```

with:

```ts
import prisma from '../../service/prisma-client';  // adjust relative depth per file
```

Edge cases:

1. **Repository/resolver classes** (e.g., `doctor.repository.ts:6`, `department.respository.ts:7`, `patient.repository.ts:7`) declare `private prisma = new PrismaClient()` as a class field. Conversion: replace with `private readonly prisma = sharedPrisma;` where `sharedPrisma` is the singleton import. Or move to accepting `prisma` via constructor (more invasive). **Recommendation: module-scope import of the singleton, drop the private field assignment** — maintains the `this.prisma.xxx.findMany()` call-site shape.

2. **`doctor.repository.ts` has 2 instances** (line 3 module-scope + line 6 class field). Both go.

3. **Import depth varies** by controller location:
   - `src/api/<module>/foo.controller.ts` → `'../../service/prisma-client'`
   - `src/api/<module>/<sub>/foo.ts` → `'../../../service/prisma-client'` (only follow-up-automation / conversion use this depth; check per file).
   - `src/middleware/middleware.ts` → `'../service/prisma-client'`

4. **`hmis-audit.ts`** and **`hmis-sync.controller.ts`** are both inside `src/api/hmis-sync/` — depth `../../service/prisma-client`.

## 0.7 Test coverage maintenance

Goal: **zero test regressions post-consolidation.**

Per-test-file impact for each scope option:

| Scope option | Test files touched | Test rewrite effort |
|---|---|---|
| Cluster A only (4 files) | 7 test files (all in A's modules) | ~10-15 LOC delete per test file (drop `jest.mock('@prisma/client')` block + reroute mocks to singleton path) |
| A + B (7 files) | 8 test files (+ hmis-sync-sse-wiring) | Same per-file effort; 1 more file |
| Full (39 files) | 8 + some of the Cluster C test coverage (if any) | **Unknown** — Cluster C test coverage is sparse (no grep hits for PrismaClient mocks outside the 8 files). Means most Cluster C files have zero direct tests; consolidation is safe but unverified for those. |

## 0.8 Risk assessment

| Risk | Cluster A | Cluster A+B | Full |
|---|---|---|---|
| Behaviour change | None (identical config) | None | None |
| Transaction corruption | None | None | None |
| Test regression surface | Low (8 files, well-mocked) | Low (9 files) | **Medium** — 33 Cluster C files have sparse test coverage; consolidation is verified only by the existing `tsc --noEmit` pass, not by direct tests. |
| Review burden | Small PR (~12 file edits) | Small PR (~18 edits) | **Large** PR (~80+ edits); hard to review in one pass |
| Time-to-land | Hours | Hours | Multiple sessions |

## 0.9 Recommendation — Scope Option B (A + B)

**Do Cluster A (4 files) + Cluster B (3 files) in 4b.6. Defer Cluster C to a dedicated cleanup sprint.**

Rationale:
- A solves the original Sprint 3f test-mock-problematic trigger.
- B is high-value: `hmis-audit.ts` is imported by every audit-log write across the codebase. `hmis-sync.controller.ts` is tangled with 4b.3 work. `middleware.ts` is request-hot.
- Cluster C has 33 files with sparse test coverage — a large low-confidence refactor that'll balloon the PR. **Splitting it off preserves 4b.6 as a "small" phase per the phase-order plan.** The user's phase-order doc explicitly labelled 4b.6 "small".
- User's phase-order also says "If consolidation reveals a transaction-spanning bug, flag and fix separately — do not bury it in the refactor." No such bug found, but the same principle applies to scope: don't bury 33 files of unverified refactor in the 6-file refactor that was planned.

**Option A alternative:** if you want strictly the Sprint-3f-original-ask, do Cluster A only (4 files, zero behaviour nuance). That's the safest and narrowest interpretation. Cluster B can join the Cluster-C cleanup sprint.

**Option C (full 39 files):** valid if appetite for a dedicated "legacy cleanup" sprint exists — but then 4b.6 becomes "medium-to-large", which contradicts the phase-order plan.

## 0.10 Decision matrix — items needing user response

| # | Question | Recommended |
|---|---|---|
| Q1 | What scope? (A = 4 files, B = 7 files, C = 39 files) | **B — A + B (7 files)** |
| Q2 | For repository/resolver classes with `private prisma = new PrismaClient()`, keep the field (point at singleton) or drop and use module-scope import? | **Module-scope import** — call sites become `prisma.xxx` instead of `this.prisma.xxx`. But this touches more lines. Alternatively `private readonly prisma = sharedPrisma` preserves call-site shape. User picks. |
| Q3 | OK to drop `jest.mock('@prisma/client', ...)` blocks in the 8 dual-aware tests and consolidate to singleton-only mocks? | **Yes** — simpler + the whole point of 4b.6 |
| Q4 | Any risk flag before proceeding? Full backend test suite (currently 161) must remain at 161 post-consolidation (zero net test delta). | **Confirm** |

## 0.11 Proposed 4b.6 execution order (pending scope decision)

Assuming **Option B** approval:

1. Convert Cluster A's 4 controllers: replace `new PrismaClient()` with singleton import.
2. Convert Cluster B's 3 files (hmis-audit, hmis-sync.controller, middleware).
3. For each converted file, update corresponding test files:
   - Drop `jest.mock('@prisma/client', ...)` blocks.
   - Ensure `jest.mock('../../../service/prisma-client', ...)` (or correct depth) covers the mock data.
   - Merge any rogue-client-only mock objects into the singleton mock.
4. `npx tsc --noEmit` after each cluster.
5. `npx jest --no-coverage` — must show **161/161 passing, 19 test suites** (zero change from post-4b.1).
6. Write `docs/modules/phase-4b-6-sync.md` — short doc covering the consolidation, what scope was done, what remains deferred (Cluster C).
7. Report in standard format.

**Stopping here.** Awaiting user response on Q1–Q4.
