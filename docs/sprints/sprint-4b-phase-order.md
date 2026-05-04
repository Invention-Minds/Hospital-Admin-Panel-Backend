# Sprint 4b — Phase Order · Planning Doc

**Date:** 2026-04-20 · **Status:** Phase order proposed — **awaiting user approval before Phase 4b.1 Step 0 audit begins.**

**Out of scope for 4b (explicit):**
- ~~Discharge PDF (Sprint 4a Item 4)~~ — parked indefinitely per 2026-04-20 decision. Do not audit, plan, or touch the scaffold.
- Legacy follow-up row cleanup — remains queued in [sprint-4c](./sprint-4b-plan.md#sprint-4c--legacy-data-cleanup-queued) until production data lands.

## Hard rules still in force (carry-over from 4a)
- Step 0 audit before **every** phase. 4a every audit caught at least one real bug.
- Migrations: hand-written SQL, `prisma migrate diff --script` byte-match, **no** `--shadow-database-url`.
- Server-derived identity only — `req.user.id` / `req.user.username`, never `req.body.*` or request headers for attribution.
- Per-phase approval gate. No batching. Report in standard format after each phase.

---

## Proposed execution order

Confirmed: the order below is what the agent will execute once 4b.1 Step 0 is approved. The rationale is "schema-before-surface-before-behaviour" — bundle additive migrations first, then stabilize the controller surface, then do the behaviour-change phases (identity audit → persistence → retry → backoff) that build on a clean surface.

| # | Phase | Scope | Depends on | Rationale |
|---|---|---|---|---|
| 1 | **4b.1 — Update-attribution full pass** | Medium | — | Additive migration only; lowest blast radius; completes MRD.1 update-side coverage deferred from 4a Phase 1b. Bundling first keeps all schema work at the start of the sprint. |
| 2 | **4b.6 — Prisma client consolidation** | Small | 4b.1 complete | Clears debt on emergency/opd/lama-dama/mlc controllers **before** 4b.2 audits those same files. Doing 4b.6 after 4b.2 would risk re-churning the identity-audit diffs. |
| 3 | **4b.2 — API-wide server-identity audit** | Medium | 4b.6 complete | Controllers now use a single Prisma singleton, so per-endpoint identity patches don't collide with transaction-ownership cleanup. |
| 4 | **4b.3 — CriticalValueAcknowledgment persistent store** | Medium | 4b.2 complete | The persistent store is the positive counterpart to 4b.2's audit — both write ack attribution from `req.user`. Writing the store once the identity contract is uniform across the API means no retrofit. |
| 5 | **4b.4 — Retry cron real implementation** | Large | 4b.3 complete | Replays `HmisAuditLog.payload` — safer to build replay logic once the module/action dispatch surface is stable (post 4b.3's new `bed-census` module work, etc.). Largest scope; benefits from warm understanding of audit rows. |
| 6 | **4b.5 — SSE exponential backoff** | Small | — (independent) | Pure frontend service change inside `critical-values.service.ts`. Scheduled last because it's smallest and isolated — fits as a "cool-down" phase. Could in principle run in parallel, but per-phase gate rule keeps it serialized. |

User's proposed order (1→6→2→3→4→5) matches this ordering exactly. **Confirmed; no re-ordering proposed.**

---

## Per-phase detail

### 4b.1 — Update-attribution full pass

- **Scope estimate:** Medium. 1 migration (12 ALTER TABLE ADD COLUMN statements) + 16 update-handler patches + ~20 tests.
- **Dependencies:** None. First phase.
- **Step 0 audit:** Yes. Audit targets:
  - Confirm the 7 clinical models' current `updatedBy` / `updatedById` column state matches the sprint-4b-plan.md assumption (5 models missing `updatedBy`, all 7 missing `updatedById`).
  - Walk the 16 update handlers in ipd / ipd-prescription / mlc / lama-dama controllers; confirm which already stamp `updatedBy` via the `req.user?.username || 'system'` pattern versus which don't touch it.
  - Verify no handler update path hits a rejection branch that would swallow the new stamp.
- **Clinical stakeholder input:** None. Internal MRD completeness.
- **Done-criteria:** migration applied; all 16 handlers stamp both `updatedBy` + `updatedById`; backend tests prove stamping on happy path (rejection path already covered by 4a Phase 1b); docs updated.

### 4b.6 — Prisma client consolidation

- **Scope estimate:** Small. 4–8 controller files — replace `new PrismaClient()` with the `src/service/prisma-client` singleton.
- **Dependencies:** 4b.1 complete (avoids merge conflict on handlers 4b.1 also touches).
- **Step 0 audit:** Yes. Audit targets:
  - Grep all `new PrismaClient()` instantiations under `src/api`.
  - For each file, check whether the local instance is used inside a `prisma.$transaction` — swapping the singleton mid-transaction is safe, but the audit must confirm no test mock assumes the local instance.
  - Verify no lifecycle issue: singletons handle connection pool; local `new PrismaClient()` risks pool exhaustion. This is debt, not a live bug — confirm.
- **Clinical stakeholder input:** None.
- **Done-criteria:** zero `new PrismaClient()` under `src/api`; full backend test suite green; no regression on transaction-heavy controllers.

### 4b.2 — API-wide server-identity audit

- **Scope estimate:** Medium. Grep-driven sweep across `src/api/**/*.routes.ts` and corresponding controllers. Patch count is unknown pre-audit — Step 0 produces the list.
- **Dependencies:** 4b.6 complete (clean surface for per-endpoint patches).
- **Step 0 audit:** Yes. Audit targets:
  - Enumerate every `router.post` / `router.put` / `router.patch` under `src/api`.
  - For each: check whether handler reads identity from `req.body.*` or request headers instead of `req.user`.
  - Identify the Phase-1d-class loophole (client-supplied `acknowledgedBy` was the canonical example; others may exist for `createdBy`, `updatedBy`, `assignedBy`, `dischargedBy`, etc.).
  - Produce a per-endpoint patch list with risk class (audit-trail impersonation vs cosmetic).
- **Clinical stakeholder input:** None. Server-derived-identity policy is already the ratified standing rule from 4a Phase 1d.
- **Done-criteria:** every write endpoint identified either uses `authenticateToken` + `req.user`, or has an explicit "public/webhook" exemption documented; tests prove body-supplied identity is ignored.

### 4b.3 — CriticalValueAcknowledgment persistent store

- **Scope estimate:** Medium. 1 new table + migration + controller/service rewrite + test rewrite (the 4a Phase 1d ack tests mock an in-memory Map; they'll migrate to mock a DB create).
- **Dependencies:** 4b.2 complete. (Ack endpoint is one of the identity-audit targets; doing 4b.3 before 4b.2 risks the ack endpoint's identity contract getting re-touched.)
- **Step 0 audit:** Yes. Audit targets:
  - Confirm the schema matches the 4a sprint-4b-plan.md sketch (alertId, acknowledgedBy, acknowledgedById, acknowledgedAt, originalAlertPayload JSON).
  - Audit the current `alertAcknowledgments: Map<string, …>` reads in `critical-value-sse.ts` and `critical-values.routes.ts` — confirm the demotion-to-read-cache path doesn't break the SSE broadcast shape.
  - Decide migration behaviour for the existing in-memory Map on first deploy (empty → no backfill needed, confirm).
- **Clinical stakeholder input:** None.
- **Done-criteria:** `acknowledgeAlertById` writes to DB first; in-memory Map is a read-cache populated from DB on server startup; NABH audit row survives server restart; tests prove persistence.

### 4b.4 — Retry cron real implementation

- **Scope estimate:** Large. Module-action dispatch registry + replay path + `retryCount` cap enforcement + per-log backoff.
- **Dependencies:** 4b.3 complete. (Ack persistence introduces a new write action; the dispatch registry should cover all current modules in one pass.)
- **Step 0 audit:** Yes. Audit targets:
  - Walk current `hmisSyncQueue.retryFailedSyncs` (the stub with `console.warn`).
  - Enumerate every module + action pair currently emitting `status='failed'` audit rows: identify which payloads are safe to replay (idempotent writes) vs which would double-effect (non-idempotent).
  - Design dispatch map: `(module, action) → replay function(payload)`.
  - Confirm `retryCount < 3` cap is honoured; backoff schedule (user-confirmable) — default exponential 5min → 15min → 60min.
- **Clinical stakeholder input:** None. Retry policy is technical.
- **Done-criteria:** retry cron actually replays failed pushes via the dispatch registry; the "retry cron is stubbed" comment at `hmis-sync.queue.ts:~374` is removed; tests prove retry advancement + cap enforcement.

### 4b.5 — SSE exponential backoff

- **Scope estimate:** Small. One frontend service — `src/app/services/critical-values-alert/critical-values.service.ts` (path from 4a Phase 1d work).
- **Dependencies:** None structural. Scheduled last per user's "cool-down" slot.
- **Step 0 audit:** Yes. Audit targets:
  - Confirm current reconnect logic (fixed 5s) and its tests.
  - Verify the backoff schedule: 5s → 10s → 30s → 60s → 300s, max 5 retries, reset on successful connection.
  - Check interaction with the existing `ackInFlight` in-flight tracking — reconnect should not re-send in-flight acks.
- **Clinical stakeholder input:** None.
- **Done-criteria:** backoff observed in service spec (fakeAsync tick pattern); reset-on-success proved; no regression in critical-values-alert tests.

---

## Total scope at a glance

| Category | Count |
|---|---|
| Phases | 6 |
| Small | 2 (4b.5, 4b.6) |
| Medium | 3 (4b.1, 4b.2, 4b.3) |
| Large | 1 (4b.4) |
| New migrations | 2 (4b.1 + 4b.3) |
| Estimated new tests | ~45–60 across phases |

---

## What happens next

1. **User approves this phase order** (or proposes a re-order).
2. Agent writes `docs/sprints/sprint-4b-phase-1-audit.md` (4b.1 Step 0) — migration column-by-column audit + 16-handler survey.
3. User reviews Step 0 → approves execution → 4b.1 executes.
4. Standard per-phase report after 4b.1 ships; wait for approval before 4b.6 Step 0 begins.

**The agent will not auto-start 4b.1 Step 0 audit.** Explicit "proceed with 4b.1 audit" required from user.
