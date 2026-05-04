# Phase 4b.6 — Prisma Client Consolidation · Sync Check

**Date:** 2026-04-21 · **Sprint:** 4b · Phase 4b.6.

Partial consolidation. 7 of 40 rogue `new PrismaClient()` instantiations replaced
with the `src/service/prisma-client` singleton. Cluster C (33 legacy files)
deferred to Sprint 4c.

---

## What changed

### Cluster A — 4 controllers (Sprint-3f-flagged)

Replaced `const prisma = new PrismaClient()` with `import prisma from '../../service/prisma-client'`:

| File | Before | After |
|---|---|---|
| [src/api/emergency/emergency.controller.ts](../../src/api/emergency/emergency.controller.ts) | `new PrismaClient()` at L8 | singleton import |
| [src/api/opd/opd.controller.ts](../../src/api/opd/opd.controller.ts) | `new PrismaClient()` at L5 | singleton import |
| [src/api/mlc/mlc.controller.ts](../../src/api/mlc/mlc.controller.ts) | `new PrismaClient()` at L10 | singleton import |
| [src/api/lama-dama/lama-dama.controller.ts](../../src/api/lama-dama/lama-dama.controller.ts) | `new PrismaClient()` at L15 | singleton import |

### Cluster B — 3 shared-infra files

| File | Before | After |
|---|---|---|
| [src/api/hmis-sync/hmis-audit.ts](../../src/api/hmis-sync/hmis-audit.ts) | `new PrismaClient()` at L3; `PrismaClient` named import | singleton import; `type { HmisAuditLog }` kept as type-only |
| [src/api/hmis-sync/hmis-sync.controller.ts](../../src/api/hmis-sync/hmis-sync.controller.ts) | `new PrismaClient()` at L6 | singleton import |
| [src/middleware/middleware.ts](../../src/middleware/middleware.ts) | `new PrismaClient()` at L5 | singleton import (depth `../service/...`) |

### Test files simplified — 8 files

| Test file | Before | After |
|---|---|---|
| `emergency/__tests__/emergency-convert.test.ts` | **Dual mock** (`@prisma/client` + `service/prisma-client`) | Singleton mock only |
| `hmis-sync/__tests__/hmis-sync-sse-wiring.test.ts` | **Dual mock** with `__controllerInstance` escape hatch | Singleton mock only; `controllerPrisma` now reads from the singleton |
| `mlc/__tests__/mlc.test.ts` | `@prisma/client` mock (singleton-free) | Singleton mock |
| `mlc/__tests__/mlc-mrd-audit.test.ts` | `@prisma/client` mock | Singleton mock |
| `mlc/__tests__/mlc-updates.test.ts` | `@prisma/client` mock | Singleton mock |
| `lama-dama/__tests__/lama-dama.test.ts` | `@prisma/client` mock | Singleton mock |
| `lama-dama/__tests__/lama-dama-mrd-audit.test.ts` | `@prisma/client` mock | Singleton mock |
| `lama-dama/__tests__/lama-dama-updates.test.ts` | `@prisma/client` mock | Singleton mock |

After 4b.6: **zero test files mock `@prisma/client` constructor** across the converted surface. All test mocks use `jest.mock('../../../service/prisma-client', ...)` (or the correct relative depth).

Unexpected findings during conversion: **none.** No rogue had hidden config, no import surprises, no transaction bug surfaced. The audit's 0.3 prediction ("every rogue is a pure duplicate") held.

## Behaviour-preservation guarantees

1. **Identical Prisma config** for all 7 converted files. The singleton was always `new PrismaClient()` with zero args; the 7 rogues were also `new PrismaClient()` with zero args. Swap is bit-for-bit equivalent.
2. **No transaction corruption risk.** Pre-4b.6 grep for `$transaction` found 3 call sites: `ipd.controller` (singleton), `services.controller` (rogue), `service-radiology.controller` (rogue). All three transactions are single-file, single-client; no cross-controller transaction exists today. The 7-file conversion doesn't touch any of the 3 tx sites (services + service-radiology are in deferred Cluster C).
3. **Connection pool impact.** Pre-4b.6 the process had 1 singleton pool + 39 rogue pools = **40 pools**. Post-4b.6: 1 singleton + 32 remaining rogues = **33 pools**. The `middleware.ts` / `hmis-audit.ts` consolidations are most impactful — both are request-hot. Cluster C cleanup will take the count to 1.

## Test suite parity

| Measure | Pre-4b.6 | Post-4b.6 |
|---|---|---|
| Total tests | 161 | **161** ✓ |
| Test suites | 19 | 19 |
| `tsc --noEmit` | clean | clean |

Zero net test delta — exactly as required. No new tests needed; no existing tests required assertion changes beyond mock-path updates.

## What's still deferred — Cluster C (33 files)

Logged in [sprint-4c-plan.md](../sprints/sprint-4c-plan.md) as "Prisma client
consolidation — Cluster C". 33 pre-singleton legacy files across: `ad`, `channel`,
`callback`, `appointments` (controller/repo/resolver), `doctor` (controller/repo/
resolver; repo has 2 instances), `doctor-notes`, `history-notes`, `extraslots`,
`mhc-checkin`, `radiology-queue`, `department` (controller/resolver/respository),
`estimation`, `er`, `login` (controller/repo/resolver), `whatsapp`, `therapy`,
`patient` (controller/repo/helper), `services` (controller/repo/scheduler),
`service-radiology` (controller/repo).

Reasons for deferral:
- Behaviour-preserving per audit 0.3 (same as Cluster A/B) — **not urgent**.
- Sparse direct test coverage for Cluster C files means consolidation is verified
  primarily by `tsc --noEmit` and integration smoke tests, not by unit tests.
- ~80+ line PR if bundled — contradicts the "small" labelling of 4b.6 in the
  phase-order plan.

## Operational note

For any future file that needs database access, **import the singleton — never
`new PrismaClient()`**. The singleton at `src/service/prisma-client.ts` is the
single source of truth for database connectivity. Multiple clients in one process
means multiple connection pools (resource waste) and no atomicity across
controllers if transactions ever span files.

If a future use case genuinely needs a second client (custom log level for a
debugging session, explicit datasource override for a test-only DB, etc.), wrap
it in a named helper in `src/service/` and document the reason — do not
re-scatter `new PrismaClient()` call sites.
